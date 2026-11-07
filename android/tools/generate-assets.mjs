/**
 * Extracts the generated language data out of the TypeScript engine and writes
 * it as flat Android assets.
 *
 * The TS build ships its data as source modules because a Chrome extension has
 * no asset channel. Android does, so the 1.5 MB `dictionary-data.ts` becomes a
 * newline-separated list that `Dictionary.kt` streams straight into a HashSet
 * without a parser.
 *
 * Run: node android/tools/generate-assets.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..', '..');
const src = join(repo, 'src', 'engine', 'data');
const out = join(here, '..', 'app', 'src', 'main', 'assets');

mkdirSync(out, { recursive: true });

/* ----------------------------- dictionary ----------------------------- */

const dictSource = readFileSync(join(src, 'dictionary-data.ts'), 'utf8');
const words = [];
// Entries are one quoted string per line; apostrophes appear inside the quotes.
for (const match of dictSource.matchAll(/^\s*"((?:[^"\\]|\\.)*)",?\s*$/gm)) {
  words.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
}
if (words.length < 100_000) {
  throw new Error(`dictionary extraction produced only ${words.length} words`);
}
writeFileSync(join(out, 'dictionary.dict'), words.join('\n'), 'utf8');

/* ------------------------------ frequency ----------------------------- */

const freqSource = readFileSync(join(src, 'frequency-data.ts'), 'utf8');
const bands = [];
// [255, `word word word`] - the band value then a backtick-quoted word run.
for (const match of freqSource.matchAll(/\[\s*(\d+)\s*,\s*`([\s\S]*?)`\s*\]/g)) {
  const value = Number(match[1]);
  const bandWords = match[2].split(/\s+/u).filter(Boolean);
  if (bandWords.length > 0) bands.push([value, bandWords]);
}
if (bands.length === 0) throw new Error('frequency extraction produced no bands');

// One line per band: "<value>\t<space separated words>". A single split on the
// tab and one on whitespace is all the Kotlin side needs.
const freqLines = bands.map(([value, bandWords]) => `${value}\t${bandWords.join(' ')}`);
writeFileSync(join(out, 'frequency.dict'), freqLines.join('\n'), 'utf8');

/* -------------------------------- typos ------------------------------- */

const typoSource = readFileSync(join(src, 'typos.ts'), 'utf8');
const rawBlock = /const RAW = `([\s\S]*?)`;/.exec(typoSource);
if (!rawBlock) throw new Error('could not find the typo RAW block');

const typos = [];
const pairPattern = /(?:^|\s)([^:\s]+):(?:"([^"]+)"|([^\s]+))/g;
let pair;
while ((pair = pairPattern.exec(rawBlock[1])) !== null) {
  const key = pair[1];
  const value = pair[2] ?? pair[3] ?? '';
  if (key && value && key !== value) typos.push(`${key}\t${value}`);
}
if (typos.length === 0) throw new Error('typo extraction produced no pairs');
writeFileSync(join(out, 'typos.dict'), typos.join('\n'), 'utf8');

/* ------------------------------ confusions ---------------------------- */

/*
 * The confusion sets are a nested literal containing RegExp values, so they
 * cannot be JSON-parsed out of the source. `confusions.ts` imports nothing, so
 * the literal is valid JavaScript once the type annotation is dropped: write it
 * to a temporary module, import it, and serialise the real objects. That keeps
 * the Android copy provably identical to what the TypeScript engine ships.
 */
const confusionSource = readFileSync(join(src, 'confusions.ts'), 'utf8');
const literalStart = confusionSource.indexOf('export const CONFUSION_SETS');
const literalEnd = confusionSource.indexOf('\n];', literalStart);
if (literalStart < 0 || literalEnd < 0) throw new Error('could not find CONFUSION_SETS');

const literal = confusionSource
  .slice(literalStart, literalEnd + 3)
  .replace('export const CONFUSION_SETS: ConfusionSet[] =', 'export const CONFUSION_SETS =');

const tempModule = join(here, '.confusions.tmp.mjs');
writeFileSync(tempModule, literal, 'utf8');
const { CONFUSION_SETS } = await import(`file://${tempModule.replace(/\\/g, '/')}`);
rmSync(tempModule, { force: true });

// One line per member:
//   setId \t word \t prev,words \t next,words \t regex|regex
const confusionLines = [];
for (const set of CONFUSION_SETS) {
  for (const member of set.members) {
    const patterns = (member.patterns ?? []).map((p) => p.source).join('|||');
    confusionLines.push(
      [set.id, member.word, member.prev.join(' '), member.next.join(' '), patterns].join('\t'),
    );
  }
}
if (confusionLines.length === 0) throw new Error('confusion extraction produced no members');
writeFileSync(join(out, 'confusions.dict'), confusionLines.join('\n'), 'utf8');

/* ------------------------------- report ------------------------------- */

const totalFreqWords = bands.reduce((sum, [, bandWords]) => sum + bandWords.length, 0);
console.log(`dictionary.dict  ${words.length.toLocaleString()} words`);
console.log(`frequency.dict   ${bands.length} bands, ${totalFreqWords.toLocaleString()} words`);
console.log(`typos.dict       ${typos.length} pairs`);
console.log(`confusions.dict  ${CONFUSION_SETS.length} sets, ${confusionLines.length} members`);
