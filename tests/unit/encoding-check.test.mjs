import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('repository encoding check', () => {
  it('finds supported mojibake sequences in nested project text', async () => {
    const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'autocorrect-encoding-'));
    try {
      const nested = path.join(fixtureRoot, 'src', 'nested');
      await mkdir(nested, { recursive: true });
      await writeFile(
        path.join(nested, 'fixture.ts'),
        `export const brokenArrow = "${String.fromCodePoint(0x00e2, 0x2020, 0x2019)}";\n`,
        'utf8',
      );

      const script = path.resolve('scripts/fix-encoding.mjs');
      const result = spawnSync(process.execPath, [script, '--check'], {
        cwd: fixtureRoot,
        encoding: 'utf8',
      });

      expect(result.status).toBe(1);
      expect(result.stderr).toContain('src');
      expect(result.stderr).toContain('fixture.ts');
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });
});
