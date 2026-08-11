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

const appendGitHubOutput = async (outputPath, values) => {
  if (!outputPath) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const normalized = `${value ?? ''}`;
    assert(!/[\r\n]/.test(normalized), `GitHub output ${key} contains a newline`);
    return `${key}=${normalized}`;
  });
  await fs.appendFile(path.resolve(outputPath), `${lines.join('\n')}\n`, 'utf8');
};

export const prepareRelease = async ({ extensionId, installedAtValue, githubOutput }) => {
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

  const catalogPath = path.join(repoRoot, 'repository/catalog.json');
  const catalog = await pathExists(catalogPath)
    ? await readJson(catalogPath)
    : { sequence: 0, entries: [] };
  const published = (catalog.entries || []).find(entry => entry.id === extensionId);
  if (published) {
    assert(
      compareVersions(manifest.version, published.version) > 0,
      `${extensionId}@${manifest.version} must be newer than published ${published.version}`,
    );
  }

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
  await writeJson(repositoryConfigPath, repositoryConfig);

  if (extension.config.package) {
    extension.config.package.createdAt = installedAt;
    await writeJson(extension.configPath, extension.config);
  }

  const metadata = {
    extension_id: extensionId,
    version: manifest.version,
    installed_at: installedAt,
    branch_slug: extensionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/\./g, '-'),
    repository_sequence: repositoryConfig.sequence,
  };
  await appendGitHubOutput(githubOutput, metadata);
  process.stdout.write(
    `Prepared ${extensionId}@${manifest.version} for repository sequence ${repositoryConfig.sequence}\n`,
  );
  return metadata;
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  prepareRelease({
    extensionId: argument('extension'),
    installedAtValue: argument('installed-at'),
    githubOutput: argument('github-output'),
  }).catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
