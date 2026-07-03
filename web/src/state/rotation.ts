// Combat-general rotation predictor.
//
// In game the pool of combat generals a corps may recruit is reshuffled on a
// clock-derived seed (NTW3.Shuffle in ntw3.lua), so the offered set changes
// roughly every three hours. The seed depends only on the *local* calendar day,
// month, and an hour bucket — never the year — so the rotation is deterministic
// and annually periodic. This module reproduces that exactly so we can tell the
// player the nearest local time (past or future) at which a chosen combat
// general is offered.
//
// Replicated pieces (must stay byte-faithful to the game):
//   • seed   = floor(localHour / 2.8) * 10000 + (day * 100 + month)   [os.date %d%m]
//   • PRNG   = Windows CRT rand()/srand() LCG (the game is a Win32 build, so Lua
//              5.1's math.random falls through to MSVC rand, RAND_MAX = 32767)
//   • shuffle= re-seed, 5 warm-up draws, then Fisher-Yates (Lua 1-indexed)
//   • select = split generals into staff (Men/2 ∈ {16,61}, i.e. generalKind
//              "staff") and combat pools, shuffle each independently (Shuffle
//              re-seeds every call), take the first N. For combat that is
//              acSelectionGeneralMaxima(faction).combat.
//
// VERIFIED against 7 distinct in-game windows (corps ntw3_ac_a04_x5_076, 2026-06):
// the engine (MSVC PRNG, ddmm seed, 5 warm-ups, Fisher-Yates, count) was already
// exact; the pool ORDER fed to the shuffle is FrontEnd.RecruitableUnits order =
// sort by arm category (artillery → cavalry → infantry) then ascending cost — see
// `recruitOrder` below and the calibration fixture in rotation.test.ts.

import type { UnitCard } from "../domain/types";
import { acSelectionGeneralMaxima } from "../rules/rules";

const RAND_MAX = 32767;

/** Windows CRT rand()/srand() — the LCG `state = state*214013 + 2531011`,
 *  returning bits 30..16. This is the sequence the game's Lua sees on Win32. */
class MsvcRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0;
  }
  /** C rand(): integer in [0, 32767]. */
  rand(): number {
    this.state = (Math.imul(this.state, 214013) + 2531011) >>> 0;
    return (this.state >>> 16) & 0x7fff;
  }
  /** Lua 5.1 `math.random(l, u)` over C rand():
   *  r = (rand() % RAND_MAX) / RAND_MAX; floor(r*(u-l+1)) + l. */
  range(l: number, u: number): number {
    const r = (this.rand() % RAND_MAX) / RAND_MAX;
    return Math.floor(r * (u - l + 1)) + l;
  }
}

/** The shuffle seed for a moment in (local) time — mirrors NTW3.Shuffle. */
export function seedForDate(d: Date): number {
  const seed1 = d.getDate() * 100 + (d.getMonth() + 1); // os.date("%d%m")
  const seed2 = Math.floor(d.getHours() / 2.8); // hour bucket
  return seed2 * 10000 + seed1;
}

/** Fisher-Yates exactly as NTW3.Shuffle does it: re-seed from the date, discard
 *  5 warm-up draws, then walk Lua indices #tbl..2 swapping with random(1, i).
 *  Returns a new array; the input is not mutated. */
export function shuffleByDate<T>(arr: readonly T[], d: Date): T[] {
  const out = arr.slice();
  const rng = new MsvcRng(seedForDate(d));
  for (let i = 0; i < 5; i++) rng.range(1, 100);
  for (let i = out.length; i >= 2; i--) {
    const j = rng.range(1, i); // 1..i (Lua 1-indexed)
    const tmp = out[i - 1];
    out[i - 1] = out[j - 1];
    out[j - 1] = tmp;
  }
  return out;
}

/** Broad arm category the engine groups the recruit list by — the part of the
 *  unit class before the first underscore: "artillery" | "cavalry" | "infantry".
 *  Combat generals report their led unit's class via underlyingUnitClass. */
function armCategory(c: UnitCard): string {
  return (c.underlyingUnitClass || c.unitClass || "").split("_")[0];
}

/** The shuffle-input order the game's FrontEnd.RecruitableUnits produces: the
 *  general pool sorted by arm category (artillery → cavalry → infantry, which is
 *  also alphabetical) then by ascending cost. Verified to reproduce 7 distinct
 *  in-game windows for corps ntw3_ac_a04_x5_076 (see rotation.test.ts). rosterIndex
 *  is only a stable tiebreaker for the rare same-category, same-cost pair. */
export function recruitOrder(a: UnitCard, b: UnitCard): number {
  const ca = armCategory(a);
  const cb = armCategory(b);
  if (ca !== cb) return ca < cb ? -1 : 1;
  if (a.cost !== b.cost) return a.cost - b.cost;
  return a.rosterIndex - b.rosterIndex;
}

/** Combat generals only, in the game's shuffle-input order. */
export function combatPool(cards: readonly UnitCard[]): UnitCard[] {
  return cards.filter((c) => c.isGeneral && c.generalKind === "combat").sort(recruitOrder);
}

/** Staff generals only, in the game's shuffle-input order (the staff slot's pool). */
export function staffPool(cards: readonly UnitCard[]): UnitCard[] {
  return cards.filter((c) => c.isGeneral && c.generalKind === "staff").sort(recruitOrder);
}

/** Whether a faction uses the rotating army-corps general pool. Only "_ac_"
 *  corps recruit via NTW3AC.ACgenerals; regular factions have a fixed roster. */
export function rotationApplies(factionKey: string): boolean {
  return factionKey.includes("_ac_");
}

/** How many combat generals the corps offers per window (max_gens[2] in the Lua:
 *  combat cap + 2). */
export function combatSelectCount(factionKey: string): number {
  return acSelectionGeneralMaxima(factionKey).combat;
}

/** The unitKeys offered from a pool in the window containing `d`: shuffle the
 *  pool for that window and take the first `count`. The staff and combat pools are
 *  shuffled independently (NTW3.Shuffle re-seeds every call with the same seed). */
export function offeredFrom(pool: readonly UnitCard[], count: number, d: Date): string[] {
  const n = Math.min(count, pool.length);
  return shuffleByDate(pool, d)
    .slice(0, n)
    .map((c) => c.unitKey);
}

/** The combat-general unitKeys offered in the window containing `d`. */
export function offeredCombatKeys(factionKey: string, pool: readonly UnitCard[], d: Date): string[] {
  return offeredFrom(pool, combatSelectCount(factionKey), d);
}

/** The corps's permanent commander — always available regardless of the roll. It
 *  is the corps's namesake: the staff general whose name contains the leader in
 *  the corps title (the part before "/", e.g. "Dokhtourov", "Osterman-Tolstoi",
 *  "Barclay de Tolly"). The dearer generals in those corps (Koutouzov,
 *  Miloradovitch) are the *rotating* picks, so cost must NOT decide this. Corps
 *  named for a formation rather than a person (e.g. "Garde impériale") have no
 *  namesake staff, so fall back to the highest-cost staff (the Emperor). */
export function staffCommanderKey(pool: readonly UnitCard[], corpsName: string): string | null {
  if (pool.length === 0) return null;
  const leader = corpsName.replace(/^\s*\d+\.\s*/, "").split("/")[0].trim();
  if (leader) {
    const named = pool.find((c) => c.name.includes(leader));
    if (named) return named.unitKey;
  }
  let best = pool[0];
  for (const c of pool) {
    if (c.cost > best.cost || (c.cost === best.cost && c.rosterIndex < best.rosterIndex)) best = c;
  }
  return best.unitKey;
}

/** The staff generals offered in the window containing `d`: the permanent
 *  commander (always available) plus one rotating pick from the staff pool
 *  (NTW3 offers staffgen_max = 1 from the shuffle). When the roll picks the
 *  commander himself, only he is shown. Verified against 7 in-game windows for
 *  the Garde impériale (ntw3_ac_a11_x5_130); the namesake-commander rule matches
 *  the Russian corps (Dokhtourov, Osterman-Tolstoi) the user reported. */
export function offeredStaffKeys(pool: readonly UnitCard[], corpsName: string, d: Date): string[] {
  const commander = staffCommanderKey(pool, corpsName);
  if (!commander) return [];
  const picked = offeredFrom(pool, 1, d)[0];
  return picked && picked !== commander ? [commander, picked] : [commander];
}

// --- Window arithmetic --------------------------------------------------------
// A "window" is a maximal run of consecutive local hours that share an hour
// bucket (floor(h/2.8)). Because of the /2.8 the windows are not a clean 3 hours:
// they start at local hours [0, 3, 6, 9, 12, 14, 17, 20, 23].

export const WINDOW_START_HOURS: readonly number[] = (() => {
  const starts: number[] = [];
  let prev = -1;
  for (let h = 0; h < 24; h++) {
    const b = Math.floor(h / 2.8);
    if (b !== prev) {
      starts.push(h);
      prev = b;
    }
  }
  return starts;
})();

/** The window-start hour for a clock hour. */
export function windowStartHour(hour: number): number {
  let s = WINDOW_START_HOURS[0];
  for (const h of WINDOW_START_HOURS) if (h <= hour) s = h;
  return s;
}

/** Start of the window containing `d` (minutes/seconds cleared). */
export function windowStart(d: Date): Date {
  const r = new Date(d);
  r.setHours(windowStartHour(d.getHours()), 0, 0, 0);
  return r;
}

/** Start of the window immediately after `ws` (a window start), rolling the day. */
export function nextWindowStart(ws: Date): Date {
  const idx = WINDOW_START_HOURS.indexOf(ws.getHours());
  const r = new Date(ws);
  if (idx === WINDOW_START_HOURS.length - 1) {
    r.setDate(r.getDate() + 1);
    r.setHours(WINDOW_START_HOURS[0], 0, 0, 0);
  } else {
    r.setHours(WINDOW_START_HOURS[idx + 1], 0, 0, 0);
  }
  return r;
}

/** Start of the window immediately before `ws` (a window start), rolling the day. */
export function prevWindowStart(ws: Date): Date {
  const idx = WINDOW_START_HOURS.indexOf(ws.getHours());
  const r = new Date(ws);
  if (idx <= 0) {
    r.setDate(r.getDate() - 1);
    r.setHours(WINDOW_START_HOURS[WINDOW_START_HOURS.length - 1], 0, 0, 0);
  } else {
    r.setHours(WINDOW_START_HOURS[idx - 1], 0, 0, 0);
  }
  return r;
}

export interface RotationResult {
  /** True when the general is in the build's faction window right now. */
  activeNow: boolean;
  /** Start of the nearest current/future window offering the general. */
  next: Date | null;
  /** Start of the nearest strictly-past window offering the general. */
  prev: Date | null;
  /** Whichever of now/next/prev is closest in absolute time. */
  closest: Date | null;
  closestDirection: "now" | "future" | "past" | null;
}

// Just over a year of windows — the rotation is annually periodic, so a general
// that ever appears appears within this span (and one that never appears is
// correctly reported as unavailable).
const MAX_WINDOWS = 9 * 367;

/** Core scan: nearest window (past or future) in which `targetKey` is in the set
 *  returned by `offered(window)`, searching out from `now`. */
function findRotationWith(
  targetKey: string,
  now: Date,
  offered: (d: Date) => readonly string[],
): RotationResult {
  const memo = new Map<number, Set<string>>();
  const offeredAt = (d: Date): Set<string> => {
    const seed = seedForDate(d);
    let s = memo.get(seed);
    if (!s) {
      s = new Set(offered(d));
      memo.set(seed, s);
    }
    return s;
  };

  const cur = windowStart(now);
  const activeNow = offeredAt(cur).has(targetKey);

  let next: Date | null = null;
  {
    let ws = activeNow ? nextWindowStart(cur) : cur;
    for (let i = 0; i < MAX_WINDOWS; i++) {
      if (offeredAt(ws).has(targetKey)) {
        next = ws;
        break;
      }
      ws = nextWindowStart(ws);
    }
  }

  let prev: Date | null = null;
  {
    let ws = prevWindowStart(cur);
    for (let i = 0; i < MAX_WINDOWS; i++) {
      if (offeredAt(ws).has(targetKey)) {
        prev = ws;
        break;
      }
      ws = prevWindowStart(ws);
    }
  }

  let closest: Date | null = null;
  let closestDirection: RotationResult["closestDirection"] = null;
  if (activeNow) {
    closest = cur;
    closestDirection = "now";
  } else if (next && prev) {
    const toNext = next.getTime() - now.getTime();
    const fromPrev = now.getTime() - prev.getTime();
    if (toNext <= fromPrev) {
      closest = next;
      closestDirection = "future";
    } else {
      closest = prev;
      closestDirection = "past";
    }
  } else if (next) {
    closest = next;
    closestDirection = "future";
  } else if (prev) {
    closest = prev;
    closestDirection = "past";
  }

  return { activeNow, next, prev, closest, closestDirection };
}

/** Nearest window in which `targetKey` is among the combat generals offered from
 *  `pool` (count = combatSelectCount). */
export function findRotation(
  pool: readonly UnitCard[],
  selectCount: number,
  targetKey: string,
  now: Date,
): RotationResult {
  return findRotationWith(targetKey, now, (d) => offeredFrom(pool, selectCount, d));
}

/** Nearest window in which `targetKey` is among the staff generals offered from
 *  `pool` — the permanent commander (always available) or one rotating pick. */
export function findStaffRotation(
  pool: readonly UnitCard[],
  corpsName: string,
  targetKey: string,
  now: Date,
): RotationResult {
  return findRotationWith(targetKey, now, (d) => offeredStaffKeys(pool, corpsName, d));
}

// --- Minimal-cover grouping ---------------------------------------------------
// Rather than time each selected general on its own row, the game lets you grab
// every general a window happens to offer in one visit. So the useful answer is
// the *fewest* windows ("time rolls") that together offer all selected generals —
// a set-cover over the rotation, exactly like the ToW roll finder combines corps.
// Ties (same number of windows) are broken by clustering the windows as close
// together as possible, then as close to now as possible.

export interface RotationGroup {
  /** Window start (local) at which this group of generals is jointly offered. */
  window: Date;
  /** Whether this window is the current one, upcoming, or most-recently past. */
  direction: "now" | "future" | "past";
  /** The selected general keys to recruit in this window (each assigned once). */
  keys: string[];
}

export interface RotationCoverResult {
  /** Minimal set of windows covering every reachable target, ordered by time. */
  groups: RotationGroup[];
  /** Selected keys never offered in any window (not in this corps's rotation). */
  unreachable: string[];
}

/** One candidate k-window pick, scored for the tie-break comparison. */
interface CoverPick {
  times: Date[];
  spread: number; // hi − lo of the chosen window times (ms)
  nearest: number; // min |t − now| across the pick (ms)
  farthest: number; // max |t − now| across the pick (ms)
  future: boolean; // whether the nearest window is now/upcoming (vs past)
  lo: number; // earliest window time (ms), final deterministic tiebreak
}

/** Order two candidate picks: fewest-windows is fixed (both size k), so compare by
 *  tightest cluster (spread), then closest to now, then a deterministic tail. */
function pickIsBetter(a: CoverPick, b: CoverPick): boolean {
  if (a.spread !== b.spread) return a.spread < b.spread;
  if (a.nearest !== b.nearest) return a.nearest < b.nearest;
  if (a.farthest !== b.farthest) return a.farthest < b.farthest;
  if (a.future !== b.future) return a.future; // prefer future/now over past on ties
  return a.lo < b.lo;
}

/** Smallest-range pick over k sorted time-lists: choose one time from each list to
 *  minimise the cluster spread, tie-broken by closeness to now. Classic k-way
 *  min-range sweep — advance the list holding the current minimum, tracking the
 *  best configuration seen. Every list is non-empty (guaranteed by the caller). */
function bestPickForLists(lists: readonly (readonly Date[])[], now: number): CoverPick {
  const ptr = lists.map(() => 0);
  let curMax = -Infinity;
  for (const l of lists) curMax = Math.max(curMax, l[0].getTime());

  let best: CoverPick | null = null;
  for (;;) {
    // The list whose current front is the minimum defines the cluster's low edge.
    let minI = 0;
    for (let i = 1; i < lists.length; i++) {
      if (lists[i][ptr[i]].getTime() < lists[minI][ptr[minI]].getTime()) minI = i;
    }
    const times = lists.map((l, i) => l[ptr[i]]);
    const ms = times.map((t) => t.getTime());
    const lo = ms[minI];
    const dists = ms.map((t) => Math.abs(t - now));
    const nearestI = ms.reduce((bi, t, i) => (Math.abs(t - now) < Math.abs(ms[bi] - now) ? i : bi), 0);
    const cand: CoverPick = {
      times,
      spread: curMax - lo,
      nearest: Math.min(...dists),
      farthest: Math.max(...dists),
      future: ms[nearestI] >= now,
      lo,
    };
    if (!best || pickIsBetter(cand, best)) best = cand;

    ptr[minI]++;
    if (ptr[minI] === lists[minI].length) break; // a list is exhausted → done
    curMax = Math.max(curMax, lists[minI][ptr[minI]].getTime());
  }
  return best!;
}

/** The fewest windows (past or future) that together offer every selected general,
 *  clustered as tightly as possible and then as near to `now` as possible.
 *
 *  `offered(d)` returns the general keys a window offers (combat ∪ staff — both are
 *  rolled in the same window). Each returned group lists the targets to recruit in
 *  that window, assigned to exactly one window so every general is shown once. */
export function findRotationCover(
  offered: (d: Date) => Iterable<string>,
  targets: readonly string[],
  now: Date,
): RotationCoverResult {
  const targetList = [...new Set(targets)];
  if (targetList.length === 0) return { groups: [], unreachable: [] };
  // Bit per target (build combat cap ≤ 8 + one staff slot ⇒ well within 31 bits).
  const bitOf = new Map<string, number>();
  targetList.forEach((k, i) => bitOf.set(k, 1 << i));

  const maskMemo = new Map<number, number>();
  const maskAt = (d: Date): number => {
    const seed = seedForDate(d);
    let m = maskMemo.get(seed);
    if (m === undefined) {
      m = 0;
      for (const key of offered(d)) {
        const b = bitOf.get(key);
        if (b !== undefined) m |= b;
      }
      maskMemo.set(seed, m);
    }
    return m;
  };

  // Enumerate windows both directions from now, keeping those that offer any target.
  const cands: { time: Date; mask: number }[] = [];
  const cur = windowStart(now);
  {
    let ws = cur;
    for (let i = 0; i < MAX_WINDOWS; i++) {
      const m = maskAt(ws);
      if (m) cands.push({ time: ws, mask: m });
      ws = nextWindowStart(ws);
    }
  }
  {
    let ws = prevWindowStart(cur);
    for (let i = 0; i < MAX_WINDOWS; i++) {
      const m = maskAt(ws);
      if (m) cands.push({ time: ws, mask: m });
      ws = prevWindowStart(ws);
    }
  }

  let reachable = 0;
  for (const c of cands) reachable |= c.mask;
  const unreachable = targetList.filter((k) => !(reachable & bitOf.get(k)!));
  const fullMask = reachable;
  if (fullMask === 0) return { groups: [], unreachable: targetList };

  // Sorted time-lists per distinct coverage mask (a window has exactly one mask).
  const timesByMask = new Map<number, Date[]>();
  for (const c of cands) {
    const list = timesByMask.get(c.mask);
    if (list) list.push(c.time);
    else timesByMask.set(c.mask, [c.time]);
  }
  for (const list of timesByMask.values()) list.sort((a, b) => a.getTime() - b.getTime());
  const distinct = [...timesByMask.keys()];

  // Fewest windows to cover fullMask — BFS over reached-bit states (unit step cost).
  const dist = new Map<number, number>([[0, 0]]);
  let frontier = [0];
  while (frontier.length && !dist.has(fullMask)) {
    const next: number[] = [];
    for (const s of frontier) {
      for (const m of distinct) {
        const ns = s | m;
        if (!dist.has(ns)) {
          dist.set(ns, dist.get(s)! + 1);
          next.push(ns);
        }
      }
    }
    frontier = next;
  }
  const k = dist.get(fullMask)!;

  // Enumerate every size-k combination of distinct masks that covers fullMask, and
  // keep the one whose best time-assignment clusters tightest / nearest to now.
  // A combination need only use masks that each add coverage (a minimal cover has
  // no redundant window), and is pruned when the remaining masks can't complete it.
  const suffixOr = new Array<number>(distinct.length + 1).fill(0);
  for (let i = distinct.length - 1; i >= 0; i--) suffixOr[i] = suffixOr[i + 1] | distinct[i];
  const nowMs = now.getTime();

  let best: CoverPick | null = null;
  let bestMasks: number[] | null = null;
  const chosen: number[] = [];
  const dfs = (start: number, acc: number): void => {
    if (chosen.length === k) {
      if (acc !== fullMask) return;
      const pick = bestPickForLists(
        chosen.map((m) => timesByMask.get(m)!),
        nowMs,
      );
      if (!best || pickIsBetter(pick, best)) {
        best = pick;
        bestMasks = [...chosen];
      }
      return;
    }
    for (let i = start; i < distinct.length; i++) {
      if ((acc | suffixOr[i]) !== fullMask) break; // can't finish from here on
      const m = distinct[i];
      if ((acc | m) === acc) continue; // redundant — adds no new coverage
      chosen.push(m);
      dfs(i + 1, acc | m);
      chosen.pop();
    }
  };
  dfs(0, 0);

  const pick = best!;
  const masks = bestMasks!;

  // Assign each target to exactly one chosen window (the one nearest to now that
  // offers it) so every general is listed once — a clean per-window shopping list.
  const groups = masks.map((mask, i) => ({ window: pick.times[i], mask, keys: [] as string[] }));
  const curMs = cur.getTime();
  for (const key of targetList) {
    const b = bitOf.get(key)!;
    if (!(reachable & b)) continue;
    let pickIdx = -1;
    for (let i = 0; i < groups.length; i++) {
      if (!(groups[i].mask & b)) continue;
      if (
        pickIdx < 0 ||
        Math.abs(groups[i].window.getTime() - nowMs) < Math.abs(groups[pickIdx].window.getTime() - nowMs)
      ) {
        pickIdx = i;
      }
    }
    if (pickIdx >= 0) groups[pickIdx].keys.push(key);
  }

  const result: RotationGroup[] = groups
    .filter((g) => g.keys.length > 0)
    .map((g): RotationGroup => ({
      window: g.window,
      direction: g.window.getTime() === curMs ? "now" : g.window.getTime() > nowMs ? "future" : "past",
      keys: g.keys,
    }))
    .sort((a, b) => a.window.getTime() - b.window.getTime());

  return { groups: result, unreachable };
}
