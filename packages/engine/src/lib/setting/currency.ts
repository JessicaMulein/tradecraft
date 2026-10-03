/**
 * Currency scaling of the Difficulty Preset and the scenario money fields at
 * preset resolution (content-expansion task 3.6; Req 9.6; design, "Currency").
 *
 * A City Pack sets its own money scale: Vienna's Schillings, Berlin's Marks and
 * Lisbon's Escudos are numerically very different from the slice's abstract
 * credits. Rather than carry several currencies through the ledger — which the
 * design forbids ("The ledger stays single-currency") — the generator scales
 * every money field *once*, at preset resolution, by the chosen city currency's
 * `budgetScale`, and rounds each scaled amount to the currency's `rounding`
 * step. From then on the game runs on one currency: the scaled integer amounts,
 * which the Locale's `formatMoney` renders in the city's voice.
 *
 * The design names the fields to scale: "every money field of the Difficulty
 * Preset and the scenario (starting Budget, funds base and cap, retainers,
 * pitch amounts)". This module owns the three pure pieces that do it:
 *
 * - {@link scaleMoney}, the single scale-and-round primitive every money field
 *   goes through;
 * - {@link scalePreset}, which returns a copy of a {@link DifficultyPreset} with
 *   its one money field (`startingBudget`) scaled; and
 * - {@link scaleMoneyPolicy}, which scales the scenario's money bundle (funds
 *   base and cap, the retainer amount and the pitch amount) in one call.
 *
 * Everything here is pure and total. The Core City's {@link
 * import('./locale-render.js').CORE_CITY_CURRENCY} has `budgetScale` 1 and
 * `rounding` 1, so scaling is the identity on the Core City and the slice's
 * money numbers are unchanged (the side-by-side guarantee, Req 10.1).
 */

import type { Currency, DifficultyPreset } from '@tradecraft/content';

/**
 * Round `amount` to the nearest multiple of `step`, ties away from zero. A
 * `step` of `0` or less leaves the amount unrounded. This matches the content
 * money formatter's own `roundToUnit`, so a scaled amount and the amount
 * `formatMoney` renders agree on the same rounding rule.
 */
function roundToStep(amount: number, step: number): number {
  if (step <= 0) {
    return amount;
  }
  const units = amount / step;
  const nearest = units < 0 ? -Math.round(-units) : Math.round(units);
  return nearest * step;
}

/**
 * Scale one money amount by the city currency's `budgetScale` and round it to
 * the currency's `rounding` step (Req 9.6). This is the single primitive every
 * money field is taken through at preset resolution, so a preset's starting
 * Budget and the scenario's funds and retainers all scale by the same rule.
 *
 * The Core City's currency has `budgetScale` 1 and `rounding` 1, so this is the
 * identity on an integer amount there — the slice's money numbers survive
 * unchanged.
 */
export function scaleMoney(amount: number, currency: Currency): number {
  return roundToStep(amount * currency.budgetScale, currency.rounding);
}

/**
 * Return a copy of a resolved {@link DifficultyPreset} with every money field
 * scaled to the chosen city currency (Req 9.6). The preset's only money field
 * is `startingBudget`; it is scaled through {@link scaleMoney}, and every other
 * field is carried through unchanged. Pure: the input preset is not mutated.
 *
 * The generator (task 3.8) calls this after resolving the preset from the
 * scenario and before building the Budget ledger, so the ledger opens with the
 * city-scaled starting Budget and stays single-currency from there.
 */
export function scalePreset(
  preset: DifficultyPreset,
  currency: Currency,
): DifficultyPreset {
  return {
    ...preset,
    startingBudget: scaleMoney(preset.startingBudget, currency),
  };
}

/**
 * The scenario's money bundle the generator scales alongside the preset
 * (design: "funds base and cap, retainers, pitch amounts"). These are the money
 * knobs the slice carries as constants rather than preset fields — the HQ funds
 * grant base and cap (`station/cables.ts`), the weekly retainer and the pitch
 * amount — gathered here so one call scales them all for the chosen city.
 */
export interface MoneyPolicy {
  /** The base HQ funds grant, before the Standing multiplier. */
  readonly fundsBase: number;
  /** The cap on a single funds grant. */
  readonly fundsCap: number;
  /** The weekly retainer an Asset is paid. */
  readonly retainer: number;
  /** The amount offered when pitching a money-motivated recruit. */
  readonly pitchAmount: number;
}

/**
 * Scale every field of a {@link MoneyPolicy} by the chosen city currency (Req
 * 9.6), returning a new policy. Each amount goes through {@link scaleMoney}, so
 * the whole bundle scales and rounds by the same rule as the preset's starting
 * Budget. Pure: the input policy is not mutated.
 */
export function scaleMoneyPolicy(
  policy: MoneyPolicy,
  currency: Currency,
): MoneyPolicy {
  return {
    fundsBase: scaleMoney(policy.fundsBase, currency),
    fundsCap: scaleMoney(policy.fundsCap, currency),
    retainer: scaleMoney(policy.retainer, currency),
    pitchAmount: scaleMoney(policy.pitchAmount, currency),
  };
}
