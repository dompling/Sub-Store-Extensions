import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  prepareReleases,
  releaseBatchOutputs,
} from '../scripts/prepare-releases.mjs';
import {
  assertReleaseTagsMatchExtensions,
  releaseTagFromEnvironment,
  releaseTagsFromEnvironment,
} from '../scripts/tasks.mjs';

const metadata = ({
  id,
  version,
  previousVersion,
  sequence = 10,
}) => ({
  extension_id: id,
  version,
  previous_version: previousVersion,
  version_bump: previousVersion ? 'patch' : 'initial',
  installed_at: '2026-08-14T00:00:00.000Z',
  branch_slug: id.replaceAll('.', '-'),
  release_tag: `${id}@${version}`,
  repository_sequence: sequence,
});

test('creates deterministic batch outputs for multiple extension releases', () => {
  const outputs = releaseBatchOutputs([
    metadata({
      id: 'org.substore.config-generator',
      version: '1.2.8',
      previousVersion: '1.2.7',
    }),
    metadata({
      id: 'org.substore.rule-studio',
      version: '0.1.4',
      previousVersion: '',
    }),
  ]);

  assert.equal(outputs.release_count, 2);
  assert.equal(
    outputs.extension_ids,
    'org.substore.config-generator org.substore.rule-studio',
  );
  assert.deepEqual(JSON.parse(outputs.extension_ids_json), [
    'org.substore.config-generator',
    'org.substore.rule-studio',
  ]);
  assert.deepEqual(JSON.parse(outputs.release_tags_json), {
    'org.substore.config-generator': 'org.substore.config-generator@1.2.8',
    'org.substore.rule-studio': 'org.substore.rule-studio@0.1.4',
  });
  assert.match(outputs.release_summary, /config-generator: 1\.2\.7 -> 1\.2\.8 \(patch\)/);
  assert.match(outputs.release_summary, /rule-studio: initial -> 0\.1\.4 \(initial\)/);
  assert.throws(
    () => releaseBatchOutputs([
      metadata({
        id: 'org.substore.config-generator',
        version: '1.2.8',
        previousVersion: '1.2.7',
        sequence: 10,
      }),
      metadata({
        id: 'org.substore.rule-studio',
        version: '0.1.4',
        previousVersion: '',
        sequence: 11,
      }),
    ]),
    /must share one repository sequence/,
  );
});

test('prepares selected extensions in deterministic order and writes one batch document', async () => {
  const calls = [];
  let written;
  let githubOutputs;
  const result = await prepareReleases({
    extensionIds: [
      'org.substore.rule-studio',
      'org.substore.config-generator',
      'org.substore.rule-studio',
    ],
    installedAtValue: '2026-08-14T00:00:00.000Z',
    bump: 'patch',
    metadataPath: '/tmp/release-batch-test.json',
    githubOutput: '/tmp/github-output',
    prepare: async options => {
      calls.push(options);
      return options.extensionId === 'org.substore.config-generator'
        ? metadata({
            id: options.extensionId,
            version: '1.2.8',
            previousVersion: '1.2.7',
          })
        : metadata({
            id: options.extensionId,
            version: '0.1.4',
            previousVersion: '',
          });
    },
    writeMetadata: async (file, value) => {
      written = { file, value };
    },
    writeOutputs: async (file, value) => {
      githubOutputs = { file, value };
    },
  });

  assert.deepEqual(calls.map(call => call.extensionId), [
    'org.substore.config-generator',
    'org.substore.rule-studio',
  ]);
  assert.equal(written.file, '/tmp/release-batch-test.json');
  assert.equal(written.value.schemaVersion, 1);
  assert.equal(written.value.releases.length, 2);
  assert.equal(githubOutputs.file, '/tmp/github-output');
  assert.deepEqual(result.document, written.value);
  assert.equal(result.outputs.release_count, 2);
});

test('restores every prepared file when a later extension fails', async () => {
  const calls = [];
  const snapshot = new Map([['manifest.json', Buffer.from('original')]]);
  let restored;

  await assert.rejects(
    prepareReleases({
      extensionIds: [
        'org.substore.config-generator',
        'org.substore.rule-studio',
      ],
      installedAtValue: '2026-08-14T00:00:00.000Z',
      bump: 'patch',
      prepare: async ({ extensionId }) => {
        calls.push(extensionId);
        if (extensionId === 'org.substore.rule-studio') {
          throw new Error('rule studio failed preflight');
        }
        return metadata({
          id: extensionId,
          version: '1.2.8',
          previousVersion: '1.2.7',
        });
      },
      snapshotFiles: async () => snapshot,
      restoreFiles: async value => {
        restored = value;
      },
    }),
    /rule studio failed preflight/,
  );

  assert.deepEqual(calls, [
    'org.substore.config-generator',
    'org.substore.rule-studio',
  ]);
  assert.equal(restored, snapshot);
});

test('resolves one immutable tag per extension from the batch environment', () => {
  const environment = {
    SUB_STORE_EXTENSION_RELEASE_TAGS: JSON.stringify({
      'org.substore.config-generator': 'org.substore.config-generator@1.2.8',
      'org.substore.rule-studio': 'org.substore.rule-studio@0.1.4',
    }),
  };
  assert.equal(
    releaseTagFromEnvironment('org.substore.config-generator', environment),
    'org.substore.config-generator@1.2.8',
  );
  assert.equal(
    releaseTagFromEnvironment('org.substore.rule-studio', environment),
    'org.substore.rule-studio@0.1.4',
  );
  assert.equal(
    releaseTagFromEnvironment('org.substore.subscription-doctor', environment),
    undefined,
  );
  assert.deepEqual(releaseTagsFromEnvironment(environment), {
    'org.substore.config-generator': 'org.substore.config-generator@1.2.8',
    'org.substore.rule-studio': 'org.substore.rule-studio@0.1.4',
  });
  assert.doesNotThrow(() => assertReleaseTagsMatchExtensions([
    { id: 'org.substore.rule-studio' },
    { id: 'org.substore.config-generator' },
  ], environment));
  assert.throws(
    () => assertReleaseTagsMatchExtensions([
      { id: 'org.substore.config-generator' },
    ], environment),
    /must match the selected extensions/,
  );
  assert.throws(
    () => releaseTagFromEnvironment('org.substore.rule-studio', {
      SUB_STORE_EXTENSION_RELEASE_TAGS: '[]',
    }),
    /must be a JSON object/,
  );
});
