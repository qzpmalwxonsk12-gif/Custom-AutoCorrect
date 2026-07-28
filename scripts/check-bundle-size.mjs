/**
 * Bundle-size budget.
 *
 * Every asset that ships is measured against a ceiling and the build fails when
 * one is exceeded. The point is not the exact numbers - it is that adding data
 * (a frequency corpus, character n-grams, a model) becomes a visible, deliberate
 * decision instead of a slow drift nobody notices until the extension is 40 MB.
 *
 *   node scripts/check-bundle-size.mjs            check against the budget
 *   node scripts/check-bundle-size.mjs --report   print sizes and exit 0
 */
import { readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

const KB = 1024;

/**
 * Ceilings in kilobytes.
 *
 * `contentScript` is the one that matters most: it is parsed on every page with
 * an editable field, in every frame. The dictionary dominates it today, which is
 * exactly why a frequency table or an n-gram index must not simply be appended.
 */
const BUDGET = [
  /*
   * Raised from 1,600 to 1,800 kB when the 50,000-entry corpus frequency table
   * replaced the 1,407-word bootstrap.
   *
   * Measured: the generated table is 345 kB and adds 337 kB to this bundle
   * (1,398.7 -> 1,735.7). The data is needed for the frequency signal to work
   * at all, and it is already compactly encoded as banded packed strings.
   *
   * It is, however, a duplicate: all 40,459 words are also in the 1,522 kB
   * dictionary that ships in the same bundle. Encoding bands as an array
   * indexed by dictionary position would remove that duplication entirely.
   * Recorded as a limitation in docs/CONTEXT-ENGINE.md rather than done now,
   * because it needs a word->index map and a coordinated runtime/data-format
   * migration.
   */
  { name: 'contentScript', label: 'Content script JS', limit: 1_800, paths: ['content/content-script.js'] },
  { name: 'serviceWorker', label: 'Service worker JS', limit: 1_800, paths: ['background/service-worker.js'] },
  /* Same +337 kB, for the same reason: the self-test page runs the real engine. */
  { name: 'ui', label: 'Panel + popup + options + diagnostics', limit: 2_100,
    paths: ['side-panel', 'popup', 'options', 'diagnostics'] },
  /*
   * Harper is 17.8 MB, which is roughly 80% of the whole unpacked extension.
   * The ceiling is set just above the measured size rather than at some
   * aspirational number, so a future Harper upgrade that doubles it is a build
   * failure and a conversation rather than a surprise.
   */
  { name: 'harper', label: 'Harper WASM', limit: 20_000, paths: ['vendor/harper'] },
  /*
   * Nothing here yet. A ~10M-parameter INT8 model plus an ONNX runtime is
   * roughly 12-15 MB, which is why the ceiling is where it is - and why the
   * model must be loaded lazily rather than bundled into any JS entry point.
   */
  { name: 'model', label: 'AI model assets', limit: 20_000, paths: ['vendor/model'] },
  { name: 'total', label: 'Total unpacked', limit: 46_000, paths: ['.'] },
];

async function sizeOf(relative) {
  const target = path.join(dist, relative);
  if (!existsSync(target)) return 0;
  const info = await stat(target);
  if (info.isFile()) return info.size;

  let total = 0;
  for (const entry of await readdir(target, { withFileTypes: true })) {
    total += await sizeOf(path.join(relative, entry.name));
  }
  return total;
}

async function main() {
  const report = process.argv.includes('--report');
  if (!existsSync(dist)) {
    console.error('[bundle] dist/ not found; run the build first');
    process.exitCode = 1;
    return;
  }

  const rows = [];
  for (const entry of BUDGET) {
    let bytes = 0;
    for (const relative of entry.paths) bytes += await sizeOf(relative);
    rows.push({ ...entry, kb: bytes / KB });
  }

  const width = Math.max(...rows.map((row) => row.label.length));
  const failures = [];
  for (const row of rows) {
    const over = row.kb > row.limit;
    if (over) failures.push(row);
    const pct = row.limit > 0 ? Math.round((row.kb / row.limit) * 100) : 0;
    console.log(
      `[bundle] ${row.label.padEnd(width)}  ${row.kb.toFixed(1).padStart(9)} kB `
        + `/ ${String(row.limit).padStart(6)} kB  ${String(pct).padStart(3)}%`
        + (over ? '  OVER BUDGET' : ''),
    );
  }

  if (report) return;
  if (failures.length > 0) {
    console.error(
      `[bundle] ${failures.length} budget(s) exceeded: `
        + failures.map((row) => row.name).join(', '),
    );
    console.error(
      '[bundle] raise the ceiling in scripts/check-bundle-size.mjs only with a '
        + 'reason recorded in docs/CONTEXT-ENGINE.md',
    );
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('[bundle] failed:', error);
  process.exitCode = 1;
});
