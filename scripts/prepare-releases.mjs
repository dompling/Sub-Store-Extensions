import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assert,
  loadExtension,
  repositoryConfigPath,
  writeJson,
} from './lib.mjs';
import { prepareRelease } from './prepare-release.mjs';

const valueAfter = (args, name) => {
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  const prefix = `${name}=`;
  return args.find(value => value.startsWith(prefix))?.slice(prefix.length);
};

const parseExtensionIds = value => {
  let parsed;
  try {
    parsed = JSON.parse(value || '[]');
  } catch {
    throw new Error('--extensions-json must be a JSON array');
  }
  assert(Array.isArray(parsed), '--extensions-json must be a JSON array');
  const extensionIds = [...new Set(parsed.map(id => `${id}`))].sort();
  assert(extensionIds.length > 0, 'At least one extension is required');
  return extensionIds;
};

const appendGitHubOutput = async (outputPath, values) => {
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const normalized = `${value ?? ''}`;
    assert(!/[\r\n]/.test(normalized), `GitHub output ${key} contains a newline`);
    return `${key}=${normalized}`;
  });
  await fs.appendFile(path.resolve(outputPath), `${lines.join('\n')}\n`, 'utf8');
};

const snapshotReleaseFiles = async extensionIds => {
  const files = new Set([repositoryConfigPath]);
  for (const extensionId of extensionIds) {
    const extension = await loadExtension(extensionId);
    files.add(extension.manifestPath);
    files.add(extension.configPath);
    files.add(path.join(extension.workspaceDirectory, 'package.json'));
    for (const versionFile of extension.versionFiles) files.add(versionFile);
  }
  return new Map(await Promise.all(
    [...files].sort().map(async file => [file, await fs.readFile(file)]),
  ));
};

const restoreReleaseFiles = async snapshot => {
  await Promise.all(
    [...snapshot].map(([file, content]) => fs.writeFile(file, content)),
  );
};

export const releaseBatchDocument = releases => ({
  schemaVersion: 1,
  releases,
});

export const releaseBatchOutputs = releases => {
  assert(releases.length > 0, 'At least one prepared release is required');
  const extensionIds = releases.map(release => release.extension_id);
  assert(
    new Set(extensionIds).size === extensionIds.length,
    'Prepared releases contain duplicate extension ids',
  );
  assert(
    new Set(releases.map(release => release.repository_sequence)).size === 1,
    'Prepared releases must share one repository sequence',
  );
  assert(
    new Set(releases.map(release => release.installed_at)).size === 1,
    'Prepared releases must share one installedAt timestamp',
  );
  for (const release of releases) {
    assert(
      release.release_tag === `${release.extension_id}@${release.version}`,
      `Prepared release tag is invalid for ${release.extension_id}`,
    );
  }
  const releaseTags = Object.fromEntries(
    releases.map(release => [release.extension_id, release.release_tag]),
  );
  const releaseSummary = releases.map(release => (
    `${release.extension_id}: ${release.previous_version || 'initial'} -> ${release.version}`
      + ` (${release.version_bump})`
  )).join('; ');
  return {
    release_count: releases.length,
    extension_ids: extensionIds.join(' '),
    extension_ids_json: JSON.stringify(extensionIds),
    release_tags: Object.values(releaseTags).join(' '),
    release_tags_json: JSON.stringify(releaseTags),
    release_summary: releaseSummary,
    repository_sequence: releases.at(-1).repository_sequence,
  };
};

export const prepareReleases = async ({
  extensionIds,
  installedAtValue,
  bump,
  metadataPath,
  githubOutput,
  prepare = prepareRelease,
  writeMetadata = writeJson,
  writeOutputs = appendGitHubOutput,
  snapshotFiles = snapshotReleaseFiles,
  restoreFiles = restoreReleaseFiles,
}) => {
  const selectedExtensionIds = [...new Set(extensionIds)].sort();
  assert(selectedExtensionIds.length > 0, 'At least one extension is required');
  const snapshot = await snapshotFiles(selectedExtensionIds);
  const releases = [];
  try {
    for (const extensionId of selectedExtensionIds) {
      releases.push(await prepare({
        extensionId,
        installedAtValue,
        bump,
      }));
    }
    const document = releaseBatchDocument(releases);
    if (metadataPath) await writeMetadata(path.resolve(metadataPath), document);
    const outputs = releaseBatchOutputs(releases);
    await writeOutputs(githubOutput, outputs);
    process.stdout.write(
      `Prepared ${releases.length} extension release${releases.length === 1 ? '' : 's'}: ${outputs.release_summary}\n`,
    );
    return { document, outputs };
  } catch (error) {
    await restoreFiles(snapshot);
    throw error;
  }
};

export const runPrepareReleases = async (args = process.argv.slice(2)) => prepareReleases({
  extensionIds: parseExtensionIds(valueAfter(args, '--extensions-json')),
  installedAtValue: valueAfter(args, '--installed-at'),
  bump: valueAfter(args, '--bump'),
  metadataPath: valueAfter(args, '--metadata'),
  githubOutput: valueAfter(args, '--github-output'),
});

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runPrepareReleases().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
