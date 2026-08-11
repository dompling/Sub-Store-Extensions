import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildContentExtensionScaffold,
  createContentExtension,
} from '../scripts/create-extension.mjs';
import { createDigestPackage } from '../scripts/content-package.mjs';
import { canonicalJson, readJson, sha256Hex } from '../scripts/lib.mjs';

const options = {
  id: 'com.example.demo',
  name: 'Demo',
  description: 'A repository-scoped demo extension',
  version: '1.2.3',
  publisherId: 'com.example',
  publisherName: 'Example',
  createdAt: '2026-08-11T00:00:00.000Z',
};

test('creates a reproducible content-only package without executable trust', () => {
  const scaffold = buildContentExtensionScaffold(options);
  const { manifest, receipt, metadata, payload } = scaffold.packageValue;
  const projection = {
    schemaVersion: payload.schemaVersion,
    manifest: payload.manifest,
    selectedVariant: payload.selectedVariant,
    variant: payload.variant,
    containsExecutableCode: payload.containsExecutableCode,
    containsInstallHook: payload.containsInstallHook,
    files: payload.files,
    fileDigests: payload.fileDigests,
  };
  const { receiptDigest, ...receiptBody } = receipt;

  assert.equal(manifest.kind, 'content');
  assert.equal(manifest.variants.node.containsExecutableCode, false);
  assert.equal(metadata.containsExecutableCode, false);
  assert.equal(metadata.containsInstallHook, false);
  assert.equal(metadata.signature.algorithm, 'sha256-digest');
  assert.equal(metadata.packageDigest, sha256Hex(canonicalJson(projection)));
  assert.equal(receipt.receiptDigest, sha256Hex(canonicalJson(receiptBody)));
  assert.equal(metadata.payloadDigest, sha256Hex(canonicalJson(payload)));
  assert.equal(metadata.signature.value, metadata.payloadDigest);
  assert.equal(scaffold.extensionConfig.repository.distribution, 'community');
  assert.deepEqual(scaffold.extensionConfig.repository.author, manifest.publisher);
  assert.deepEqual(scaffold.extensionConfig.release.versionFiles, ['content/extension.json']);
});

test('creates one isolated workspace and package directory and refuses overwrite', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-extension-create-'));
  try {
    const result = await createContentExtension({ rootDirectory: temporaryRoot, ...options });
    const extensionDirectory = path.join(temporaryRoot, 'extensions', options.id);
    const packageDirectory = path.join(temporaryRoot, 'packages', options.id);

    assert.equal(result.extensionDirectory, extensionDirectory);
    assert.equal(result.packageDirectory, packageDirectory);
    assert.equal((await readJson(path.join(extensionDirectory, 'extension.config.json'))).id, options.id);
    assert.equal((await readJson(path.join(extensionDirectory, 'manifest.json'))).id, options.id);
    assert.equal((await readJson(path.join(packageDirectory, 'manifest.json'))).id, options.id);
    assert.equal(
      (await readJson(path.join(packageDirectory, 'package.json'))).packageDigest,
      result.scaffold.packageValue.metadata.packageDigest,
    );
    assert.equal(
      await fs.readFile(path.join(extensionDirectory, 'content', 'extension.json'), 'utf8'),
      await fs.readFile(path.join(packageDirectory, 'content', 'extension.json'), 'utf8'),
    );
    await assert.rejects(
      createContentExtension({ rootDirectory: temporaryRoot, ...options }),
      /already exists/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('creates an executable package from declared build artifacts without a release key', () => {
  const manifest = {
    schemaVersion: 1,
    id: 'com.example.executable',
    kind: 'executable',
    version: '1.0.0',
    publisher: { id: 'com.example', name: 'Example' },
    frontend: {
      assets: {
        entrypoint: { path: 'frontend/index.js', digest: 'stale' },
      },
    },
    variants: {
      node: {
        implementationId: 'com.example.executable@1/node',
        implementationAbi: 'example@1',
        entrypoint: 'backend/index.cjs',
        containsExecutableCode: true,
      },
    },
  };
  const files = {
    'backend/index.cjs': "module.exports = {};\n",
    'frontend/index.js': 'window.example = true;\n',
  };
  const packageValue = createDigestPackage({
    manifest,
    files,
    source: 'com.example.extensions',
    createdAt: options.createdAt,
  });

  assert.equal(packageValue.metadata.containsExecutableCode, true);
  assert.equal(packageValue.receipt.implementation.entrypoint, 'backend/index.cjs');
  assert.equal(
    packageValue.manifest.frontend.assets.entrypoint.digest,
    sha256Hex(files['frontend/index.js']),
  );
  assert.deepEqual(packageValue.metadata.signature, {
    algorithm: 'sha256-digest',
    digest: packageValue.metadata.payloadDigest,
    value: packageValue.metadata.payloadDigest,
  });
});

test('rejects reserved ids and attempts to scaffold executable variants', () => {
  assert.throws(
    () => buildContentExtensionScaffold({ ...options, id: 'com.example.catalog.demo' }),
    /reserved segment/,
  );
  const scaffold = buildContentExtensionScaffold(options);
  scaffold.manifest.variants.node.containsExecutableCode = true;
  assert.throws(
    () => createDigestPackage({
      manifest: scaffold.manifest,
      files: { 'content/extension.json': scaffold.contentText },
      createdAt: options.createdAt,
    }),
    /disable executable code/,
  );
  const safeManifest = buildContentExtensionScaffold(options).manifest;
  assert.throws(
    () => createDigestPackage({
      manifest: safeManifest,
      files: { 'manifest.json': '{}\n' },
      createdAt: options.createdAt,
    }),
    /Unsafe or reserved/,
  );
});
