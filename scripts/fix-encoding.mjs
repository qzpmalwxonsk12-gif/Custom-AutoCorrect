/**
 * Repairs UTF-8 text that was round-tripped through a Windows-1252 read.
 *
 * With no explicit paths, the command scans supported project text recursively
 * while excluding dependencies, generated output, and generated reports.
 *
 *   node scripts/fix-encoding.mjs [...files]
 *   node scripts/fix-encoding.mjs --check
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const codePoints = (...values) => String.fromCodePoint(...values);

/** Longest sequences first, so a shorter prefix cannot consume a longer one. */
const REPLACEMENTS = [
  [codePoints(0x00e2, 0x2021, 0x201d), '⇔'], // double implication arrow
  [codePoints(0x00e2, 0x2020, 0x2019), '→'], // right arrow
  [codePoints(0x00e2, 0x2020, 0x201c), '↓'], // down arrow
  [codePoints(0x00e2, 0x20ac, 0x201c), '–'], // en dash
  [codePoints(0x00e2, 0x20ac, 0x201d), '—'], // em dash
  [codePoints(0x00e2, 0x20ac, 0x02dc), '‘'], // left single quote
  [codePoints(0x00e2, 0x20ac, 0x2122), '’'], // right single quote
  [codePoints(0x00e2, 0x20ac, 0x0153), '“'], // left double quote
  [codePoints(0x00e2, 0x20ac, 0x00a6), '…'], // ellipsis
  [codePoints(0x00e2, 0x20ac, 0x009d), '”'], // right double quote
  [codePoints(0x00e2, 0x20ac), '”'], // truncated right double quote
  [codePoints(0x00c3, 0x2014), '×'], // multiplication sign
  [codePoints(0x00c2, 0x00b7), '·'], // middle dot
  [codePoints(0x00c2, 0x00a0), ' '], // non-breaking space
];

const TEXT_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.ts',
  '.txt',
  '.yaml',
  '.yml',
]);

const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.qodo',
  'artifacts',
  'dist',
  'node_modules',
]);

const OPTIONS = new Set(['--check']);

async function projectTextFiles(directory = '.') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRECTORIES.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await projectTextFiles(target));
    } else if (
      entry.isFile()
      && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
    ) {
      files.push(target);
    }
  }
  return files.sort((left, right) => left.localeCompare(right, 'en'));
}

function displayPath(file) {
  return path.relative('.', file).replaceAll('\\', '/');
}

async function main() {
  const check = process.argv.includes('--check');
  const unknownOptions = process.argv.slice(2).filter(
    (argument) => argument.startsWith('--') && !OPTIONS.has(argument),
  );
  if (unknownOptions.length > 0) {
    throw new Error(`Unknown option(s): ${unknownOptions.join(', ')}`);
  }

  const args = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
  const explicitFiles = args.length > 0;
  const files = explicitFiles ? args : await projectTextFiles();

  let changed = 0;
  for (const file of files) {
    let text;
    try {
      text = await readFile(file, 'utf8');
    } catch {
      continue;
    }

    let fixed = text;
    for (const [bad, good] of REPLACEMENTS) fixed = fixed.split(bad).join(good);
    if (fixed === text) {
      if (explicitFiles) console.log(`[encoding] clean: ${displayPath(file)}`);
      continue;
    }

    changed++;
    if (check) {
      console.error(`[encoding] mojibake found in ${displayPath(file)}`);
      continue;
    }
    await writeFile(file, fixed, 'utf8');
    console.log(`[encoding] repaired: ${displayPath(file)}`);
  }

  if (!explicitFiles && changed === 0) {
    console.log(`[encoding] clean: ${files.length} project text files`);
  }
  if (check && changed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error('[encoding] failed:', error);
  process.exitCode = 1;
});
