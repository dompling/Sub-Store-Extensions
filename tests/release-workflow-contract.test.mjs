import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { compareVersions } from '../scripts/prepare-release.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('orders stable and prerelease extension versions without allowing downgrades', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.1'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0-beta.2'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.1.9', '1.2.0'), -1);
});

test('publishes a reproducible SHA-256 package through a release PR', async () => {
  const workflow = await readFile(
    path.join(repoRoot, '.github/workflows/publish-extension.yml'),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /pnpm release:prepare/);
  assert.match(workflow, /pnpm typecheck/);
  assert.match(workflow, /pnpm build/);
  assert.match(workflow, /pnpm test:built/);
  assert.match(workflow, /pnpm package:assemble/);
  assert.match(workflow, /pnpm repository/);
  assert.match(workflow, /pnpm verify/);
  assert.match(workflow, /git diff --check/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /gh pr create/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /environment:/);
  assert.doesNotMatch(workflow, /EXTENSION_RELEASE_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /release:sign/);
});
