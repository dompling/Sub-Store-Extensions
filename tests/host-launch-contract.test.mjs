import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('does not seed local packages into the Host unless explicitly requested', async () => {
  const launcher = await readFile(path.join(repoRoot, 'scripts/run-host.mjs'), 'utf8');

  assert.match(launcher, /process\.env\.SUB_STORE_EXTENSION_PACKAGE_SEED_PATH\?\.trim\(\)/);
  assert.match(launcher, /delete childEnvironment\.SUB_STORE_EXTENSION_PACKAGE_SEED_PATH/);
  assert.doesNotMatch(
    launcher,
    /SUB_STORE_EXTENSION_PACKAGE_SEED_PATH:\s*path\.join\(repoRoot, ['"]packages['"]\)/,
  );
});
