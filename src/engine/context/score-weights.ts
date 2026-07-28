/**
 * Weights for every context score term.
 *
 * Each new signal ships at **zero**. That is the whole rollout policy in one
 * object: a term can be implemented, tested, diagnosed and compared in shadow
 * mode while contributing exactly nothing to what the user sees, and turning it
 * on is a one-line change with a measurable before and after.
 *
 * `editOperation` is 1 because it is not new - it is the existing operation-cost
 * and similarity score, which already decides every correction today.
 */
export interface ScoreWeights {
  /** The existing candidate-generation score. Not a new signal. */
  editOperation: number;
  /** Quantised word frequency (Stage 1). */
  frequency: number;
  /** Part of speech either side of the target (Stage 3). */
  partOfSpeech: number;
  /** Previous/next word compatibility (Stage 3). */
  wordContext: number;
  /** Position in the sentence (Stage 3). */
  sentencePosition: number;
  /** The candidate already appears elsewhere in this document (Stage 3). */
  documentReuse: number;
  /** Personal accept/reject history for this pair in this context (Stage 3). */
  personalHistory: number;
  /** The candidate completes a known short phrase (Stage 3). */
  knownPhrase: number;
  /** Character bigram/trigram plausibility (Stage 3). */
  characterContext: number;
}

/**
 * The frequency weight chosen after measurement.
 *
 * Swept at 0.02, 0.04, 0.06, 0.08 and 0.10 over UD English EWT with a fixed
 * seed, so the only variable was the weight:
 *
 *   0.02   20 better,  2 worse
 *   0.04   30 better,  2 worse   <- chosen
 *   0.06   33 better,  3 worse
 *   0.08   36 better,  3 worse
 *   0.10   37 better,  3 worse
 *
 * 0.04 captures 81% of the maximum measured gain while avoiding the third
 * regression entirely: "mastter" resolves to "master" at 0.04 and flips to
 * "matter" at 0.06, where the frequency gap (255 vs 224) finally overcomes
 * duplicate-letter evidence. Zero cost overrides and zero automatic/suggestion
 * changes at every weight tested.
 *
 * Higher weights buy 6 more improvements at the price of a regression on a
 * doubled-letter typo, which is the single most recognisable kind. Not worth it.
 */
export const FREQUENCY_WEIGHT = 0.04;

/**
 * Production weights.
 *
 * Every context term except frequency is zero. Raising one is a deliberate act
 * that must be justified by measured evidence, recorded in
 * `docs/CONTEXT-ENGINE.md`.
 */
export const DEFAULT_WEIGHTS: ScoreWeights = Object.freeze({
  editOperation: 1,
  frequency: FREQUENCY_WEIGHT,
  partOfSpeech: 0,
  wordContext: 0,
  sentencePosition: 0,
  documentReuse: 0,
  personalHistory: 0,
  knownPhrase: 0,
  characterContext: 0,
});

/**
 * Weights used by the shadow comparison, so the experimental ranking can be
 * recorded without touching production behaviour.
 */
export const EXPERIMENTAL_WEIGHTS: ScoreWeights = Object.freeze({
  ...DEFAULT_WEIGHTS,
  // The signals under evaluation. Frequency has been measured and shipped;
  // these are what shadow mode compares against production on real writing.
  documentReuse: 0.02,
  sentencePosition: 0.01,
});

/** Every term set to zero, used to prove a weight change is what moved a result. */
export const NO_CONTEXT_WEIGHTS: ScoreWeights = Object.freeze({
  ...DEFAULT_WEIGHTS,
});

/**
 * True when no *unmeasured* context signal is contributing.
 *
 * Frequency is excluded: it has been measured and shipped, so its presence is
 * not the thing this predicate is asking about.
 */
export function isNeutral(weights: ScoreWeights): boolean {
  return (
    weights.partOfSpeech === 0
    && weights.wordContext === 0
    && weights.sentencePosition === 0
    && weights.documentReuse === 0
    && weights.personalHistory === 0
    && weights.knownPhrase === 0
    && weights.characterContext === 0
  );
}
