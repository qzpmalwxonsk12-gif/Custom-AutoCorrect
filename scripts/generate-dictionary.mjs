/**
 * Deterministically converts the vendored ESDB en_US size-60 word list into
 * TypeScript data. This script is intentionally dependency-free so the
 * extension build never needs the network.
 */
import { createHash } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const DEFAULT_SOURCE_PATH = path.join(root, 'vendor', 'esdb', 'en_US.txt');
export const DEFAULT_README_PATH = path.join(root, 'vendor', 'esdb', 'README_en_US.txt');
export const DEFAULT_DATA_OUTPUT_PATH = path.join(
  root,
  'src',
  'engine',
  'data',
  'dictionary-data.ts',
);
export const DEFAULT_METADATA_OUTPUT_PATH = path.join(
  root,
  'src',
  'engine',
  'data',
  'dictionary-metadata.ts',
);

const SOURCE_VERSION = '2026.02.25';
const SOURCE_VARIANT = 'en_US';
const SOURCE_SIZE = 60;
const EXPECTED_SOURCE_SHA256 = 'fe44d9ed8804beb4dfb78c10e1625e9a1f670f0b3074094c92e70bde6e6b0ac9';
const EXPECTED_WORD_COUNT = 107_901;
const UNICODE_APOSTROPHES = /[\u02bc\u2018\u2019\uff07]/gu;
const VALID_WORD = /^\p{L}[\p{L}\p{M}]*(?:'[\p{L}\p{M}]+)*$/u;

/**
 * Normalises one dictionary entry. All runtime lookup paths use the same
 * apostrophe representation and Unicode normalisation form.
 *
 * @param {string} value
 */
export function normaliseDictionaryEntry(value) {
  return value
    .trim()
    .normalize('NFC')
    .replace(UNICODE_APOSTROPHES, "'")
    .toLowerCase()
    .normalize('NFC');
}

/**
 * @param {string} raw
 * @returns {{
 *   words: string[];
 *   inputEntryCount: number;
 *   duplicateCount: number;
 * }}
 */
export function parseWordList(raw) {
  if (raw.includes('\0')) throw new Error('Dictionary source contains a NUL byte');

  const lines = raw.replace(/^\ufeff/u, '').replace(/\r\n?/gu, '\n').split('\n');
  const unique = new Set();
  let inputEntryCount = 0;

  for (let index = 0; index < lines.length; index++) {
    const value = normaliseDictionaryEntry(lines[index]);
    if (!value) continue;
    inputEntryCount++;
    if (!VALID_WORD.test(value)) {
      throw new Error(`Invalid dictionary entry on line ${index + 1}: ${JSON.stringify(value)}`);
    }
    unique.add(value);
  }

  if (inputEntryCount === 0) throw new Error('Dictionary source contains no words');
  const words = [...unique].sort();
  return {
    words,
    inputEntryCount,
    duplicateCount: inputEntryCount - words.length,
  };
}

/** @param {readonly string[]} words */
export function renderDictionaryData(words) {
  const body = words.map((word) => `  ${JSON.stringify(word)},`).join('\n');
  return `/**
 * GENERATED FILE - DO NOT EDIT.
 * Run \`npm run generate:dictionary\` after changing vendor/esdb/en_US.txt.
 */
export const DICTIONARY_WORDS: readonly string[] = [
${body}
];
`;
}

/**
 * @param {readonly string[]} words
 * @param {{
 *   inputEntryCount: number;
 *   duplicateCount: number;
 *   sourceSha256: string;
 *   contentSha256: string;
 * }} details
 */
export function renderDictionaryMetadata(words, details) {
  const lengths = [...new Set(words.map((word) => word.length))].sort((a, b) => a - b);
  const bucketKeys = new Set(words.map((word) => `${word.length}:${word[0]}`));
  const apostropheWordCount = words.reduce((count, word) => count + (word.includes("'") ? 1 : 0), 0);
  const minLength = lengths[0] ?? 0;
  const maxLength = lengths[lengths.length - 1] ?? 0;

  return `/**
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
  sourceVersion: '${SOURCE_VERSION}',
  sourceVariant: '${SOURCE_VARIANT}',
  sourceSize: ${SOURCE_SIZE},
  sourceFile: 'vendor/esdb/en_US.txt',
  inputEntryCount: ${details.inputEntryCount},
  wordCount: ${words.length},
  duplicateCount: ${details.duplicateCount},
  minLength: ${minLength},
  maxLength: ${maxLength},
  uniqueLengths: Object.freeze(${JSON.stringify(lengths)}),
  bucketCount: ${bucketKeys.size},
  apostropheWordCount: ${apostropheWordCount},
  sourceSha256: '${details.sourceSha256}',
  contentSha256: '${details.contentSha256}',
});
`;
}

/** @param {Buffer} bytes */
function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    throw new Error('Dictionary source is not valid UTF-8', { cause: error });
  }
}

/** @param {string | Buffer} input */
function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * @param {string} readme
 */
function validateDefaultProvenance(readme) {
  if (!readme.includes(`Version ${SOURCE_VERSION}`)) {
    throw new Error(`ESDB README does not identify version ${SOURCE_VERSION}`);
  }
  if (!/Wordlist Command:\s*mk-list\b[^\r\n]*\ben_US\s+60\s*$/mu.test(readme)) {
    throw new Error('ESDB README does not identify the en_US size-60 word list');
  }
}

/**
 * @param {string} target
 * @param {string} expected
 * @param {boolean} check
 */
async function emitFile(target, expected, check) {
  if (check) {
    let actual;
    try {
      actual = await readFile(target, 'utf8');
    } catch (error) {
      throw new Error(`Generated dictionary file is missing: ${path.relative(root, target)}`, {
        cause: error,
      });
    }
    if (actual !== expected) {
      throw new Error(
        `Generated dictionary file is stale: ${path.relative(root, target)}. ` +
          'Run npm run generate:dictionary.',
      );
    }
    return;
  }

  await mkdir(path.dirname(target), { recursive: true });
  let current;
  try {
    current = await readFile(target, 'utf8');
  } catch {
    current = undefined;
  }
  if (current !== expected) await writeFile(target, expected, 'utf8');
}

/**
 * @param {{
 *   sourcePath?: string;
 *   readmePath?: string;
 *   dataOutputPath?: string;
 *   metadataOutputPath?: string;
 *   check?: boolean;
 *   validateProvenance?: boolean;
 * }} [options]
 */
export async function generateDictionary(options = {}) {
  const sourcePath = options.sourcePath ?? DEFAULT_SOURCE_PATH;
  const readmePath = options.readmePath ?? DEFAULT_README_PATH;
  const dataOutputPath = options.dataOutputPath ?? DEFAULT_DATA_OUTPUT_PATH;
  const metadataOutputPath = options.metadataOutputPath ?? DEFAULT_METADATA_OUTPUT_PATH;
  const check = options.check ?? false;
  const validateProvenance = options.validateProvenance ?? sourcePath === DEFAULT_SOURCE_PATH;

  await access(sourcePath, fsConstants.R_OK).catch((error) => {
    throw new Error(`Required ESDB source is missing or unreadable: ${sourcePath}`, { cause: error });
  });

  const sourceBytes = await readFile(sourcePath);
  const sourceSha256 = sha256(sourceBytes);
  if (validateProvenance) {
    const readme = decodeUtf8(await readFile(readmePath));
    validateDefaultProvenance(readme);
    if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
      throw new Error(
        `Unexpected ESDB source hash: ${sourceSha256}; expected ${EXPECTED_SOURCE_SHA256}`,
      );
    }
  }

  const parsed = parseWordList(decodeUtf8(sourceBytes));
  if (validateProvenance && parsed.words.length !== EXPECTED_WORD_COUNT) {
    throw new Error(
      `Unexpected normalised word count: ${parsed.words.length}; expected ${EXPECTED_WORD_COUNT}`,
    );
  }

  const normalisedText = `${parsed.words.join('\n')}\n`;
  const contentSha256 = sha256(normalisedText);
  const data = renderDictionaryData(parsed.words);
  const metadata = renderDictionaryMetadata(parsed.words, {
    inputEntryCount: parsed.inputEntryCount,
    duplicateCount: parsed.duplicateCount,
    sourceSha256,
    contentSha256,
  });

  await Promise.all([
    emitFile(dataOutputPath, data, check),
    emitFile(metadataOutputPath, metadata, check),
  ]);

  return {
    ...parsed,
    sourceSha256,
    contentSha256,
    dataBytes: Buffer.byteLength(data),
    metadataBytes: Buffer.byteLength(metadata),
  };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  const unknown = process.argv.slice(2).filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    console.error(`[dictionary] unknown argument(s): ${unknown.join(', ')}`);
    process.exitCode = 1;
  } else {
    generateDictionary({ check: process.argv.includes('--check') })
      .then((result) => {
        const action = process.argv.includes('--check') ? 'verified' : 'generated';
        console.log(
          `[dictionary] ${action} ${result.words.length.toLocaleString('en-US')} words ` +
            `(${result.duplicateCount.toLocaleString('en-US')} duplicates removed, ` +
            `sha256 ${result.contentSha256})`,
        );
      })
      .catch((error) => {
        console.error('[dictionary] generation failed:', error);
        process.exitCode = 1;
      });
  }
}
