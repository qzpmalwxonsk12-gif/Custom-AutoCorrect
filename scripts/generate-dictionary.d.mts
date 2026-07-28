export interface ParsedWordList {
  words: string[];
  inputEntryCount: number;
  duplicateCount: number;
}

export interface DictionaryGenerationOptions {
  sourcePath?: string;
  readmePath?: string;
  dataOutputPath?: string;
  metadataOutputPath?: string;
  check?: boolean;
  validateProvenance?: boolean;
}

export interface DictionaryGenerationResult extends ParsedWordList {
  sourceSha256: string;
  contentSha256: string;
  dataBytes: number;
  metadataBytes: number;
}

export const DEFAULT_SOURCE_PATH: string;
export const DEFAULT_README_PATH: string;
export const DEFAULT_DATA_OUTPUT_PATH: string;
export const DEFAULT_METADATA_OUTPUT_PATH: string;

export function normaliseDictionaryEntry(value: string): string;
export function parseWordList(raw: string): ParsedWordList;
export function renderDictionaryData(words: readonly string[]): string;
export function renderDictionaryMetadata(
  words: readonly string[],
  details: {
    inputEntryCount: number;
    duplicateCount: number;
    sourceSha256: string;
    contentSha256: string;
  },
): string;
export function generateDictionary(
  options?: DictionaryGenerationOptions,
): Promise<DictionaryGenerationResult>;
