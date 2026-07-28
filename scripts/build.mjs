/**
 * Build script: bundles the extension into ./dist with esbuild.
 *
 * Content scripts must be IIFE (no ESM in content script world).
 * Service worker / side panel / popup / options are ESM.
 *
 * Usage: node scripts/build.mjs [--watch] [--dev]
 */
import * as esbuild from 'esbuild';
import { mkdir, copyFile, readdir, writeFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeIcon } from './make-icons.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/** @type {Array<{entry: string, out: string, format: 'iife'|'esm', external?: string[]}>} */
const bundles = [
  {
    entry: 'src/background/service-worker.ts',
    out: 'background/service-worker.js',
    format: 'esm',
    // harper.js's glue has a Node-only `import("fs")` fallback behind a
    // `typeof process !== 'undefined' && file://` guard - dead code in the
    // extension. External keeps esbuild from trying to resolve it.
    external: ['fs'],
  },
  { entry: 'src/content/content-script.ts', out: 'content/content-script.js', format: 'iife' },
  { entry: 'src/side-panel/side-panel.ts', out: 'side-panel/side-panel.js', format: 'esm' },
  { entry: 'src/popup/popup.ts', out: 'popup/popup.js', format: 'esm' },
  { entry: 'src/options/options.ts', out: 'options/options.js', format: 'esm' },
  { entry: 'src/diagnostics/diagnostics.ts', out: 'diagnostics/diagnostics.js', format: 'esm' },
  { entry: 'src/diagnostics/self-test.ts', out: 'diagnostics/self-test.js', format: 'esm' },
];

const staticFiles = [
  ['manifest.json', 'manifest.json'],
  ['src/side-panel/side-panel.html', 'side-panel/side-panel.html'],
  ['src/side-panel/side-panel.css', 'side-panel/side-panel.css'],
  ['src/popup/popup.html', 'popup/popup.html'],
  ['src/popup/popup.css', 'popup/popup.css'],
  ['src/options/options.html', 'options/options.html'],
  ['src/options/options.css', 'options/options.css'],
  ['src/diagnostics/diagnostics.html', 'diagnostics/diagnostics.html'],
  ['src/diagnostics/diagnostics.css', 'diagnostics/diagnostics.css'],
  ['src/diagnostics/self-test.html', 'diagnostics/self-test.html'],
  ['vendor/esdb/README_en_US.txt', 'licenses/ESDB-README.txt'],
  // Harper grammar engine: WASM fetched at runtime by the service worker via
  // chrome.runtime.getURL; the JS glue is bundled into the background bundle.
  ['node_modules/harper.js/dist/harper_wasm_bg.wasm', 'vendor/harper/harper_wasm_bg.wasm'],
  ['node_modules/harper.js/LICENSE', 'licenses/HARPER-LICENSE.txt'],
];

async function copyStatic() {
  for (const [from, to] of staticFiles) {
    const src = path.join(root, from);
    const dest = path.join(dist, to);
    if (!existsSync(src)) throw new Error(`Missing static file: ${from}`);
    await mkdir(path.dirname(dest), { recursive: true });
    await copyFile(src, dest);
  }
}

async function copyPublic() {
  const pub = path.join(root, 'public');
  if (!existsSync(pub)) return;
  const entries = await readdir(pub, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    await copyFile(path.join(pub, e.name), path.join(dist, e.name));
  }
}

async function writeIcons() {
  const iconsDir = path.join(dist, 'icons');
  await mkdir(iconsDir, { recursive: true });
  for (const size of [16, 32, 48, 128]) {
    await writeFile(path.join(iconsDir, `icon${size}.png`), makeIcon(size));
  }
}

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  target: ['chrome116'],
  platform: 'browser',
  sourcemap: dev ? 'inline' : false,
  minify: !dev,
  legalComments: 'none',
  logLevel: 'info',
  define: { __DEV__: JSON.stringify(dev) },
};

async function run() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await copyStatic();
  await copyPublic();
  await writeIcons();

  const contexts = [];
  for (const b of bundles) {
    const options = {
      ...common,
      entryPoints: [path.join(root, b.entry)],
      outfile: path.join(dist, b.out),
      format: b.format,
      external: b.external ?? [],
    };
    if (watch) {
      const ctx = await esbuild.context(options);
      await ctx.watch();
      contexts.push(ctx);
    } else {
      await esbuild.build(options);
    }
  }

  if (watch) {
    // Re-copy static assets when they change.
    const { watch: fsWatch } = await import('node:fs');
    for (const [from] of staticFiles) {
      fsWatch(path.join(root, from), { persistent: true }, () => {
        copyStatic().catch((err) => console.error('[build] static copy failed:', err));
      });
    }
    console.log('[build] watching for changes; load ./dist as an unpacked extension');
    await new Promise(() => {});
  } else {
    const s = await stat(path.join(dist, 'content/content-script.js'));
    console.log(`[build] done -> ${path.relative(root, dist)} (content script ${(s.size / 1024).toFixed(1)} kB)`);
  }
}

run().catch((err) => {
  console.error('[build] failed:', err);
  process.exitCode = 1;
});
