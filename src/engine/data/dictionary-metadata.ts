/**
 * GENERATED FILE - DO NOT EDIT.
 * Provenance and reproducibility metadata for the bundled ESDB dictionary.
 */
export interface DictionaryMetadata {
  readonly sourceName: string;
  readonly sourceVersion: string;
  readonly sourceVariant: string;
  readonly sourceSize: number;
  readonly sourceFile: string;
  readonly inputEntryCount: number;
  readonly wordCount: number;
  readonly duplicateCount: number;
  readonly minLength: number;
  readonly maxLength: number;
  readonly uniqueLengths: readonly number[];
  readonly bucketCount: number;
  readonly apostropheWordCount: number;
  readonly sourceSha256: string;
  readonly contentSha256: string;
}

export const DICTIONARY_METADATA: DictionaryMetadata = Object.freeze({
  sourceName: 'English Speller Database (SCOWL)',
  sourceVersion: '2026.02.25',
  sourceVariant: 'en_US',
  sourceSize: 60,
  sourceFile: 'vendor/esdb/en_US.txt',
  inputEntryCount: 109902,
  wordCount: 107901,
  duplicateCount: 2001,
  minLength: 1,
  maxLength: 23,
  uniqueLengths: Object.freeze([1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23]),
  bucketCount: 476,
  apostropheWordCount: 18761,
  sourceSha256: 'fe44d9ed8804beb4dfb78c10e1625e9a1f670f0b3074094c92e70bde6e6b0ac9',
  contentSha256: 'd2541bde8309b85c1b2821ed23e1c74ab5c63699542994bd64eb64818c0049c2',
});
