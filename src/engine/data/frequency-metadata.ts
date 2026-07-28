/**
 * GENERATED FILE - DO NOT EDIT.
 * Provenance for the bundled word-frequency table.
 */
export interface FrequencyMetadata {
  readonly sourceName: string;
  readonly sourceVersion: string;
  readonly sourceFile: string;
  readonly sourceRepository: string;
  readonly sourceCompiler: string;
  readonly underlyingCorpus: string;
  readonly sourceLicence: string;
  /** True when the ranking comes from measured corpus counts. */
  readonly corpusDerived: boolean;

  /* ---- complete accounting: every input line lands in exactly one bucket ---- */
  readonly inputEntryCount: number;
  /** Words kept after filtering to the bundled dictionary. */
  readonly wordCount: number;
  readonly absentFromDictionaryCount: number;
  readonly duplicateCount: number;
  readonly normalisationCollisionCount: number;
  readonly invalidCount: number;

  readonly bandCount: number;
  /** SHA-256 of the source list as downloaded. */
  readonly sourceSha256: string;
  /** SHA-256 of this generator's emitted data file. */
  readonly generatedSha256: string;
  /** Dictionary this table was generated against. */
  readonly dictionaryVersion: string;
  readonly dictionarySha256: string;
}

export const FREQUENCY_METADATA: FrequencyMetadata = Object.freeze({
  sourceName: "top_english_words_lower_50000.txt",
  sourceVersion: "50000",
  sourceFile: "vendor/frequency/en_common.txt",
  sourceRepository: "https://github.com/david47k/top-english-wordlists",
  sourceCompiler: "david47k",
  underlyingCorpus: "Google Books English Ngram corpus",
  sourceLicence: "See vendor/frequency/README.md",
  corpusDerived: true,
  inputEntryCount: 50000,
  wordCount: 40459,
  absentFromDictionaryCount: 8736,
  duplicateCount: 0,
  normalisationCollisionCount: 0,
  invalidCount: 805,
  bandCount: 7,
  sourceSha256: 'f9920c664b06b1ce3e94f2a355e11729774329f5838c623cc68e73ebaa374e1b',
  generatedSha256: '3ca21993f506c8320841af675542f2d97120e4fd65b1d8b5558965f462f87f34',
  dictionaryVersion: "2026.02.25",
  dictionarySha256: 'd2541bde8309b85c1b2821ed23e1c74ab5c63699542994bd64eb64818c0049c2',
});
