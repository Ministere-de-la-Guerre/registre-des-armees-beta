// Units whose in-game uniform is bugged in NTW3 itself (not this app).
//
// The 23e léger 'le Bouillon' of the 1811 (Spain) and 1814 (France) rosters
// render with a uniform that is broken in the base game. Every variant of those
// regiments — the plain unit, its combat-general (`_com_…`) commander, and the
// Theatres-of-War (`_tow_…`) copies — extends the same unit-body key and shares
// the same bugged uniform asset, so we match on the body-key prefix.
//
// Source of truth: source/reference/.../ntw3_uniforms.tsv. These four bodies map
// to uniform_inf_light_{153_023_5628,154_023_5662,294_023_6921,294_023_6930}, and
// no other unit in the dataset carries those uniforms.

import type { UnitCard } from "./types";

export const BUGGED_UNIFORM_UNIT_BODIES = [
  "ntw3_inf_light_153_023_5628", // 23e léger — 1811 Spain (Dorsenne / Nord)
  "ntw3_inf_light_154_023_5662", // 23e léger — 1811 Spain (Macdonald / Catalogne)
  "ntw3_inf_light_294_023_6921", // 23e léger — 1814 France (Augereau / Rhône, L5)
  "ntw3_inf_light_294_023_6930", // 23e léger — 1814 France (Augereau / Rhône, L4)
] as const;

/** The bugged-uniform body key this card belongs to, or null if its uniform is
 *  fine. Stable across the base / `_com_` / `_tow_` variants of a regiment (they
 *  all extend the same body prefix), so it doubles as a per-regiment key for
 *  de-duplicating the warning. */
export function buggedUniformKey(card: UnitCard): string | null {
  return BUGGED_UNIFORM_UNIT_BODIES.find((body) => card.unitKey.startsWith(body)) ?? null;
}

/** Whether this unit's in-game uniform is bugged (see BUGGED_UNIFORM_UNIT_BODIES). */
export function hasBuggedUniform(card: UnitCard): boolean {
  return buggedUniformKey(card) !== null;
}
