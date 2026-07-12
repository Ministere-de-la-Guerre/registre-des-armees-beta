import { useEffect, useState } from "react";
import { assetUrl } from "../data/assets";
import { classLabel } from "../domain/labels";
import type { UnitCard } from "../domain/types";
import type { GeneralSwap, SwapOption } from "../state/build";
import { Medallion } from "./Medallion";

/** Choose which combat general leads one selected copy of a unit — or send it back to
 *  the plain unit. Opened from the ★ badge on a copy in the build tray, so a unit can
 *  be taken first and given its general later, without giving up the slot.
 *
 *  The swap keeps the copy's slot: a general variant *is* the unit under that officer,
 *  so the card count, the unit's shared cap and its class caps are all unchanged — only
 *  the cost and the combat-general cap move (see state/build.generalSwapFor). */
export function GeneralSwapModal({
  swap,
  combatCap,
  combatGensUsed,
  onPick,
  onClose,
}: {
  swap: GeneralSwap;
  combatCap: number;
  combatGensUsed: number;
  onPick: (unitKey: string) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const base = swap.plain?.card ?? swap.current;
  const left = Math.max(0, combatCap - combatGensUsed);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal gen-swap-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Combat general for ${base.name}`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-head">
          <Medallion card={swap.current} hideName />
          <div className="gen-swap-title">
            <h3 style={{ color: "var(--gold-bright)" }}>Combat general</h3>
            <div style={{ fontSize: 12, opacity: 0.9 }}>{base.name}</div>
            <div style={{ fontSize: 11, opacity: 0.7, marginTop: 2 }}>
              {classLabel(base.unitClass)} · {combatGensUsed}/{combatCap} combat generals used ({left} left)
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <button className="btn small" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="gen-swap-intro">
            A combat general takes this unit’s slot rather than a new one — the same regiment, now led into
            battle by an officer. Pick one, or put the plain unit back.
          </p>
          <div className="swap-list">
            {swap.plain && <SwapRow option={swap.plain} plain onPick={onPick} />}
            {swap.generals.map((option) => (
              <SwapRow key={option.card.unitKey} option={option} onPick={onPick} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SwapRow({
  option,
  plain = false,
  onPick,
}: {
  option: SwapOption;
  plain?: boolean;
  onPick: (unitKey: string) => void;
}) {
  const { card, current, costDelta, blockedReason, overBudget } = option;
  const delta =
    costDelta === 0
      ? "same cost"
      : costDelta > 0
        ? `+${costDelta.toLocaleString()}`
        : `−${Math.abs(costDelta).toLocaleString()}`;

  return (
    <button
      type="button"
      className={`swap-row${current ? " current" : ""}${blockedReason ? " blocked" : ""}`}
      disabled={current || blockedReason !== null}
      onClick={() => onPick(card.unitKey)}
    >
      <Portrait card={card} />
      <span className="swap-text">
        <span className="swap-name">{plain ? "No general — the plain unit" : card.name}</span>
        <span className="swap-sub">
          {plain
            ? "The regiment on its own, as you first selected it."
            : `${card.commandStars ? `★${card.commandStars} command · ` : ""}${card.finalMen ?? "—"} men`}
        </span>
        {blockedReason && <span className="swap-block">{blockedReason}</span>}
      </span>
      <span className="swap-cost">
        <span className={`cost${overBudget && !current ? " over" : ""}`}>{card.cost.toLocaleString()}</span>
        <span className={`swap-delta${costDelta > 0 ? " up" : costDelta < 0 ? " down" : ""}`}>
          {current ? "Current" : delta}
        </span>
      </span>
    </button>
  );
}

/** Round portrait for a row. Deliberately not a Medallion: this one lives inside the
 *  row's own <button>, so it must be inert markup (no nested control) — and the row
 *  spells out the stats a medallion's badges would otherwise repeat. */
function Portrait({ card }: { card: UnitCard }) {
  const [failed, setFailed] = useState(false);
  const icon = assetUrl(card.icon);
  return (
    <span className="swap-portrait" aria-hidden>
      {icon && !failed ? (
        <img src={icon} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        <span className="swap-portrait-fallback">{classLabel(card.unitClass)}</span>
      )}
    </span>
  );
}
