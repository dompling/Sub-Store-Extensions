import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { writeDigestPackageToDirectory } from '../scripts/content-package.mjs';
import { installDevelopmentExtension } from '../scripts/dev-install.mjs';
import { installLocalExtension } from '../scripts/install-local.mjs';
import { pathExists, readJson, verifyPackageDirectory, writeJson } from '../scripts/lib.mjs';

const createFixture = async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-dev-install-test-'));
  const id = 'com.example.development';
  const workspaceDirectory = path.join(root, 'extensions', id);
  const buildDirectory = path.join(root, 'build', id);
  const packageDirectory = path.join(root, 'packages', id);
  const repositoryDirectory = path.join(root, 'repository');
  const manifestPath = path.join(workspaceDirectory, 'manifest.json');
  const temporaryParentDirectory = path.join(root, 'temporary');
  const manifest = {
    schemaVersion: 1,
    id,
    kind: 'executable',
    name: 'Development fixture',
    version: '1.2.3',
    publisher: { id: 'com.example', name: 'Example' },
    frontend: {
      assets: {
        entrypoint: { path: 'frontend/index.js', digest: 'stale-development-digest' },
      },
    },
    variants: {
      node: {
        implementationId: `${id}@1/node`,
        implementationAbi: 'example@1',
        entrypoint: 'backend/index.cjs',
        containsExecutableCode: true,
      },
    },
  };
  const extension = {
    id,
    workspaceDirectory,
    buildDirectory,
    packageDirectory,
    manifestPath,
    manifest: structuredClone(manifest),
    config: {
      signature: { algorithm: 'sha256-digest' },
      package: {
        variant: 'node',
        source: 'com.example.extensions',
        createdAt: '2026-08-14T00:00:00.000Z',
      },
    },
    artifacts: [
      { build: 'backend/index.cjs', package: 'backend/index.cjs' },
      { build: 'frontend/index.js', package: 'frontend/index.js' },
    ],
    contentFiles: [],
  };

  await writeJson(manifestPath, manifest);
  await fs.mkdir(path.join(buildDirectory, 'backend'), { recursive: true });
  await fs.mkdir(path.join(buildDirectory, 'frontend'), { recursive: true });
  await fs.writeFile(
    path.join(buildDirectory, 'backend', 'index.cjs'),
    "module.exports = {};\n",
    'utf8',
  );
  await fs.writeFile(
    path.join(buildDirectory, 'frontend', 'index.js'),
    'window.fixture = true;\n',
    'utf8',
  );
  await fs.mkdir(packageDirectory, { recursive: true });
  await fs.mkdir(repositoryDirectory, { recursive: true });
  await fs.mkdir(temporaryParentDirectory, { recursive: true });
  await fs.writeFile(path.join(packageDirectory, 'formal-package-sentinel'), 'unchanged\n', 'utf8');
  await fs.writeFile(path.join(repositoryDirectory, 'repository-sentinel'), 'unchanged\n', 'utf8');

  return {
    root,
    extension,
    packageDirectory,
    repositoryDirectory,
    manifestPath,
    temporaryParentDirectory,
  };
};

test('exposes the one-command development install entrypoint', async () => {
  const packageDocument = await readJson(new URL('../package.json', import.meta.url));
  assert.equal(packageDocument.scripts['dev:install'], 'node scripts/dev-install.mjs');
});

test('builds a verified development package in temporary storage without touching release data', async () => {
  const fixture = await createFixture();
  const sourceManifest = await fs.readFile(fixture.manifestPath, 'utf8');
  const calls = [];
  let installedPackageDirectory;

  try {
    const result = await installDevelopmentExtension({
      extension: fixture.extension,
      host: 'http://127.0.0.1:3000',
      temporaryParentDirectory: fixture.temporaryParentDirectory,
      buildFrontend: async extensions => {
        calls.push('frontend');
        assert.deepEqual(extensions, [fixture.extension]);
      },
      buildBackend: async extensions => {
        calls.push('backend');
        assert.deepEqual(extensions, [fixture.extension]);
      },
      install: async options => {
        calls.push('install');
        assert.equal(options.reinstall, true);
        assert.notEqual(options.packageDirectory, fixture.packageDirectory);
        assert.equal(
          options.packageDirectory.startsWith(`${fixture.temporaryParentDirectory}${path.sep}`),
          true,
        );
        installedPackageDirectory = options.packageDirectory;
        const verified = await verifyPackageDirectory(options.packageDirectory, fixture.extension);
        assert.notEqual(
          verified.manifest.frontend.assets.entrypoint.digest,
          'stale-development-digest',
        );
        return { host: options.host, verified };
      },
    });

    assert.deepEqual(calls, ['frontend', 'backend', 'install']);
    assert.equal(result.verified.manifest.id, fixture.extension.id);
    assert.equal(await pathExists(installedPackageDirectory), false);
    assert.deepEqual(await fs.readdir(fixture.temporaryParentDirectory), []);
    assert.equal(await fs.readFile(fixture.manifestPath, 'utf8'), sourceManifest);
    assert.equal(
      await fs.readFile(path.join(fixture.packageDirectory, 'formal-package-sentinel'), 'utf8'),
      'unchanged\n',
    );
    assert.equal(
      await fs.readFile(path.join(fixture.repositoryDirectory, 'repository-sentinel'), 'utf8'),
      'unchanged\n',
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('reinstalls through the Host without purging data and enables the extension', async () => {
  const fixture = await createFixture();
  const temporaryPackageDirectory = path.join(fixture.temporaryParentDirectory, fixture.extension.id);
  const calls = [];

  try {
    await writeDigestPackageToDirectory(fixture.extension, temporaryPackageDirectory);
    const result = await installLocalExtension({
      extension: fixture.extension,
      packageDirectory: temporaryPackageDirectory,
      host: 'http://127.0.0.1:3000/',
      token: 'development-token',
      reinstall: true,
      fetchImplementation: async (url, options) => {
        const call = {
          url,
          method: options.method,
          headers: options.headers,
          body: options.body === undefined ? undefined : JSON.parse(options.body),
        };
        calls.push(call);
        if (options.method === 'DELETE') {
          return {
            ok: false,
            status: 404,
            json: async () => ({ error: { code: 'EXTENSION_NOT_INSTALLED' } }),
          };
        }
        return { ok: true, status: 200, json: async () => ({ data: {} }) };
      },
    });

    assert.equal(result.host, 'http://127.0.0.1:3000');
    assert.deepEqual(calls.map(call => [call.method, new URL(call.url).pathname]), [
      ['POST', '/api/admin/extensions/packages/inspect'],
      ['DELETE', `/api/admin/extensions/${fixture.extension.id}`],
      ['POST', `/api/admin/extensions/${fixture.extension.id}/install-local`],
      ['POST', `/api/admin/extensions/${fixture.extension.id}/enable`],
    ]);
    assert.deepEqual(calls[1].body, { purgeData: false });
    assert.equal(calls[0].body.rootName, fixture.extension.id);
    assert.deepEqual(calls[0].body, calls[2].body);
    assert.equal(calls[0].headers.authorization, 'Bearer development-token');
    assert.equal(
      calls[2].headers['x-idempotency-key'],
      `local-${result.verified.packageDigest}`,
    );
    assert.equal(
      calls[3].headers['x-idempotency-key'],
      `enable-${result.verified.packageDigest}`,
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});

test('removes the temporary package when Host installation fails', async () => {
  const fixture = await createFixture();
  let temporaryPackageDirectory;

  try {
    await assert.rejects(
      installDevelopmentExtension({
        extension: fixture.extension,
        temporaryParentDirectory: fixture.temporaryParentDirectory,
        buildFrontend: async () => {},
        buildBackend: async () => {},
        install: async options => {
          temporaryPackageDirectory = options.packageDirectory;
          throw new Error('Host unavailable');
        },
      }),
      /Host unavailable/,
    );
    assert.equal(await pathExists(temporaryPackageDirectory), false);
    assert.deepEqual(await fs.readdir(fixture.temporaryParentDirectory), []);
    assert.equal(
      (await readJson(fixture.manifestPath)).frontend.assets.entrypoint.digest,
      'stale-development-digest',
    );
  } finally {
    await fs.rm(fixture.root, { recursive: true, force: true });
  }
});
