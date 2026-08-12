import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  listRegularFiles,
  readJson,
  resolveRepositorySourceUrl,
} from '../scripts/lib.mjs';
import {
  buildRepositoryCatalog,
  createReleaseLedger,
  writeRepositoryDocuments,
} from '../scripts/tasks.mjs';

const repositoryConfig = {
  schemaVersion: 1,
  id: 'org.example.extensions',
  name: 'Example Extensions',
  description: 'One source containing multiple extensions',
  sequence: 7,
  publisher: { id: 'org.example', name: 'Example Repository' },
};

const document = ({ id, author, installedAt, digest, version = '1.0.0' }) => ({
  extension: { id },
  verified: {
    receipt: { installedAt },
    metadata: { selectedVariant: 'node' },
  },
  relativePackagePath: `packages/${id}/${version}/node.json`,
  envelope: { schemaVersion: 1, extensionId: id, digest },
  entry: {
    id,
    version,
    manifest: {
      schemaVersion: 1,
      id,
      kind: 'content',
      name: id,
      description: id,
      version,
      publisher: author,
      host: { apiVersion: '1.0.0' },
      variants: { node: { containsExecutableCode: false } },
      permissions: [],
      contributes: {},
      storage: { schemaVersion: 1 },
    },
    packageUrl: `./packages/${id}/${version}/node.json`,
    packageUrls: { node: `./packages/${id}/${version}/node.json` },
    packageDigest: digest,
    packageDigests: { node: digest },
    source: repositoryConfig.id,
    sourceName: repositoryConfig.name,
    author,
  },
});

test('builds one deterministic collection catalog for multiple independent extensions', () => {
  const first = document({
    id: 'com.alpha.one',
    author: { id: 'com.alpha', name: 'Alpha' },
    installedAt: Date.parse('2026-08-10T00:00:00.000Z'),
    digest: 'a'.repeat(64),
  });
  const second = document({
    id: 'com.beta.two',
    author: { id: 'com.beta', name: 'Beta' },
    installedAt: Date.parse('2026-08-11T00:00:00.000Z'),
    digest: 'b'.repeat(64),
  });

  const { catalog, documents } = buildRepositoryCatalog(repositoryConfig, [second, first]);

  assert.deepEqual(documents.map(item => item.entry.id), ['com.alpha.one', 'com.beta.two']);
  assert.equal(catalog.entries.length, 2);
  assert.equal(catalog.generatedAt, '2026-08-11T00:00:00.000Z');
  assert.deepEqual(catalog.publisher, repositoryConfig.publisher);
  assert.deepEqual(catalog.entries[0].author, { id: 'com.alpha', name: 'Alpha' });
  assert.deepEqual(catalog.entries[1].author, { id: 'com.beta', name: 'Beta' });
  assert.equal(catalog.entries[0].packageUrls.node.includes('com.alpha.one'), true);
  assert.equal(catalog.entries[1].packageUrls.node.includes('com.beta.two'), true);
  assert.deepEqual(catalog.entries[0].releases.map(release => release.version), ['1.0.0']);
  assert.equal(catalog.entries[0].releases[0].releasedAt, '2026-08-10T00:00:00.000Z');
  assert.equal(catalog.entries[0].releases[0].installable, true);
  assert.deepEqual(createReleaseLedger(catalog.entries[0]), {
    schemaVersion: 1,
    extensionId: 'com.alpha.one',
    latestVersion: '1.0.0',
    releases: catalog.entries[0].releases,
  });
});

test('preserves immutable historical packages while removing unreferenced envelopes', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-'));
  try {
    const stale = path.join(temporaryRoot, 'packages', 'removed.extension', '1.0.0', 'node.json');
    await fs.mkdir(path.dirname(stale), { recursive: true });
    await fs.writeFile(stale, '{}\n', 'utf8');
    const historical = path.join(temporaryRoot, 'packages', 'com.alpha.one', '0.9.0', 'node.json');
    await fs.mkdir(path.dirname(historical), { recursive: true });
    await fs.writeFile(historical, '{"historical":true}\n', 'utf8');
    await fs.writeFile(path.join(temporaryRoot, 'catalog.json'), `${JSON.stringify({
      schemaVersion: 1,
      entries: [{
        ...document({
          id: 'com.alpha.one',
          author: { id: 'com.alpha', name: 'Alpha' },
          installedAt: 1,
          digest: '9'.repeat(64),
          version: '0.9.0',
        }).entry,
        releases: [{
          version: '0.9.0',
          releasedAt: '2026-07-01T00:00:00.000Z',
          manifest: {
            ...document({
              id: 'com.alpha.one',
              author: { id: 'com.alpha', name: 'Alpha' },
              installedAt: 1,
              digest: '9'.repeat(64),
              version: '0.9.0',
            }).entry.manifest,
          },
          distribution: 'community',
          selectedVariant: 'node',
          packageUrl: './packages/com.alpha.one/0.9.0/node.json',
          packageUrls: { node: './packages/com.alpha.one/0.9.0/node.json' },
          packageDigest: '9'.repeat(64),
          packageDigests: { node: '9'.repeat(64) },
          installable: true,
          gitCommit: '1'.repeat(40),
        }],
      }],
    }, null, 2)}\n`, 'utf8');
    const documents = [
      document({
        id: 'com.alpha.one',
        author: { id: 'com.alpha', name: 'Alpha' },
        installedAt: 1,
        digest: 'a'.repeat(64),
      }),
      document({
        id: 'com.beta.two',
        author: { id: 'com.beta', name: 'Beta' },
        installedAt: 2,
        digest: 'b'.repeat(64),
      }),
    ];

    await writeRepositoryDocuments({ repositoryConfig, documents, outputDirectory: temporaryRoot });

    assert.deepEqual(await listRegularFiles(path.join(temporaryRoot, 'packages')), [
      'com.alpha.one/0.9.0/node.json',
      'com.alpha.one/1.0.0/node.json',
      'com.beta.two/1.0.0/node.json',
    ]);
    const catalog = await readJson(path.join(temporaryRoot, 'catalog.json'));
    assert.deepEqual(catalog.entries.map(entry => entry.id), ['com.alpha.one', 'com.beta.two']);
    assert.deepEqual(catalog.entries[0].releases.map(release => release.version), ['1.0.0', '0.9.0']);
    assert.equal(await fs.readFile(historical, 'utf8'), '{"historical":true}\n');
    await assert.rejects(fs.access(stale));
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects republishing the same extension version with different package bytes', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-immutable-'));
  try {
    const previous = document({
      id: 'com.example.immutable',
      author: { id: 'com.example', name: 'Example' },
      installedAt: 1,
      digest: 'a'.repeat(64),
    });
    await fs.mkdir(path.join(temporaryRoot, 'packages', 'com.example.immutable', '1.0.0'), { recursive: true });
    await fs.writeFile(
      path.join(temporaryRoot, 'packages', 'com.example.immutable', '1.0.0', 'node.json'),
      `${JSON.stringify(previous.envelope, null, 2)}\n`,
      'utf8',
    );
    const previousCatalog = buildRepositoryCatalog(repositoryConfig, [previous]).catalog;
    await fs.writeFile(
      path.join(temporaryRoot, 'catalog.json'),
      `${JSON.stringify(previousCatalog, null, 2)}\n`,
      'utf8',
    );

    const changed = document({
      id: 'com.example.immutable',
      author: { id: 'com.example', name: 'Example' },
      installedAt: 2,
      digest: 'b'.repeat(64),
    });
    await assert.rejects(
      writeRepositoryDocuments({
        repositoryConfig,
        documents: [changed],
        outputDirectory: temporaryRoot,
      }),
      /release already exists with different package bytes/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects catalog and per-extension ledger provenance drift', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-ledger-'));
  try {
    const current = document({
      id: 'com.example.ledger',
      author: { id: 'com.example', name: 'Example' },
      installedAt: Date.parse('2026-08-12T00:00:00.000Z'),
      digest: 'd'.repeat(64),
    });
    const catalog = buildRepositoryCatalog(repositoryConfig, [current]).catalog;
    catalog.entries[0].releases[0].gitCommit = '1'.repeat(40);
    const ledger = createReleaseLedger(catalog.entries[0]);
    ledger.releases = structuredClone(ledger.releases);
    ledger.releases[0].gitCommit = '2'.repeat(40);
    await fs.mkdir(path.join(temporaryRoot, 'releases'), { recursive: true });
    await fs.writeFile(
      path.join(temporaryRoot, 'catalog.json'),
      `${JSON.stringify(catalog, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(temporaryRoot, 'releases', 'com.example.ledger.json'),
      `${JSON.stringify(ledger, null, 2)}\n`,
      'utf8',
    );

    await assert.rejects(
      writeRepositoryDocuments({
        repositoryConfig,
        documents: [current],
        outputDirectory: temporaryRoot,
      }),
      /catalog and release ledger disagree/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('rejects duplicate extension identities and envelope path traversal', async () => {
  const duplicate = document({
    id: 'com.example.same',
    author: { id: 'com.example', name: 'Example' },
    installedAt: 1,
    digest: 'c'.repeat(64),
  });
  assert.throws(
    () => buildRepositoryCatalog(repositoryConfig, [duplicate, duplicate]),
    /duplicate extension ids/,
  );

  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-path-'));
  try {
    await assert.rejects(
      writeRepositoryDocuments({
        repositoryConfig,
        documents: [{ ...duplicate, relativePackagePath: 'packages/../../escape.json' }],
        outputDirectory: temporaryRoot,
      }),
      /escapes the output directory/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('uses the repository collection URL by default while allowing local development overrides', async () => {
  const config = await readJson(new URL('../repository.config.json', import.meta.url));
  assert.equal(
    resolveRepositorySourceUrl(config),
    'https://raw.githubusercontent.com/dompling/Sub-Store-Extensions/main/repository/catalog.json',
  );
  assert.equal(
    resolveRepositorySourceUrl(config, { explicitUrl: 'http://127.0.0.1:8765/catalog.json' }),
    'http://127.0.0.1:8765/catalog.json',
  );
  assert.equal(
    resolveRepositorySourceUrl(config, {
      explicitUrl: 'https://example.com/explicit.json',
      environmentUrl: 'https://example.com/environment.json',
    }),
    'https://example.com/explicit.json',
  );
});
