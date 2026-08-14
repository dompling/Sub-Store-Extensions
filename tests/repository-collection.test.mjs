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

test('recovers a missing historical version only from an internally consistent manifest', () => {
  const extensionId = 'com.example.legacy';
  const author = { id: 'com.example', name: 'Example' };
  const historical = document({
    id: extensionId,
    author,
    installedAt: Date.parse('2026-07-01T00:00:00.000Z'),
    digest: '9'.repeat(64),
    version: '0.9.0',
  });
  const previousCatalog = buildRepositoryCatalog(repositoryConfig, [historical]).catalog;
  delete previousCatalog.entries[0].releases[0].version;

  const current = document({
    id: extensionId,
    author,
    installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
    digest: 'a'.repeat(64),
  });
  const { catalog } = buildRepositoryCatalog(repositoryConfig, [current], previousCatalog);

  assert.deepEqual(
    catalog.entries[0].releases.map(release => release.version),
    ['1.0.0', '0.9.0'],
  );

  const inconsistentCatalog = structuredClone(previousCatalog);
  inconsistentCatalog.entries[0].releases[0].packageUrls.node =
    `./packages/${extensionId}/0.8.0/node.json`;
  assert.throws(
    () => buildRepositoryCatalog(repositoryConfig, [
      document({
        id: extensionId,
        author,
        installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
        digest: 'a'.repeat(64),
      }),
    ], inconsistentCatalog),
    /com\.example\.legacy at catalog\.entries\[0\]\.releases\[0\].*package URL must be/,
  );

  const invalidCatalog = structuredClone(previousCatalog);
  invalidCatalog.entries[0].releases[0].version = 'legacy';
  assert.throws(
    () => buildRepositoryCatalog(repositoryConfig, [
      document({
        id: extensionId,
        author,
        installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
        digest: 'a'.repeat(64),
      }),
    ], invalidCatalog),
    /Repository release version is invalid for com\.example\.legacy at catalog\.entries\[0\]\.releases\[0\]: legacy/,
  );
});

test('reports the extension and catalog release path when a version cannot be recovered', () => {
  const extensionId = 'com.example.missing-version';
  const author = { id: 'com.example', name: 'Example' };
  const historical = document({
    id: extensionId,
    author,
    installedAt: Date.parse('2026-07-01T00:00:00.000Z'),
    digest: '9'.repeat(64),
    version: '0.9.0',
  });
  const previousCatalog = buildRepositoryCatalog(repositoryConfig, [historical]).catalog;
  delete previousCatalog.entries[0].releases[0].version;
  delete previousCatalog.entries[0].releases[0].manifest.version;

  assert.throws(
    () => buildRepositoryCatalog(repositoryConfig, [
      document({
        id: extensionId,
        author,
        installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
        digest: 'a'.repeat(64),
      }),
    ], previousCatalog),
    /Repository release version is invalid for com\.example\.missing-version at catalog\.entries\[0\]\.releases\[0\]: \(missing\)/,
  );
});

test('reports the extension and ledger release path when a version cannot be recovered', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-ledger-version-'));
  try {
    const extensionId = 'com.example.ledger-version';
    const author = { id: 'com.example', name: 'Example' };
    const historical = document({
      id: extensionId,
      author,
      installedAt: Date.parse('2026-07-01T00:00:00.000Z'),
      digest: '9'.repeat(64),
      version: '0.9.0',
    });
    const historicalCatalog = buildRepositoryCatalog(repositoryConfig, [historical]).catalog;
    const ledger = createReleaseLedger(historicalCatalog.entries[0]);
    delete ledger.releases[0].version;
    delete ledger.releases[0].manifest.version;
    await fs.mkdir(path.join(temporaryRoot, 'releases'), { recursive: true });
    await fs.writeFile(
      path.join(temporaryRoot, 'releases', `${extensionId}.json`),
      `${JSON.stringify(ledger, null, 2)}\n`,
      'utf8',
    );

    await assert.rejects(
      writeRepositoryDocuments({
        repositoryConfig,
        documents: [document({
          id: extensionId,
          author,
          installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
          digest: 'a'.repeat(64),
        })],
        outputDirectory: temporaryRoot,
      }),
      /Repository release version is invalid for com\.example\.ledger-version at release ledger\.releases\[0\]: \(missing\)/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('treats an empty release ledger as having no historical releases', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-empty-ledger-'));
  try {
    const extensionId = 'com.example.empty-ledger';
    await fs.mkdir(path.join(temporaryRoot, 'releases'), { recursive: true });
    await fs.writeFile(
      path.join(temporaryRoot, 'releases', `${extensionId}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        extensionId,
        latestVersion: null,
        releases: [],
      }, null, 2)}\n`,
      'utf8',
    );

    const catalog = await writeRepositoryDocuments({
      repositoryConfig,
      documents: [document({
        id: extensionId,
        author: { id: 'com.example', name: 'Example' },
        installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
        digest: 'a'.repeat(64),
      })],
      outputDirectory: temporaryRoot,
    });

    assert.deepEqual(catalog.entries[0].releases.map(release => release.version), ['1.0.0']);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('updates one extension without rebuilding or removing other published extensions', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-partial-'));
  try {
    const alphaV1 = document({
      id: 'com.alpha.one',
      author: { id: 'com.alpha', name: 'Alpha' },
      installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
      digest: '1'.repeat(64),
      version: '1.0.0',
    });
    const beta = document({
      id: 'com.beta.two',
      author: { id: 'com.beta', name: 'Beta' },
      installedAt: Date.parse('2026-08-11T00:00:00.000Z'),
      digest: '2'.repeat(64),
      version: '2.0.0',
    });
    const previousCatalog = JSON.parse(JSON.stringify(
      buildRepositoryCatalog(repositoryConfig, [alphaV1, beta]).catalog,
    ));
    await fs.writeFile(
      path.join(temporaryRoot, 'catalog.json'),
      `${JSON.stringify(previousCatalog, null, 2)}\n`,
      'utf8',
    );
    for (const previous of [alphaV1, beta]) {
      const envelopePath = path.join(temporaryRoot, previous.relativePackagePath);
      await fs.mkdir(path.dirname(envelopePath), { recursive: true });
      await fs.writeFile(envelopePath, `${JSON.stringify(previous.envelope, null, 2)}\n`, 'utf8');
    }

    const alphaV2 = document({
      id: 'com.alpha.one',
      author: { id: 'com.alpha', name: 'Alpha' },
      installedAt: Date.parse('2026-08-10T00:00:00.000Z'),
      digest: '3'.repeat(64),
      version: '1.1.0',
    });
    const catalog = await writeRepositoryDocuments({
      repositoryConfig,
      documents: [alphaV2],
      outputDirectory: temporaryRoot,
    });

    assert.deepEqual(catalog.entries.map(entry => entry.id), ['com.alpha.one', 'com.beta.two']);
    assert.deepEqual(
      catalog.entries[0].releases.map(release => release.version),
      ['1.1.0', '1.0.0'],
    );
    assert.deepEqual(catalog.entries[1], previousCatalog.entries[1]);
    assert.equal(catalog.generatedAt, '2026-08-11T00:00:00.000Z');
    assert.deepEqual(await listRegularFiles(path.join(temporaryRoot, 'packages')), [
      'com.alpha.one/1.0.0/node.json',
      'com.alpha.one/1.1.0/node.json',
      'com.beta.two/2.0.0/node.json',
    ]);
    assert.deepEqual(
      await readJson(path.join(temporaryRoot, 'releases', 'com.beta.two.json')),
      createReleaseLedger(previousCatalog.entries[1]),
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});

test('keeps an unselected legacy catalog entry by normalizing its top-level release', () => {
  const alpha = document({
    id: 'com.alpha.one',
    author: { id: 'com.alpha', name: 'Alpha' },
    installedAt: Date.parse('2026-08-10T00:00:00.000Z'),
    digest: 'a'.repeat(64),
    version: '1.1.0',
  });
  const beta = document({
    id: 'com.beta.two',
    author: { id: 'com.beta', name: 'Beta' },
    installedAt: Date.parse('2026-08-01T00:00:00.000Z'),
    digest: 'b'.repeat(64),
    version: '2.0.0',
  });
  const previousCatalog = JSON.parse(JSON.stringify(
    buildRepositoryCatalog(repositoryConfig, [beta]).catalog,
  ));
  delete previousCatalog.entries[0].releases;

  const { catalog } = buildRepositoryCatalog(repositoryConfig, [alpha], previousCatalog);

  assert.deepEqual(catalog.entries.map(entry => entry.id), ['com.alpha.one', 'com.beta.two']);
  assert.deepEqual(
    catalog.entries[1].releases.map(release => release.version),
    ['2.0.0'],
  );
  assert.equal(catalog.entries[1].releases[0].releasedAt, previousCatalog.generatedAt);
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

test('rejects drift in an unselected extension ledger during a partial update', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-collection-partial-ledger-'));
  try {
    const alpha = document({
      id: 'com.alpha.one',
      author: { id: 'com.alpha', name: 'Alpha' },
      installedAt: Date.parse('2026-08-10T00:00:00.000Z'),
      digest: 'a'.repeat(64),
      version: '1.0.0',
    });
    const beta = document({
      id: 'com.beta.two',
      author: { id: 'com.beta', name: 'Beta' },
      installedAt: Date.parse('2026-08-09T00:00:00.000Z'),
      digest: 'b'.repeat(64),
      version: '2.0.0',
    });
    const catalog = buildRepositoryCatalog(repositoryConfig, [alpha, beta]).catalog;
    const betaLedger = createReleaseLedger(catalog.entries[1]);
    catalog.entries[1].releases[0].gitCommit = '1'.repeat(40);
    betaLedger.releases = structuredClone(betaLedger.releases);
    betaLedger.releases[0].gitCommit = '2'.repeat(40);
    await fs.mkdir(path.join(temporaryRoot, 'releases'), { recursive: true });
    await fs.writeFile(
      path.join(temporaryRoot, 'catalog.json'),
      `${JSON.stringify(catalog, null, 2)}\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(temporaryRoot, 'releases', 'com.beta.two.json'),
      `${JSON.stringify(betaLedger, null, 2)}\n`,
      'utf8',
    );

    await assert.rejects(
      writeRepositoryDocuments({
        repositoryConfig,
        documents: [document({
          id: 'com.alpha.one',
          author: { id: 'com.alpha', name: 'Alpha' },
          installedAt: Date.parse('2026-08-11T00:00:00.000Z'),
          digest: 'c'.repeat(64),
          version: '1.1.0',
        })],
        outputDirectory: temporaryRoot,
      }),
      /com\.beta\.two@2\.0\.0 catalog and release ledger disagree/,
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
