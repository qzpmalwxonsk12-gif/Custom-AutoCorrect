/**
 * Generates the compact character-bigram table.
 *
 * Input is a plain `XX count` list of the 676 letter pairs. Counts span six
 * orders of magnitude, so they are stored as a **log-scaled byte** rather than
 * as raw numbers: the ranking question is "is this pair ordinary or strange?",
 * and a linear scale would make everything except TH and HE indistinguishable.
 *
 *   node scripts/generate-bigrams.mjs           regenerate
 *   node scripts/generate-bigrams.mjs --check   verify the committed output
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(root, 'vendor/character-ngrams/en_bigrams.txt');
const OUT = path.join(root, 'src/engine/data/bigram-data.ts');

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

function parse(raw) {
  const counts = new Map();
  let entries = 0;
  let invalid = 0;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    entries++;
    const match = /^([A-Za-z]{2})\s+(\d+)$/.exec(trimmed);
    if (!match) {
      invalid++;
      continue;
    }
    counts.set(match[1].toLowerCase(), Number(match[2]));
  }
  return { counts, entries, invalid };
}

async function main() {
  const check = process.argv.includes('--check');
  const raw = await readFile(SOURCE, 'utf8');
  const { counts, entries, invalid } = parse(raw);

  const values = [...counts.values()].filter((v) => v > 0);
  const maxLog = Math.log(Math.max(...values) + 1);
  const minLog = Math.log(Math.min(...values) + 1);

  /*
   * A pair the source never lists is not impossible, only unattested. It gets
   * 0, and the scorer treats 0 as "no evidence" rather than as a veto - this
   * signal must never prune a candidate.
   */
  const bytes = [];
  for (const first of LETTERS) {
    for (const second of LETTERS) {
      const count = counts.get(first + second) ?? 0;
      if (count <= 0) {
        bytes.push(0);
        continue;
      }
      const scaled = (Math.log(count + 1) - minLog) / (maxLog - minLog);
      // 1..255, so an attested pair is never confused with an unattested one.
      bytes.push(Math.max(1, Math.min(255, Math.round(scaled * 254) + 1)));
    }
  }

  const encoded = Buffer.from(Uint8Array.from(bytes)).toString('base64');
  const content = `/**
 * GENERATED FILE - DO NOT EDIT.
 * Run \`npm run generate:bigrams\` to rebuild from
 * vendor/character-ngrams/en_bigrams.txt.
 *
 * A 26x26 table of log-scaled letter-pair plausibility, base64-encoded so it
 * costs one small string rather than 676 object properties. Index is
 * \`first * 26 + second\` over 'a'..'z'. Zero means the pair is unattested in
 * the source, which is weak evidence of strangeness - never a veto.
 */

export const BIGRAM_TABLE_BASE64 =
  '${encoded}';

export const BIGRAM_METADATA = Object.freeze({
  sourceFile: 'vendor/character-ngrams/en_bigrams.txt',
  sourceEntries: ${entries},
  invalidEntries: ${invalid},
  distinctPairs: ${counts.size},
  attestedPairs: ${bytes.filter((b) => b > 0).length},
  tableSize: ${bytes.length},
  scale: 'log',
  sourceSha256: '${sha256(raw)}',
});
`;

  if (check) {
    const current = await readFile(OUT, 'utf8').catch(() => '');
    if (current !== content) {
      console.error('[bigrams] generated file is out of date; run `npm run generate:bigrams`');
      process.exitCode = 1;
      return;
    }
    console.log(
      `[bigrams] verified ${counts.size} pairs, ${bytes.filter((b) => b > 0).length} attested`,
    );
    return;
  }

  await writeFile(OUT, content, 'utf8');
  console.log(
    `[bigrams] wrote ${counts.size} distinct pairs from ${entries} entries `
      + `(${invalid} invalid), ${bytes.filter((b) => b > 0).length}/676 attested`,
  );
}

main().catch((error) => {
  console.error('[bigrams] failed:', error);
  process.exitCode = 1;
});
