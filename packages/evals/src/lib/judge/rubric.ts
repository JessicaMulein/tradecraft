/**
 * The fixed judge rubric (task 23.3; Req 18.3).
 *
 * Req 18.3 asks the harness to "score in-character quality with the `judge` role
 * against a fixed rubric". *Fixed* is the operative word: the rubric is
 * deterministic data defined here once, the SAME criteria and the SAME bounded
 * scale on every run, so a judge score is comparable across models and across
 * days. A model is scored against a rubric; the rubric is never regenerated,
 * sampled or model-authored.
 *
 * There are two rubric *variants* because the two things the harness grades are
 * different work:
 *
 *   - the **dialogue** rubric grades a `voice` reply — an officer or NPC line
 *     voiced in character under pressure (a mole holding cover, a target
 *     weighing a pitch, a Dangle feeding chickenfeed);
 *   - the **narration** rubric grades `narrator` output — prose describing an
 *     observed situation (a surveillance result), where the test is fidelity to
 *     the facts rather than character.
 *
 * Each variant is a list of named {@link RubricCriterion}s, each scored on the
 * same bounded integer scale ({@link SCORE_MIN}..{@link SCORE_MAX}). The scale
 * is small on purpose: a judge model distinguishes "poor / weak / adequate /
 * good / excellent" far more reliably than a 0–100 number, and a small scale
 * keeps the aggregate legible in a report (23.4).
 *
 * These criteria restate, as scoreable prose, the dialogue and narrator
 * contracts the mechanical guards (23.2) enforce structurally. The guards catch
 * a hard leak or an invented specific; the judge grades the softer qualities a
 * guard cannot — whether a reply is *plausibly in character*, whether it
 * *answers the player*, whether narration carries *atmosphere* without
 * inventing an entity. The two are complementary: a reply can pass every guard
 * and still be a flat, evasive non-answer, and that is what the judge is for.
 */

/** The inclusive low end of every rubric criterion's score scale. */
export const SCORE_MIN = 1;

/** The inclusive high end of every rubric criterion's score scale. */
export const SCORE_MAX = 5;

/** Which rubric variant applies — chosen by the Model Role being graded. */
export const RUBRIC_KINDS = ['dialogue', 'narration'] as const;

/** One of the two {@link RUBRIC_KINDS}. */
export type RubricKind = (typeof RUBRIC_KINDS)[number];

/**
 * One fixed, named criterion. `id` is the stable key a {@link JudgeScore} and a
 * report key on; `title` and `description` are the human text the judge model is
 * shown and the report prints. The whole thing is frozen data — a criterion is
 * never built from a model response.
 */
export interface RubricCriterion {
  /** Stable key, unique within its rubric variant (e.g. `in-character`). */
  readonly id: string;
  /** Short human title shown in the prompt and the report. */
  readonly title: string;
  /** What a high score means — the instruction the judge grades against. */
  readonly description: string;
}

/**
 * A fixed rubric variant: its {@link RubricKind} and its ordered criteria. The
 * scale bounds are carried on the rubric too so a prompt builder and a report
 * read them from one place.
 */
export interface Rubric {
  /** Which variant this is. */
  readonly kind: RubricKind;
  /** The inclusive low end of the scale (equals {@link SCORE_MIN}). */
  readonly scoreMin: number;
  /** The inclusive high end of the scale (equals {@link SCORE_MAX}). */
  readonly scoreMax: number;
  /** The ordered, named criteria — the whole of what this variant grades. */
  readonly criteria: readonly RubricCriterion[];
}

/**
 * The fixed dialogue rubric: how a `voice` reply is graded. The criteria name
 * the qualities a lying officer / a weighed target / a baiting Dangle must show,
 * restating the dialogue contract (Req 5) as scoreable prose:
 *
 *   - **in-character** — the reply reads as the person speaking (their role,
 *     stance and pressure), not as a model narrating or breaking frame;
 *   - **no-leak** — the reply reveals no concealed fact and invents no
 *     operational specific the speaker could not know (the soft side of the
 *     Leak and Specifics guards);
 *   - **plausibility** — what is said is internally consistent and credible for
 *     the scene, not self-contradictory or absurd;
 *   - **responsiveness** — the reply actually engages the player's line rather
 *     than deflecting into a canned non-answer.
 */
export const DIALOGUE_RUBRIC: Rubric = {
  kind: 'dialogue',
  scoreMin: SCORE_MIN,
  scoreMax: SCORE_MAX,
  criteria: [
    {
      id: 'in-character',
      title: 'In character',
      description:
        'The reply reads as the person speaking — their role, stance and the ' +
        'pressure they are under — and never breaks frame to narrate, explain ' +
        'itself as a model, or address the player out of character.',
    },
    {
      id: 'no-leak',
      title: 'No leaks or invented specifics',
      description:
        'The reply reveals no concealed fact the speaker is holding and ' +
        'invents no operational specific (a name, time, place or figure) the ' +
        'speaker could not actually know.',
    },
    {
      id: 'plausibility',
      title: 'Plausibility',
      description:
        'What is said is internally consistent and credible for the scene — ' +
        'not self-contradictory, not absurd, and consistent with how such a ' +
        'person would speak under the circumstances.',
    },
    {
      id: 'responsiveness',
      title: 'Responsiveness to the player line',
      description:
        'The reply actually engages what the player just said — answering, ' +
        'parrying or redirecting it with intent — rather than ignoring it or ' +
        'returning a canned non-answer.',
    },
  ],
};

/**
 * The fixed narration rubric: how `narrator` output is graded. The criteria name
 * what Flavour prose owes the observed facts, restating the Narrator contract
 * (Req 7) as scoreable prose:
 *
 *   - **fidelity** — the narration describes only what was actually observed,
 *     adding nothing the facts do not support;
 *   - **atmosphere** — the prose carries mood and texture (the point of
 *     Flavour) rather than reading as a flat log line;
 *   - **no-invention** — the narration introduces no entity, person or object
 *     that is not in the observed situation (the soft side of the Leak Guard
 *     for narration).
 */
export const NARRATION_RUBRIC: Rubric = {
  kind: 'narration',
  scoreMin: SCORE_MIN,
  scoreMax: SCORE_MAX,
  criteria: [
    {
      id: 'fidelity',
      title: 'Fidelity to observed facts',
      description:
        'The narration describes only what was actually observed in the ' +
        'situation, adding no claim or detail the facts do not support.',
    },
    {
      id: 'atmosphere',
      title: 'Atmosphere',
      description:
        'The prose carries mood and texture appropriate to the scene rather ' +
        'than reading as a flat, mechanical log line.',
    },
    {
      id: 'no-invention',
      title: 'No invented entities',
      description:
        'The narration introduces no person, object or place that is not part ' +
        'of the observed situation.',
    },
  ],
};

/** Both fixed rubric variants, keyed by {@link RubricKind}. */
export const RUBRICS: Readonly<Record<RubricKind, Rubric>> = {
  dialogue: DIALOGUE_RUBRIC,
  narration: NARRATION_RUBRIC,
};

/**
 * The rubric variant for a Model Role: a `voice` reply is graded with the
 * dialogue rubric, `narrator` output with the narration rubric. This is the
 * single mapping the scorer uses to pick a rubric from the role a fixture `say`
 * step routed to.
 */
export function rubricForRole(role: 'voice' | 'narrator'): Rubric {
  return role === 'narrator' ? NARRATION_RUBRIC : DIALOGUE_RUBRIC;
}
