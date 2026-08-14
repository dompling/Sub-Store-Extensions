import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  compareVersions,
  incrementVersion,
  releaseTagFor,
  resolveReleaseVersion,
} from '../scripts/prepare-release.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('orders stable and prerelease extension versions without allowing downgrades', () => {
  assert.equal(compareVersions('1.2.0', '1.1.9'), 1);
  assert.equal(compareVersions('1.2.0-beta.2', '1.2.0-beta.1'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0-beta.2'), 1);
  assert.equal(compareVersions('1.2.0', '1.2.0'), 0);
  assert.equal(compareVersions('1.1.9', '1.2.0'), -1);
});

test('computes workflow-managed semantic versions from the published release', () => {
  assert.equal(incrementVersion('1.2.0', 'patch'), '1.2.1');
  assert.equal(incrementVersion('1.2.0', 'minor'), '1.3.0');
  assert.equal(incrementVersion('1.2.0', 'major'), '2.0.0');
  assert.equal(incrementVersion('1.2.0-beta.2', 'patch'), '1.2.0');
  assert.throws(() => incrementVersion('1.2.0', 'calendar'), /Unsupported release bump/);

  assert.equal(resolveReleaseVersion({
    sourceVersion: '1.2.0',
    publishedVersion: '1.2.0',
    bump: 'patch',
  }), '1.2.1');
  assert.equal(resolveReleaseVersion({
    sourceVersion: '0.1.0',
    publishedVersion: undefined,
    bump: 'patch',
  }), '0.1.0');
  assert.equal(resolveReleaseVersion({
    sourceVersion: '1.2.1',
    publishedVersion: '1.2.0',
  }), '1.2.1');
  assert.throws(() => resolveReleaseVersion({
    sourceVersion: '1.2.0',
    publishedVersion: '1.2.0',
  }), /must be newer than published 1\.2\.0/);
  assert.throws(() => resolveReleaseVersion({
    sourceVersion: '1.3.0',
    publishedVersion: '1.2.0',
    bump: 'minor',
  }), /must match published 1\.2\.0/);
});

test('uses the extension semantic version as a namespaced immutable Git tag', () => {
  assert.equal(
    releaseTagFor('org.substore.config-generator', '1.2.1'),
    'org.substore.config-generator@1.2.1',
  );
  assert.throws(() => releaseTagFor('org.substore@invalid', '1.2.1'), /extension id is invalid/);
});

test('exposes one selected-extension release build command for local and CI use', async () => {
  const packageDocument = JSON.parse(await readFile(path.join(repoRoot, 'package.json'), 'utf8'));
  const command = await readFile(path.join(repoRoot, 'scripts/command.mjs'), 'utf8');

  assert.equal(packageDocument.scripts['release:build'], 'node scripts/command.mjs release:build');
  assert.match(command, /case 'release:build':\s+case 'check':\s+await checkExtensions\(extensions\)/);
  assert.match(command, /case 'repository':\s+await publishRepository\(extensions\)/);
  assert.match(command, /case 'verify':\s+await verifyRepository\(extensions\)/);
});

test('keeps release-package assertions in release builds without polluting source-test runs', async () => {
  const tasks = await readFile(path.join(repoRoot, 'scripts/tasks.mjs'), 'utf8');
  const packageContract = await readFile(
    path.join(
      repoRoot,
      'extensions/org.substore.config-generator/tests/package-contract.test.mjs',
    ),
    'utf8',
  );

  assert.match(packageContract, /SUB_STORE_RELEASE_PACKAGE_TESTS/);
  assert.match(tasks, /releasePackageContracts = true/);
  assert.match(tasks, /SUB_STORE_RELEASE_PACKAGE_TESTS/);
  assert.match(tasks, /testBuiltExtensions\(extensions, \{ releasePackageContracts: false \}\)/);
  assert.match(tasks, /await buildFrontendExtensions\(extensions\);\s+await buildBackendExtensions\(extensions\);/);
});

test('publishes a reproducible SHA-256 package directly from the verified release commit', async () => {
  const workflow = await readFile(
    path.join(repoRoot, '.github/workflows/publish-extension.yml'),
    'utf8',
  );
  assert.match(workflow, /workflow_dispatch:/);
  assert.match(workflow, /version_bump:/);
  assert.match(workflow, /type: choice/);
  assert.match(workflow, /node-version: 22/);
  assert.match(workflow, /pnpm release:prepare/);
  assert.match(workflow, /--bump "\$\{\{ inputs\.version_bump \}\}"/);
  assert.match(workflow, /pnpm release:build/);
  assert.match(workflow, /SUB_STORE_EXTENSION_RELEASE_TAG/);
  assert.doesNotMatch(workflow, /pnpm typecheck/);
  assert.doesNotMatch(workflow, /pnpm test:built/);
  assert.doesNotMatch(workflow, /pnpm package:assemble/);
  assert.doesNotMatch(workflow, /pnpm repository(?:\s|$)/);
  assert.doesNotMatch(workflow, /pnpm verify(?:\s|$)/);
  assert.match(workflow, /git diff --check/);
  assert.match(workflow, /actions\/upload-artifact@v4/);
  assert.match(workflow, /build\/\$\{\{ steps\.metadata\.outputs\.extension_id \}\}/);
  assert.match(workflow, /dist\/packages\/\$\{\{ steps\.metadata\.outputs\.extension_id \}\}/);
  assert.match(workflow, /repository\/releases\/\$\{\{ steps\.metadata\.outputs\.extension_id \}\}\.json/);
  assert.match(workflow, /group: publish-extension-\$\{\{ inputs\.base_branch \}\}/);
  assert.match(workflow, /base_sha=\$\{base_sha\}/);
  assert.match(workflow, /current_base_sha/);
  assert.match(workflow, /secrets\.RELEASE_PUBLISH_TOKEN \|\| github\.token/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /git ls-remote --exit-code --tags origin "refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /git tag --annotate "\$RELEASE_TAG" "\$RELEASE_HEAD_SHA"/);
  assert.match(workflow, /git push --atomic origin/);
  assert.match(workflow, /"\$RELEASE_HEAD_SHA:refs\/heads\/\$BASE_BRANCH"/);
  assert.match(workflow, /"refs\/tags\/\$RELEASE_TAG:refs\/tags\/\$RELEASE_TAG"/);
  assert.match(workflow, /published_sha/);
  assert.match(workflow, /release_prefix="automation\/publish-\$\{BRANCH_SLUG\}-v\$\{EXTENSION_VERSION\}-"/);
  assert.match(workflow, /git push origin --delete "\$stale_branch"/);
  assert.ok(workflow.indexOf('pnpm release:build') < workflow.indexOf('git diff --check'));
  assert.ok(workflow.indexOf('git diff --check') < workflow.indexOf('git push --atomic origin'));
  assert.ok(workflow.indexOf('git push --atomic origin') < workflow.indexOf('git push origin --delete "$stale_branch"'));
  assert.doesNotMatch(workflow, /gh pr create/);
  assert.doesNotMatch(workflow, /gh pr merge/);
  assert.doesNotMatch(workflow, /RELEASE_PR_TOKEN/);
  assert.doesNotMatch(workflow, /pull_request_target:/);
  assert.doesNotMatch(workflow, /environment:/);
  assert.doesNotMatch(workflow, /EXTENSION_RELEASE_PRIVATE_KEY/);
  assert.doesNotMatch(workflow, /release:sign/);
});
