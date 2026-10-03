/**
 * Judge scoring for the model evaluation harness (task 23.3; Req 18.3): the
 * fixed dialogue and narration rubrics ({@link DIALOGUE_RUBRIC},
 * {@link NARRATION_RUBRIC}), the structured verdict schema the judge model
 * returns, and the scorer that grades a reply/narration against the rubric,
 * records the judge model's identity, and warns when the judge is the same
 * model as `voice`.
 */

export {
  DIALOGUE_RUBRIC,
  NARRATION_RUBRIC,
  RUBRICS,
  RUBRIC_KINDS,
  SCORE_MAX,
  SCORE_MIN,
  rubricForRole,
  type Rubric,
  type RubricCriterion,
  type RubricKind,
} from './rubric.js';

export {
  JudgeCriterionScoreSchema,
  JudgeVerdictSchema,
  buildJudgePrompt,
  gatewayJudgeScorer,
  judgeIdentity,
  sameAsVoiceWarning,
  scoreWithJudge,
  type JudgeCriterionScore,
  type JudgeIdentity,
  type JudgeInput,
  type JudgeResult,
  type JudgeScore,
  type JudgeScorer,
  type JudgeVerdict,
  type ScoreOptions,
} from './judge.js';
