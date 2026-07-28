/**
 * Generates the compact word-frequency table from a ranked source list.
 *
 * The source is a plain ranked list (most frequent first). This script filters
 * it to words the bundled dictionary actually knows, quantises rank into a
 * one-byte band, and emits two generated files plus their hashes.
 *
 *   node scripts/generate-frequency.mjs           regenerate
 *   node scripts/generate-frequency.mjs --check   verify the committed output
 *
 * `--check` is what `npm run check` runs: it fails when the generated file does
 * not match the source, so the committed data can never silently drift.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'vendor/frequency/en_common.txt');
const DATA_OUT = path.join(root, 'src/engine/data/frequency-data.ts');
const META_OUT = path.join(root, 'src/engine/data/frequency-metadata.ts');
const DICTIONARY_DATA = path.join(root, 'src/engine/data/dictionary-data.ts');
const DICTIONARY_META = path.join(root, 'src/engine/data/dictionary-metadata.ts');

/**
 * Quantised frequency bands.
 *
 * One byte, seven bands. Corpus rank is Zipf-distributed, so the difference
 * between rank 30,000 and 31,000 is meaningless while the difference between
 * rank 10 and rank 1,000 is enormous; banding by share of the ranked list keeps
 * the signal where the information actually is. It also means a corpus update
 * moves scores in visible steps rather than by amounts too small to evaluate.
 */
const BANDS = [
  { value: 255, label: 'extremely common', share: 0.02 },
  { value: 224, label: 'very common', share: 0.06 },
  { value: 192, label: 'common', share: 0.12 },
  { value: 160, label: 'fairly common', share: 0.2 },
  { value: 128, label: 'ordinary', share: 0.25 },
  { value: 96, label: 'less common', share: 0.2 },
  { value: 64, label: 'uncommon', share: 0.15 },
];

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Parses the ranked source with complete accounting.
 *
 * Every input line lands in exactly one bucket. Silently dropping entries hid
 * 805 of 50,000 the first time this ran, and "where did the rest go" is not a
 * question a build script should leave open.
 */
function parseSource(raw) {
  const seen = new Map();
  const words = [];
  const counts = {
    inputEntries: 0,
    empty: 0,
    invalid: 0,
    duplicates: 0,
    normalisationCollisions: 0,
  };
  const samples = { invalid: [], duplicates: [], normalisationCollisions: [] };
  const keep = (list, value) => {
    if (list.length < 12) list.push(value);
  };

  for (const line of raw.split(/\r?\n/)) {
    // A trailing newline is not an entry.
    if (line.length === 0 && counts.inputEntries === 0) continue;
    const trimmed = line.trim();
    if (!trimmed) {
      // Only count a blank line as an entry if content follows it; a trailing
      // blank line is file formatting, not data.
      counts.empty++;
      continue;
    }
    if (trimmed.startsWith('#')) continue;
    counts.inputEntries++;

    // A `word<TAB>count` form is accepted so a corpus export needs no editing.
    const raw0 = trimmed.split(/[\s,]+/)[0];
    const word = raw0.toLowerCase();

    if (!/^[a-z]+(?:'[a-z]+)*$/.test(word)) {
      counts.invalid++;
      keep(samples.invalid, raw0);
      continue;
    }
    const previous = seen.get(word);
    if (previous !== undefined) {
      // Distinguish "the same string twice" from "two different strings that
      // normalise to one" - they say different things about the source.
      if (previous === raw0) {
        counts.duplicates++;
        keep(samples.duplicates, raw0);
      } else {
        counts.normalisationCollisions++;
        keep(samples.normalisationCollisions, `${previous} / ${raw0}`);
      }
      continue;
    }
    seen.set(word, raw0);
    words.push(word);
  }

  // Blank lines inside the data are entries that produced nothing; a trailing
  // newline is not. Fold the former into `invalid` so the invariant holds.
  counts.invalid += counts.empty > 0 ? counts.empty - 1 : 0;
  if (counts.empty > 0) counts.inputEntries += counts.empty - 1;

  return { words, counts, samples };
}

async function dictionaryWords() {
  const source = await readFile(DICTIONARY_DATA, 'utf8');
  const words = new Set();
  for (const match of source.matchAll(/"((?:[^"\\]|\\.)*)"/g)) {
    words.add(match[1].replace(/\\'/g, "'"));
  }
  return words;
}

async function dictionaryVersion() {
  const source = await readFile(DICTIONARY_META, 'utf8');
  const content = /contentSha256:\s*'([0-9a-f]+)'/.exec(source)?.[1] ?? 'unknown';
  const version = /sourceVersion:\s*'([^']+)'/.exec(source)?.[1] ?? 'unknown';
  return { content, version };
}

function assignBands(words) {
  const bands = BANDS.map((band) => ({ ...band, words: [] }));
  let index = 0;
  for (let b = 0; b < bands.length; b++) {
    const isLast = b === bands.length - 1;
    const count = isLast
      ? words.length - index
      : Math.round(words.length * bands[b].share);
    for (let i = 0; i < count && index < words.length; i++, index++) {
      bands[b].words.push(words[index]);
    }
  }
  return bands.filter((band) => band.words.length > 0);
}

/** Wraps a word list into fixed-width lines so the generated file stays diffable. */
function wrap(words, width = 84) {
  const lines = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > width) {
      lines.push(line);
      line = '';
    }
    line += (line ? ' ' : '') + word;
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

function renderData(bands) {
  const entries = bands
    .map(
      (band) =>
        `  // ${band.label} (${band.words.length})\n`
        + `  [${band.value}, \`\n${wrap(band.words)}\n\`],`,
    )
    .join('\n');
  return `/**
 * GENERATED FILE - DO NOT EDIT.
 * Run \`npm run generate:frequency\` to rebuild from vendor/frequency/en_common.txt.
 *
 * Words are grouped into quantised bands rather than stored as one object per
 * word: a packed string costs a single allocation at parse time, where an
 * object literal of tens of thousands of entries would not.
 */

/** [bandValue, whitespace-separated words] */
export const FREQUENCY_BANDS: readonly (readonly [number, string])[] = [
${entries}
];
`;
}

function renderMeta(meta) {
  return `/**
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
  sourceName: ${JSON.stringify(meta.sourceName)},
  sourceVersion: ${JSON.stringify(meta.sourceVersion)},
  sourceFile: ${JSON.stringify(meta.sourceFile)},
  sourceRepository: ${JSON.stringify(meta.sourceRepository)},
  sourceCompiler: ${JSON.stringify(meta.sourceCompiler)},
  underlyingCorpus: ${JSON.stringify(meta.underlyingCorpus)},
  sourceLicence: ${JSON.stringify(meta.sourceLicence)},
  corpusDerived: ${meta.corpusDerived},
  inputEntryCount: ${meta.inputEntryCount},
  wordCount: ${meta.wordCount},
  absentFromDictionaryCount: ${meta.absentFromDictionaryCount},
  duplicateCount: ${meta.duplicateCount},
  normalisationCollisionCount: ${meta.normalisationCollisionCount},
  invalidCount: ${meta.invalidCount},
  bandCount: ${meta.bandCount},
  sourceSha256: '${meta.sourceSha256}',
  generatedSha256: '${meta.generatedSha256}',
  dictionaryVersion: ${JSON.stringify(meta.dictionaryVersion)},
  dictionarySha256: '${meta.dictionarySha256}',
});
`;
}

async function main() {
  const check = process.argv.includes('--check');
  const raw = await readFile(SOURCE, 'utf8');
  const { words: sourceWords, counts, samples } = parseSource(raw);
  const known = await dictionaryWords();
  const dictionary = await dictionaryVersion();

  const kept = sourceWords.filter((word) => known.has(word));
  const absent = sourceWords.length - kept.length;
  const bands = assignBands(kept);

  const data = renderData(bands);
  const generatedSha256 = sha256(data);
  const meta = renderMeta({
    sourceName: 'top_english_words_lower_50000.txt',
    sourceVersion: '50000',
    sourceFile: 'vendor/frequency/en_common.txt',
    sourceRepository: 'https://github.com/david47k/top-english-wordlists',
    sourceCompiler: 'david47k',
    underlyingCorpus: 'Google Books English Ngram corpus',
    sourceLicence: 'See vendor/frequency/README.md',
    corpusDerived: true,
    inputEntryCount: counts.inputEntries,
    wordCount: kept.length,
    absentFromDictionaryCount: absent,
    duplicateCount: counts.duplicates,
    normalisationCollisionCount: counts.normalisationCollisions,
    invalidCount: counts.invalid,
    bandCount: bands.length,
    sourceSha256: sha256(raw),
    generatedSha256,
    dictionaryVersion: dictionary.version,
    dictionarySha256: dictionary.content,
  });

  // The invariant: every input line is accounted for exactly once.
  const accounted =
    kept.length + absent + counts.duplicates + counts.normalisationCollisions + counts.invalid;
  if (accounted !== counts.inputEntries) {
    console.error(
      `[frequency] accounting mismatch: ${accounted} categorised but `
        + `${counts.inputEntries} entries read`,
    );
    process.exitCode = 1;
    return;
  }

  const summary = () => {
    console.log(`[frequency] input entries          ${String(counts.inputEntries).padStart(6)}`);
    console.log(`[frequency]   accepted             ${String(kept.length).padStart(6)}`);
    console.log(`[frequency]   absent from ESDB     ${String(absent).padStart(6)}`);
    console.log(`[frequency]   duplicates           ${String(counts.duplicates).padStart(6)}`);
    console.log(
      `[frequency]   normalisation clash  ${String(counts.normalisationCollisions).padStart(6)}`,
    );
    console.log(`[frequency]   invalid or filtered  ${String(counts.invalid).padStart(6)}`);
    console.log(`[frequency] bands ${bands.length}, source sha256 ${sha256(raw).slice(0, 16)}...`);
    console.log(`[frequency] generated sha256 ${generatedSha256.slice(0, 16)}...`);
    for (const [name, list] of Object.entries(samples)) {
      if (list.length > 0) console.log(`[frequency]   e.g. ${name}: ${list.slice(0, 6).join(', ')}`);
    }
  };

  if (check) {
    const [currentData, currentMeta] = await Promise.all([
      readFile(DATA_OUT, 'utf8').catch(() => ''),
      readFile(META_OUT, 'utf8').catch(() => ''),
    ]);
    if (currentData !== data || currentMeta !== meta) {
      console.error(
        '[frequency] generated files are out of date; run `npm run generate:frequency`',
      );
      process.exitCode = 1;
      return;
    }
    console.log(
      `[frequency] verified ${kept.length} words in ${bands.length} bands `
        + `(${counts.inputEntries} source entries fully accounted for)`,
    );
    return;
  }

  await writeFile(DATA_OUT, data, 'utf8');
  await writeFile(META_OUT, meta, 'utf8');
  summary();
}

main().catch((error) => {
  console.error('[frequency] failed:', error);
  process.exitCode = 1;
});
