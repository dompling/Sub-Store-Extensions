import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  buildContentExtensionScaffold,
  createContentExtension,
} from '../scripts/create-extension.mjs';
import { createDigestContentPackage } from '../scripts/content-package.mjs';
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

test('rejects reserved ids and attempts to scaffold executable variants', () => {
  assert.throws(
    () => buildContentExtensionScaffold({ ...options, id: 'com.example.catalog.demo' }),
    /reserved segment/,
  );
  const scaffold = buildContentExtensionScaffold(options);
  scaffold.manifest.variants.node.containsExecutableCode = true;
  assert.throws(
    () => createDigestContentPackage({
      manifest: scaffold.manifest,
      files: { 'content/extension.json': scaffold.contentText },
      createdAt: options.createdAt,
    }),
    /disable executable code/,
  );
});
