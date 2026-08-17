import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import {
  assert,
  discoverExtensionIds,
  pathExists,
  readJson,
  repoRoot,
} from './lib.mjs';

const execFileAsync = promisify(execFile);
const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9][a-z0-9.-]*$/;

const valuesAfter = (args, name) => {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name) {
      assert(args[index + 1], `${name} requires a value`);
      values.push(args[index + 1]);
      index += 1;
      continue;
    }
    if (args[index].startsWith(`${name}=`)) {
      values.push(args[index].slice(name.length + 1));
    }
  }
  return values;
};

const valueAfter = (args, name) => valuesAfter(args, name)[0];

const gitOutput = async args => {
  const { stdout } = await execFileAsync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
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

export const extensionIdsFromChangedPaths = paths => [...new Set(
  paths
    .map(value => `${value}`.replaceAll('\\', '/').match(/^extensions\/([^/]+)\//)?.[1])
    .filter(Boolean),
)].sort();

const validateExtensionIds = async (
  extensionIds,
  extensionExists = extensionId => pathExists(
    path.join(repoRoot, 'extensions', extensionId, 'extension.config.json'),
  ),
) => {
  const ids = [...new Set(extensionIds)].sort();
  assert(ids.length > 0, 'No extension changes require a release');
  for (const extensionId of ids) {
    assert(extensionIdPattern.test(extensionId), `Release extension id is invalid: ${extensionId}`);
    assert(
      await extensionExists(extensionId),
      `Automatic extension removal is unsupported: ${extensionId}`,
    );
  }
  return ids;
};

export const selectAutomaticReleaseExtensions = async ({
  head,
  git = gitOutput,
  listAllExtensions = discoverExtensionIds,
  readCatalog = async () => {
    const catalogPath = path.join(repoRoot, 'repository/catalog.json');
    return await pathExists(catalogPath) ? readJson(catalogPath) : { entries: [] };
  },
  extensionExists,
}) => {
  assert(head, '--head is required for automatic release selection');
  const catalog = await readCatalog();
  const entries = catalog.entries || [];
  assert(
    new Set(entries.map(entry => entry.id)).size === entries.length,
    'Repository catalog contains duplicate extension ids',
  );
  const catalogEntries = new Map(
    entries.map(entry => [entry.id, entry]),
  );
  const allExtensionIds = await validateExtensionIds(
    await listAllExtensions(),
    extensionExists,
  );
  const workspaceIds = new Set(allExtensionIds);
  for (const published of entries) {
    assert(
      workspaceIds.has(published.id),
      `Automatic extension removal is unsupported: ${published.id}`,
    );
  }
  const releaseBaselines = {};
  const changedPaths = [];
  const extensionIds = [];

  for (const extensionId of allExtensionIds) {
    const published = catalogEntries.get(extensionId);
    let baseline = '';
    if (published) {
      assert(published.version, `Published extension version is missing: ${extensionId}`);
      const releaseTag = `${extensionId}@${published.version}`;
      try {
        baseline = (await git([
          'rev-parse',
          '--verify',
          `refs/tags/${releaseTag}^{commit}`,
        ])).trim();
      } catch {
        throw new Error(`Published release tag is missing: ${releaseTag}`);
      }
      let mergeBase;
      try {
        mergeBase = (await git(['merge-base', baseline, head])).trim();
      } catch {
        throw new Error(`Published release tag is not in the current branch history: ${releaseTag}`);
      }
      assert(
        mergeBase === baseline,
        `Published release tag is not in the current branch history: ${releaseTag}`,
      );
      releaseBaselines[extensionId] = releaseTag;
    } else {
      releaseBaselines[extensionId] = 'initial';
    }

    if (!baseline) {
      extensionIds.push(extensionId);
      changedPaths.push(`extensions/${extensionId}/`);
      continue;
    }
    const extensionChanges = (await git([
      'diff',
      '--name-only',
      '-z',
      baseline,
      head,
      '--',
      `extensions/${extensionId}`,
    ])).split('\0').filter(Boolean);
    if (!extensionChanges.length) continue;
    extensionIds.push(extensionId);
    changedPaths.push(...extensionChanges);
  }

  return {
    releaseBaselines,
    changedPaths,
    extensionIds,
  };
};

export const selectReleaseExtensions = async ({
  manualExtensionIds = [],
  head,
  git,
  listAllExtensions,
  readCatalog,
  extensionExists,
}) => {
  if (manualExtensionIds.length) {
    return {
      releaseBaselines: {},
      changedPaths: [],
      extensionIds: await validateExtensionIds(manualExtensionIds, extensionExists),
    };
  }
  return selectAutomaticReleaseExtensions({
    head,
    git,
    listAllExtensions,
    readCatalog,
    extensionExists,
  });
};

export const runReleaseSelection = async (args = process.argv.slice(2)) => {
  const head = valueAfter(args, '--head');
  const selection = await selectReleaseExtensions({
    manualExtensionIds: valuesAfter(args, '--extension'),
    head,
  });
  const outputs = {
    source_sha: head || '',
    release_baselines: JSON.stringify(selection.releaseBaselines),
    release_count: selection.extensionIds.length,
    extension_ids: JSON.stringify(selection.extensionIds),
  };
  await appendGitHubOutput(valueAfter(args, '--github-output'), outputs);
  process.stdout.write(
    selection.extensionIds.length
      ? `Selected ${selection.extensionIds.length} extension release${selection.extensionIds.length === 1 ? '' : 's'}: ${selection.extensionIds.join(', ')}\n`
      : 'No extension changes require a release\n',
  );
  return { ...selection, ...outputs };
};

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  runReleaseSelection().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
