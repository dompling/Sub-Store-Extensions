import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assert,
  loadExtension,
  pathExists,
  readJson,
  repoRoot,
  repositoryConfigPath,
  writeJson,
} from './lib.mjs';

const argument = name => {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
};

const releaseBumps = new Set(['major', 'minor', 'patch']);

const parseVersion = value => {
  const match = `${value || ''}`.match(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/,
  );
  assert(match, `Release version is not valid semantic versioning: ${value || '(missing)'}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') || [],
  };
};

const comparePrerelease = (left, right) => {
  if (!left.length && !right.length) return 0;
  if (!left.length) return 1;
  if (!right.length) return -1;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    if (left[index] === undefined) return -1;
    if (right[index] === undefined) return 1;
    if (left[index] === right[index]) continue;
    const leftNumeric = /^\d+$/.test(left[index]);
    const rightNumeric = /^\d+$/.test(right[index]);
    if (leftNumeric && rightNumeric) return Number(left[index]) > Number(right[index]) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left[index].localeCompare(right[index]) > 0 ? 1 : -1;
  }
  return 0;
};

export const compareVersions = (leftValue, rightValue) => {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] === right.core[index]) continue;
    return left.core[index] > right.core[index] ? 1 : -1;
  }
  return comparePrerelease(left.prerelease, right.prerelease);
};

export const incrementVersion = (value, bump) => {
  assert(releaseBumps.has(bump), `Unsupported release bump: ${bump || '(missing)'}`);
  const version = parseVersion(value);
  const [major, minor, patch] = version.core;
  if (bump === 'major') return `${major + 1}.0.0`;
  if (bump === 'minor') return `${major}.${minor + 1}.0`;
  if (version.prerelease.length) return `${major}.${minor}.${patch}`;
  return `${major}.${minor}.${patch + 1}`;
};

export const resolveReleaseVersion = ({ sourceVersion, publishedVersion, bump }) => {
  parseVersion(sourceVersion);
  if (bump !== undefined) {
    assert(releaseBumps.has(bump), `Unsupported release bump: ${bump || '(missing)'}`);
  }
  if (!publishedVersion) return sourceVersion;
  parseVersion(publishedVersion);
  if (!bump) {
    assert(
      compareVersions(sourceVersion, publishedVersion) > 0,
      `Source version ${sourceVersion} must be newer than published ${publishedVersion}`,
    );
    return sourceVersion;
  }
  assert(
    compareVersions(sourceVersion, publishedVersion) === 0,
    `Workflow-managed release source ${sourceVersion} must match published ${publishedVersion} before applying a ${bump} bump`,
  );
  return incrementVersion(publishedVersion, bump);
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

export const prepareRelease = async ({
  extensionId,
  installedAtValue,
  githubOutput,
  bump,
}) => {
  assert(extensionId, '--extension is required');
  assert(installedAtValue, '--installed-at is required');
  const installedAtTimestamp = Date.parse(installedAtValue);
  assert(Number.isFinite(installedAtTimestamp), '--installed-at must be an ISO timestamp');
  const installedAt = new Date(installedAtTimestamp).toISOString();

  const extension = await loadExtension(extensionId);
  const manifest = await readJson(extension.manifestPath);
  const workspacePackage = await readJson(
    path.join(extension.workspaceDirectory, 'package.json'),
  );
  assert(
    workspacePackage.version === manifest.version,
    `${extensionId} workspace package and manifest versions differ`,
  );
  parseVersion(manifest.version);
  const versionDocuments = await Promise.all(
    extension.versionFiles.map(async file => ({ file, value: await readJson(file) })),
  );
  for (const document of versionDocuments) {
    assert(
      document.value.version === manifest.version,
      `${extensionId} release version file differs from the manifest: ${path.relative(extension.workspaceDirectory, document.file)}`,
    );
  }

  const catalogPath = path.join(repoRoot, 'repository/catalog.json');
  const catalog = await pathExists(catalogPath)
    ? await readJson(catalogPath)
    : { sequence: 0, entries: [] };
  const published = (catalog.entries || []).find(entry => entry.id === extensionId);
  const sourceVersion = manifest.version;
  const releaseVersion = resolveReleaseVersion({
    sourceVersion,
    publishedVersion: published?.version,
    bump,
  });

  assert(
    extension.config.signature?.algorithm === 'sha256-digest',
    `${extensionId} must use sha256-digest package integrity`,
  );

  const repositoryConfig = await readJson(repositoryConfigPath);
  const currentSequence = Number(repositoryConfig.sequence || 0);
  const publishedSequence = Number(catalog.sequence || 0);
  assert(Number.isInteger(currentSequence) && currentSequence >= 0, 'Repository sequence is invalid');
  assert(Number.isInteger(publishedSequence) && publishedSequence >= 0, 'Published sequence is invalid');
  repositoryConfig.sequence = Math.max(currentSequence, publishedSequence + 1);

  if (releaseVersion !== sourceVersion) {
    manifest.version = releaseVersion;
    workspacePackage.version = releaseVersion;
    extension.manifest = manifest;
    await writeJson(extension.manifestPath, manifest);
    await writeJson(path.join(extension.workspaceDirectory, 'package.json'), workspacePackage);
    for (const document of versionDocuments) {
      document.value.version = releaseVersion;
      await writeJson(document.file, document.value);
    }
  }
  await writeJson(repositoryConfigPath, repositoryConfig);

  if (extension.config.package) {
    extension.config.package.createdAt = installedAt;
    await writeJson(extension.configPath, extension.config);
  }

  const metadata = {
    extension_id: extensionId,
    version: releaseVersion,
    previous_version: published?.version || '',
    version_bump: published ? (bump || 'manual') : 'initial',
    installed_at: installedAt,
    branch_slug: extensionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/\./g, '-'),
    repository_sequence: repositoryConfig.sequence,
  };
  await appendGitHubOutput(githubOutput, metadata);
  process.stdout.write(
    `Prepared ${extensionId}@${releaseVersion} for repository sequence ${repositoryConfig.sequence}\n`,
  );
  return metadata;
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  prepareRelease({
    extensionId: argument('extension'),
    installedAtValue: argument('installed-at'),
    githubOutput: argument('github-output'),
    bump: argument('bump'),
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
