import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function inTempDir<T>(fn: () => T | Promise<T>): Promise<T> {
  const originalCwd = process.cwd();
  const workDir = mkdtempSync(join(tmpdir(), 'script-test-'));
  process.chdir(workDir);
  return Promise.resolve(fn()).finally(() => {
    process.chdir(originalCwd);
    rmSync(workDir, { recursive: true, force: true });
  });
}
