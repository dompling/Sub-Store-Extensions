import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extensionIdsFromChangedPaths,
  selectAutomaticReleaseExtensions,
  selectReleaseExtensions,
} from '../scripts/select-release-extensions.mjs';

test('maps changed extension paths to stable unique extension ids', () => {
  assert.deepEqual(extensionIdsFromChangedPaths([
    'README.md',
    'extensions/org.substore.subscription-doctor/backend/index.js',
    'extensions/org.substore.config-generator/frontend/index.ts',
    'extensions/org.substore.subscription-doctor/tests/example.test.mjs',
    'repository/catalog.json',
  ]), [
    'org.substore.config-generator',
    'org.substore.subscription-doctor',
  ]);
});

test('selects every extension changed since its own immutable release tag', async () => {
  const calls = [];
  const selection = await selectAutomaticReleaseExtensions({
    head: 'f'.repeat(40),
    git: async args => {
      calls.push(args);
      if (args[0] === 'rev-parse') {
        return args.at(-1).includes('config-generator')
          ? `${'a'.repeat(40)}\n`
          : `${'b'.repeat(40)}\n`;
      }
      if (args[0] === 'merge-base') return `${args[1]}\n`;
      if (args[0] === 'diff') {
        return args.at(-1).includes('config-generator')
          ? 'extensions/org.substore.config-generator/frontend/index.ts\0'
          : [
              'extensions/org.substore.rule-studio/backend/index.js',
              'extensions/org.substore.rule-studio/tests/example.test.mjs',
              '',
            ].join('\0');
      }
      throw new Error(`Unexpected Git command: ${args.join(' ')}`);
    },
    listAllExtensions: async () => [
      'org.substore.rule-studio',
      'org.substore.config-generator',
    ],
    readCatalog: async () => ({
      entries: [
        { id: 'org.substore.config-generator', version: '1.2.7' },
        { id: 'org.substore.rule-studio', version: '0.1.4' },
      ],
    }),
    extensionExists: async () => true,
  });

  assert.deepEqual(selection.releaseBaselines, {
    'org.substore.config-generator': 'org.substore.config-generator@1.2.7',
    'org.substore.rule-studio': 'org.substore.rule-studio@0.1.4',
  });
  assert.deepEqual(selection.extensionIds, [
    'org.substore.config-generator',
    'org.substore.rule-studio',
  ]);
  assert.deepEqual(calls.find(args => (
    args[0] === 'diff' && args.at(-1).includes('config-generator')
  )), [
    'diff',
    '--name-only',
    '-z',
    'a'.repeat(40),
    'f'.repeat(40),
    '--',
    'extensions/org.substore.config-generator',
  ]);
});

test('selects extensions without a published or placeholder baseline and rejects removed roots', async () => {
  const initial = await selectAutomaticReleaseExtensions({
    head: 'f'.repeat(40),
    git: async () => '',
    listAllExtensions: async () => [
      'org.substore.subscription-doctor',
      'org.substore.config-generator',
    ],
    readCatalog: async () => ({ entries: [] }),
    extensionExists: async () => true,
  });
  assert.deepEqual(initial.extensionIds, [
    'org.substore.config-generator',
    'org.substore.subscription-doctor',
  ]);

  await assert.rejects(
    selectAutomaticReleaseExtensions({
      head: 'f'.repeat(40),
      git: async () => '',
      listAllExtensions: async () => ['org.substore.removed'],
      readCatalog: async () => ({ entries: [] }),
      extensionExists: async () => false,
    }),
    /Automatic extension removal is unsupported: org\.substore\.removed/,
  );

  await assert.rejects(
    selectAutomaticReleaseExtensions({
      head: 'f'.repeat(40),
      git: async () => '',
      listAllExtensions: async () => ['org.substore.config-generator'],
      readCatalog: async () => ({
        entries: [
          { id: 'org.substore.config-generator', version: '1.2.7' },
          { id: 'org.substore.removed', version: '0.1.0' },
        ],
      }),
      extensionExists: async () => true,
    }),
    /Automatic extension removal is unsupported: org\.substore\.removed/,
  );
});

test('uses an unpublished extension ledger commit as a retryable initial-release baseline', async () => {
  const baseline = 'c'.repeat(40);
  const changed = await selectAutomaticReleaseExtensions({
    head: 'f'.repeat(40),
    git: async args => {
      if (args[0] === 'log') return `${baseline}\n`;
      if (args[0] === 'diff') {
        return 'extensions/org.substore.subscription-doctor/backend/index.js\0';
      }
      throw new Error(`Unexpected Git command: ${args.join(' ')}`);
    },
    listAllExtensions: async () => ['org.substore.subscription-doctor'],
    readCatalog: async () => ({ entries: [] }),
    extensionExists: async () => true,
  });
  assert.deepEqual(changed.extensionIds, ['org.substore.subscription-doctor']);
  assert.deepEqual(changed.releaseBaselines, {
    'org.substore.subscription-doctor': baseline,
  });

  const unchanged = await selectAutomaticReleaseExtensions({
    head: 'f'.repeat(40),
    git: async args => args[0] === 'log' ? `${baseline}\n` : '',
    listAllExtensions: async () => ['org.substore.subscription-doctor'],
    readCatalog: async () => ({ entries: [] }),
    extensionExists: async () => true,
  });
  assert.deepEqual(unchanged.extensionIds, []);
});

test('fails closed when a published release tag is missing or outside the branch history', async () => {
  const options = {
    head: 'f'.repeat(40),
    listAllExtensions: async () => ['org.substore.config-generator'],
    readCatalog: async () => ({
      entries: [{ id: 'org.substore.config-generator', version: '1.2.7' }],
    }),
    extensionExists: async () => true,
  };

  await assert.rejects(
    selectAutomaticReleaseExtensions({
      ...options,
      git: async () => {
        throw new Error('unknown revision');
      },
    }),
    /Published release tag is missing: org\.substore\.config-generator@1\.2\.7/,
  );

  await assert.rejects(
    selectAutomaticReleaseExtensions({
      ...options,
      git: async args => {
        if (args[0] === 'rev-parse') return `${'a'.repeat(40)}\n`;
        if (args[0] === 'merge-base') return `${'b'.repeat(40)}\n`;
        return '';
      },
    }),
    /Published release tag is not in the current branch history/,
  );
});

test('keeps manual dispatch scoped to the explicitly selected extension', async () => {
  const selection = await selectReleaseExtensions({
    manualExtensionIds: ['org.substore.rule-studio'],
    head: 'f'.repeat(40),
    git: async () => {
      throw new Error('manual selection must not inspect Git history');
    },
    extensionExists: async () => true,
  });
  assert.deepEqual(selection.extensionIds, ['org.substore.rule-studio']);
  assert.deepEqual(selection.releaseBaselines, {});
});
