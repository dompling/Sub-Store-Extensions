import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { build as esbuildBuild } from 'esbuild';
import { build as viteBuild } from 'vite';
import {
  updateFrontendAssetDigests,
  writeDigestPackage,
} from './content-package.mjs';
import {
  assert,
  buildRoot,
  canonicalJson,
  copyDirectory,
  distPackagesDirectory,
  listRegularFiles,
  loadAllExtensions,
  pathExists,
  readJson,
  readRepositoryConfig,
  repoRoot,
  repositoryDirectory,
  sha256Hex,
  verifyPackageDirectory,
  writeJson,
} from './lib.mjs';

const releaseVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;
const sha256Pattern = /^[a-f0-9]{64}$/;
const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9][a-z0-9.-]*$/;
const variantPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const parseReleaseVersion = value => {
  const match = `${value || ''}`.match(releaseVersionPattern);
  assert(match, `Repository release version is invalid: ${value || '(missing)'}`);
  return {
    core: match.slice(1, 4).map(Number),
    prerelease: match[4]?.split('.') || [],
  };
};

const compareReleaseVersions = (leftValue, rightValue) => {
  const left = parseReleaseVersion(leftValue);
  const right = parseReleaseVersion(rightValue);
  for (let index = 0; index < left.core.length; index += 1) {
    if (left.core[index] === right.core[index]) continue;
    return left.core[index] > right.core[index] ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    if (left.prerelease[index] === undefined) return -1;
    if (right.prerelease[index] === undefined) return 1;
    if (left.prerelease[index] === right.prerelease[index]) continue;
    const leftNumeric = /^\d+$/.test(left.prerelease[index]);
    const rightNumeric = /^\d+$/.test(right.prerelease[index]);
    if (leftNumeric && rightNumeric) {
      return Number(left.prerelease[index]) > Number(right.prerelease[index]) ? 1 : -1;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return left.prerelease[index].localeCompare(right.prerelease[index]) > 0 ? 1 : -1;
  }
  return 0;
};

const packageProjection = value => ({
  packageUrl: value.packageUrl,
  packageUrls: value.packageUrls,
  packageDigest: value.packageDigest,
  packageDigests: value.packageDigests,
});

const immutableReleaseProjection = value => ({
  version: value.version,
  manifest: value.manifest,
  distribution: value.distribution,
  selectedVariant: value.selectedVariant,
  ...packageProjection(value),
  installable: value.installable !== false,
});

const releaseProvenanceProjection = value => ({
  releasedAt: value.releasedAt,
  gitTag: value.gitTag || null,
  gitCommit: value.gitCommit || null,
});

const assertSameRelease = (left, right, message) => {
  assert(
    canonicalJson(immutableReleaseProjection(left))
      === canonicalJson(immutableReleaseProjection(right))
      && canonicalJson(releaseProvenanceProjection(left))
        === canonicalJson(releaseProvenanceProjection(right)),
    message,
  );
};

const normalizeReleasePackageUrl = (value, extensionId, version, variant) => {
  assert(typeof value === 'string' && value, `${extensionId}@${version} package URL is missing`);
  const expected = `./packages/${extensionId}/${version}/${variant}.json`;
  assert(value === expected, `${extensionId}@${version} package URL must be ${expected}`);
  return value;
};

const normalizeRepositoryRelease = (release, extensionId, fallback = {}) => {
  assert(release && typeof release === 'object' && !Array.isArray(release), `${extensionId} release is invalid`);
  const version = `${release.version || ''}`;
  parseReleaseVersion(version);
  assert(extensionIdPattern.test(extensionId), `Repository release extension id is invalid: ${extensionId}`);
  const manifest = release.manifest;
  assert(manifest?.id === extensionId, `${extensionId}@${version} release manifest id differs`);
  assert(manifest.version === version, `${extensionId}@${version} release manifest version differs`);
  const variants = Object.keys(release.packageUrls || {});
  assert(variants.length > 0, `${extensionId}@${version} release has no package variants`);
  assert(
    canonicalJson(variants.sort()) === canonicalJson(Object.keys(release.packageDigests || {}).sort()),
    `${extensionId}@${version} release package variants and digests differ`,
  );
  const packageUrls = {};
  const packageDigests = {};
  for (const variant of variants) {
    assert(variantPattern.test(variant), `${extensionId}@${version} package variant is invalid: ${variant}`);
    packageUrls[variant] = normalizeReleasePackageUrl(
      release.packageUrls[variant],
      extensionId,
      version,
      variant,
    );
    const digest = `${release.packageDigests[variant] || ''}`;
    assert(sha256Pattern.test(digest), `${extensionId}@${version} ${variant} package digest is invalid`);
    packageDigests[variant] = digest;
  }
  const selectedVariant = release.selectedVariant
    || Object.keys(manifest.variants || {}).find(variant => packageUrls[variant])
    || variants[0];
  assert(packageUrls[selectedVariant], `${extensionId}@${version} selected package variant is missing`);
  const releasedAtValue = release.releasedAt || fallback.releasedAt;
  const releasedAtTimestamp = Date.parse(releasedAtValue);
  assert(Number.isFinite(releasedAtTimestamp), `${extensionId}@${version} releasedAt is invalid`);
  const gitCommit = release.gitCommit || fallback.gitCommit || undefined;
  const gitTag = release.gitTag || fallback.gitTag || undefined;
  if (gitCommit !== undefined) {
    assert(/^[a-f0-9]{40}$/.test(gitCommit), `${extensionId}@${version} gitCommit is invalid`);
  }
  if (gitTag !== undefined) {
    assert(gitTag === `${extensionId}@${version}`, `${extensionId}@${version} gitTag is invalid`);
  }
  const normalized = {
    version,
    releasedAt: new Date(releasedAtTimestamp).toISOString(),
    manifest,
    distribution: release.distribution || fallback.distribution || 'community',
    selectedVariant,
    packageUrl: packageUrls[selectedVariant],
    packageUrls,
    packageDigest: packageDigests[selectedVariant],
    packageDigests,
    installable: release.installable !== false,
    ...(gitTag ? { gitTag } : {}),
    ...(gitCommit ? { gitCommit } : {}),
  };
  if (normalized.installable) {
    assert(
      manifest.kind === 'content' || manifest.kind === 'executable',
      `${extensionId}@${version} installable release kind is unsupported`,
    );
  }
  return normalized;
};

const currentRelease = document => normalizeRepositoryRelease({
  ...document.entry,
  releasedAt: new Date(Number(document.verified.receipt.installedAt)).toISOString(),
  selectedVariant: document.verified.metadata.selectedVariant,
  ...(process.env.SUB_STORE_EXTENSION_RELEASE_ID === document.entry.id
    && process.env.SUB_STORE_EXTENSION_RELEASE_TAG
    ? { gitTag: process.env.SUB_STORE_EXTENSION_RELEASE_TAG }
    : {}),
}, document.entry.id);

const mergeRepositoryReleases = (entry, previousEntry, document) => {
  const current = currentRelease(document);
  const previousReleases = previousEntry?.releases?.length
    ? previousEntry.releases
    : previousEntry
      ? [{
          ...previousEntry,
          releasedAt: previousEntry.releasedAt
            || previousEntry.manifest?.releasedAt
            || new Date(Number(document.verified.receipt.installedAt)).toISOString(),
        }]
      : [];
  const releases = new Map();
  for (const release of previousReleases) {
    const normalized = normalizeRepositoryRelease(release, entry.id);
    const existing = releases.get(normalized.version);
    if (existing) assertSameRelease(
      existing,
      normalized,
      `${entry.id}@${normalized.version} historical release is not immutable`,
    );
    releases.set(normalized.version, normalized);
  }
  const existing = releases.get(current.version);
  if (existing) {
    assert(
      canonicalJson(immutableReleaseProjection(existing))
        === canonicalJson(immutableReleaseProjection(current)),
      `${entry.id}@${current.version} release already exists with different package bytes`,
    );
    assert(
      existing.releasedAt === current.releasedAt,
      `${entry.id}@${current.version} release timestamp is immutable`,
    );
    if (current.gitTag && existing.gitTag) {
      assert(current.gitTag === existing.gitTag, `${entry.id}@${current.version} release tag is immutable`);
    }
    if (current.gitCommit && existing.gitCommit) {
      assert(current.gitCommit === existing.gitCommit, `${entry.id}@${current.version} release commit is immutable`);
    }
  }
  releases.set(current.version, {
    ...(existing || {}),
    ...current,
    gitTag: current.gitTag || existing?.gitTag,
    gitCommit: current.gitCommit || existing?.gitCommit,
  });
  const sorted = [...releases.values()]
    .sort((left, right) => compareReleaseVersions(right.version, left.version));
  assert(sorted[0]?.version === entry.version, `${entry.id} latest entry is not the highest release version`);
  return sorted;
};

const releaseLedgerDocument = entry => ({
  schemaVersion: 1,
  extensionId: entry.id,
  latestVersion: entry.version,
  releases: entry.releases,
});

export const createReleaseLedger = releaseLedgerDocument;

const verifyReleaseEnvelope = (release, variant, envelope, extensionId) => {
  const version = release.version;
  const packageDigest = release.packageDigests[variant];
  assert(envelope?.schemaVersion === 1, `${extensionId}@${version} release envelope schema is invalid`);
  assert(envelope.source, `${extensionId}@${version} release envelope source is missing`);
  assert(envelope.selectedVariant === variant, `${extensionId}@${version} release envelope variant differs`);
  assert(envelope.packageDigest === packageDigest, `${extensionId}@${version} release envelope digest differs`);
  assert(
    canonicalJson(envelope.manifest) === canonicalJson(release.manifest),
    `${extensionId}@${version} release envelope manifest differs`,
  );
  assert(
    envelope.receipt?.extensionId === extensionId && envelope.receipt?.version === version,
    `${extensionId}@${version} release receipt identity differs`,
  );
  assert(envelope.receipt.packageDigest === packageDigest, `${extensionId}@${version} release receipt digest differs`);
  assert(
    envelope.receipt.manifestDigest === sha256Hex(canonicalJson(release.manifest)),
    `${extensionId}@${version} release manifest digest differs`,
  );
  const { receiptDigest, ...receiptBody } = envelope.receipt;
  assert(
    receiptDigest === sha256Hex(canonicalJson(receiptBody)),
    `${extensionId}@${version} release receipt integrity differs`,
  );
  assert(
    canonicalJson(envelope.payload?.manifest) === canonicalJson(release.manifest),
    `${extensionId}@${version} release payload manifest differs`,
  );
  assert(envelope.payload.selectedVariant === variant, `${extensionId}@${version} release payload variant differs`);
  assert(envelope.payload.packageDigest === packageDigest, `${extensionId}@${version} release payload digest differs`);
  assert(
    canonicalJson(envelope.payload.receipt) === canonicalJson(envelope.receipt),
    `${extensionId}@${version} release payload receipt differs`,
  );
  const { packageDigest: ignoredPackageDigest, receipt: ignoredReceipt, ...packageBody } = envelope.payload;
  assert(
    sha256Hex(canonicalJson(packageBody)) === packageDigest,
    `${extensionId}@${version} historical package bytes differ from its digest`,
  );
  const fileDigests = Object.fromEntries(
    Object.entries(envelope.payload.files || {}).map(([name, content]) => [name, sha256Hex(content)]),
  );
  assert(
    canonicalJson(fileDigests) === canonicalJson(envelope.payload.fileDigests || {}),
    `${extensionId}@${version} historical file digests differ`,
  );
  assert(
    envelope.signature?.digest === sha256Hex(canonicalJson(envelope.payload)),
    `${extensionId}@${version} release payload integrity differs`,
  );
};

const mergeCatalogAndLedgerHistory = (previousCatalog, ledgers) => {
  const previousEntries = new Map(
    (previousCatalog?.entries || []).map(entry => [entry.id, entry]),
  );
  for (const ledger of ledgers) {
    assert(ledger.schemaVersion === 1, `Unsupported release ledger schema for ${ledger.extensionId}`);
    assert(ledger.extensionId, 'Release ledger extensionId is missing');
    const previous = previousEntries.get(ledger.extensionId) || { id: ledger.extensionId };
    const releases = new Map();
    for (const release of [...(ledger.releases || []), ...(previous.releases || [])]) {
      const existing = releases.get(release.version);
      if (existing) assertSameRelease(
        existing,
        release,
        `${ledger.extensionId}@${release.version} catalog and release ledger disagree`,
      );
      releases.set(release.version, release);
    }
    previousEntries.set(ledger.extensionId, {
      ...previous,
      releases: [...releases.values()],
    });
  }
  return {
    ...(previousCatalog || {}),
    entries: [...previousEntries.values()],
  };
};

const run = (command, args, options = {}) => new Promise((resolve, reject) => {
  const child = spawn(command, args, {
    cwd: options.cwd || repoRoot,
    env: options.env || process.env,
    stdio: 'inherit',
  });
  child.once('error', reject);
  child.once('exit', code => {
    if (code === 0) resolve();
    else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 1}`));
  });
});

const heading = (action, extension) => {
  process.stdout.write(`\n[${action}] ${extension.id}\n`);
};

const withBuildEnvironment = async (extension, action) => {
  const key = 'SUB_STORE_EXTENSION_BUILD_DIR';
  const previous = process.env[key];
  process.env[key] = extension.buildDirectory;
  try {
    return await action();
  } finally {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
  }
};

export const typecheckExtensions = async extensions => {
  const vueTsc = path.join(repoRoot, 'node_modules/vue-tsc/bin/vue-tsc.js');
  for (const extension of extensions) {
    if (!extension.frontend) continue;
    heading('typecheck', extension);
    await run(process.execPath, [vueTsc, '--noEmit', '-p', extension.frontend.tsconfig]);
  }
};

export const buildFrontendExtensions = async extensions => {
  for (const extension of extensions) {
    if (!extension.frontend) continue;
    heading('build:frontend', extension);
    await fs.mkdir(extension.buildDirectory, { recursive: true });
    await withBuildEnvironment(extension, () => viteBuild({
      configFile: extension.frontend.config,
      mode: 'production',
    }));
  }
};

export const backendBuildOptions = extension => {
  assert(extension.backend, `${extension.id} does not declare a backend build`);
  const aliasPlugin = {
    name: 'sub-store-extension-source-alias',
    setup(esbuild) {
      esbuild.onResolve({ filter: /^@\// }, args => {
        const base = path.join(extension.backend.sourceRoot, args.path.slice(2));
        const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]
          .find(candidate => existsSync(candidate));
        return resolved ? { path: resolved } : null;
      });
    },
  };
  return {
    absWorkingDir: path.dirname(extension.backend.sourceRoot),
    entryPoints: [extension.backend.entrypoint],
    bundle: true,
    minify: true,
    sourcemap: false,
    platform: 'node',
    format: 'cjs',
    target: 'node16',
    outfile: path.join(extension.buildDirectory, extension.backend.output),
    plugins: [aliasPlugin],
    banner: { js: "'use strict';" },
    logLevel: 'info',
  };
};

export const buildBackendExtensions = async extensions => {
  for (const extension of extensions) {
    if (!extension.backend) continue;
    heading('build:backend', extension);
    const options = backendBuildOptions(extension);
    await fs.mkdir(path.dirname(options.outfile), { recursive: true });
    await esbuildBuild(options);
  }
};

export const buildExtensions = async extensions => {
  await buildFrontendExtensions(extensions);
  for (const extension of extensions) await updateFrontendAssetDigests(extension);
  await buildBackendExtensions(extensions);
};

const findTests = async directory => {
  if (!(await pathExists(directory))) return [];
  const names = await listRegularFiles(directory);
  return names
    .filter(name => name.endsWith('.test.mjs'))
    .map(name => path.join(directory, name));
};

export const testBuiltExtensions = async extensions => {
  for (const extension of extensions) {
    const tests = await findTests(extension.testsDirectory);
    if (!tests.length) continue;
    heading('test', extension);
    await run(process.execPath, ['--test', ...tests]);
  }
  const repositoryTests = await findTests(path.join(repoRoot, 'tests'));
  if (repositoryTests.length) {
    process.stdout.write('\n[test] repository\n');
    await run(process.execPath, ['--test', ...repositoryTests]);
  }
};

export const testExtensions = async extensions => {
  await buildExtensions(extensions);
  await testBuiltExtensions(extensions);
};

export const assembleExtensions = async extensions => {
  for (const extension of extensions) {
    heading('package', extension);
    await writeDigestPackage(extension);
    await copyDirectory(extension.packageDirectory, extension.distPackageDirectory);
    const verified = await verifyPackageDirectory(extension.distPackageDirectory, extension);
    process.stdout.write(`Assembled ${extension.id}@${verified.manifest.version} ${verified.packageDigest}\n`);
  }
};

export const repositoryDocument = async extension => {
  const repositoryConfig = await readRepositoryConfig();
  const verified = await verifyPackageDirectory(extension.packageDirectory, extension);
  const version = verified.manifest.version;
  const variant = verified.metadata.selectedVariant;
  const relativePackagePath = `packages/${extension.id}/${version}/${variant}.json`;
  const packageUrl = `./${relativePackagePath}`;
  const envelope = {
    schemaVersion: 1,
    source: repositoryConfig.id,
    manifest: verified.manifest,
    receipt: verified.receipt,
    packageDigest: verified.packageDigest,
    selectedVariant: variant,
    payload: verified.payload,
    signature: verified.metadata.signature,
  };
  const entry = {
    id: extension.id,
    version,
    manifest: verified.manifest,
    distribution: extension.config.repository?.distribution || 'community',
    packageUrl,
    packageUrls: { [variant]: packageUrl },
    packageDigest: verified.packageDigest,
    packageDigests: { [variant]: verified.packageDigest },
    source: repositoryConfig.id,
    sourceName: repositoryConfig.name,
    author: extension.config.repository?.author || verified.manifest.publisher || null,
  };
  return { extension, verified, relativePackagePath, envelope, entry };
};

export const buildRepositoryCatalog = (repositoryConfig, inputDocuments, previousCatalog = null) => {
  const documents = [...inputDocuments]
    .sort((left, right) => left.entry.id.localeCompare(right.entry.id));
  const ids = documents.map(document => document.entry.id);
  assert(new Set(ids).size === ids.length, 'Repository contains duplicate extension ids');
  const previousEntries = new Map(
    (previousCatalog?.entries || []).map(entry => [entry.id, entry]),
  );
  for (const document of documents) {
    document.entry.releases = mergeRepositoryReleases(
      document.entry,
      previousEntries.get(document.entry.id),
      document,
    );
  }
  const installedTimes = documents
    .map(document => Number(document.verified.receipt.installedAt))
    .filter(Number.isFinite);
  const generatedAt = installedTimes.length
    ? new Date(Math.max(...installedTimes)).toISOString()
    : new Date(0).toISOString();
  const catalog = {
    schemaVersion: 1,
    id: repositoryConfig.id,
    name: repositoryConfig.name,
    description: repositoryConfig.description,
    sequence: repositoryConfig.sequence,
    generatedAt,
    publisher: repositoryConfig.publisher,
    entries: documents.map(document => document.entry),
  };
  return { catalog, documents };
};

export const writeRepositoryDocuments = async ({
  repositoryConfig,
  documents: inputDocuments,
  outputDirectory = repositoryDirectory,
}) => {
  const outputRoot = path.resolve(outputDirectory);
  const repositoryPackages = path.join(outputRoot, 'packages');
  const catalogPath = path.join(outputRoot, 'catalog.json');
  const previousCatalog = await pathExists(catalogPath)
    ? await readJson(catalogPath)
    : null;
  const releasesRoot = path.join(outputRoot, 'releases');
  const ledgers = [];
  for (const document of inputDocuments) {
    const ledgerPath = path.join(releasesRoot, `${document.entry.id}.json`);
    if (await pathExists(ledgerPath)) ledgers.push(await readJson(ledgerPath));
  }
  const { catalog, documents } = buildRepositoryCatalog(
    repositoryConfig,
    inputDocuments,
    mergeCatalogAndLedgerHistory(previousCatalog, ledgers),
  );
  const expectedPackageFiles = new Set();
  for (const document of documents) {
    assert(
      document.relativePackagePath.startsWith('packages/'),
      `Repository envelope must live under packages/: ${document.relativePackagePath}`,
    );
    const destination = path.resolve(outputRoot, document.relativePackagePath);
    assert(
      destination.startsWith(`${outputRoot}${path.sep}`),
      `Repository envelope escapes the output directory: ${document.relativePackagePath}`,
    );
    const existingEnvelope = await pathExists(destination)
      ? await fs.readFile(destination, 'utf8')
      : null;
    const nextEnvelope = `${JSON.stringify(document.envelope, null, 2)}\n`;
    assert(
      existingEnvelope === null || existingEnvelope === nextEnvelope,
      `${document.entry.id}@${document.entry.version} release envelope is immutable`,
    );
    if (existingEnvelope === null) await writeJson(destination, document.envelope);
    for (const release of document.entry.releases) {
      for (const packageUrl of Object.values(release.packageUrls || {})) {
        if (!packageUrl.startsWith('./packages/')) continue;
        expectedPackageFiles.add(packageUrl.slice('./packages/'.length));
      }
    }
  }
  if (await pathExists(repositoryPackages)) {
    for (const relative of await listRegularFiles(repositoryPackages)) {
      if (expectedPackageFiles.has(relative)) continue;
      await fs.rm(path.join(repositoryPackages, relative), { force: true });
    }
  }
  for (const relative of expectedPackageFiles) {
    assert(
      await pathExists(path.join(repositoryPackages, relative)),
      `Repository release envelope is missing: packages/${relative}`,
    );
  }
  for (const entry of catalog.entries) {
    await writeJson(
      path.join(releasesRoot, `${entry.id}.json`),
      releaseLedgerDocument(entry),
    );
  }
  await writeJson(catalogPath, catalog);
  return catalog;
};

export const publishRepository = async () => {
  const repositoryConfig = await readRepositoryConfig();
  const extensions = await loadAllExtensions();
  const documents = [];
  for (const extension of extensions) documents.push(await repositoryDocument(extension));
  const catalog = await writeRepositoryDocuments({ repositoryConfig, documents });
  process.stdout.write(`Published ${catalog.entries.length} extensions to ${repositoryConfig.name}\n`);
};

const verifyBuildAndDist = async (extension, source) => {
  assert(
    canonicalJson(extension.manifest) === canonicalJson(source.manifest),
    `${extension.id} source manifest differs from its package`,
  );
  const workspacePackagePath = path.join(extension.workspaceDirectory, 'package.json');
  if (await pathExists(workspacePackagePath)) {
    const workspacePackage = await readJson(workspacePackagePath);
    assert(
      workspacePackage.version === source.manifest.version,
      `${extension.id} workspace and manifest versions differ`,
    );
  }
  for (const artifact of extension.artifacts) {
    const builtPath = path.join(extension.buildDirectory, artifact.build);
    if (await pathExists(builtPath)) {
      const digest = sha256Hex(await fs.readFile(builtPath, 'utf8'));
      assert(
        digest === source.fileDigests[artifact.package],
        `${extension.id} build output differs from the packaged release: ${artifact.build}`,
      );
    }
  }
  if (await pathExists(extension.distPackageDirectory)) {
    const dist = await verifyPackageDirectory(extension.distPackageDirectory, extension);
    assert(dist.packageDigest === source.packageDigest, `${extension.id} dist package is stale`);
  }
};

export const verifyRepository = async () => {
  const repositoryConfig = await readRepositoryConfig();
  const extensions = await loadAllExtensions();
  const catalog = await readJson(path.join(repositoryDirectory, 'catalog.json'));
  assert(catalog.id === repositoryConfig.id, 'Repository catalog id differs from repository config');
  assert(catalog.name === repositoryConfig.name, 'Repository catalog name differs from repository config');
  assert(canonicalJson(catalog.publisher) === canonicalJson(repositoryConfig.publisher), 'Repository publisher differs');
  assert(catalog.entries?.length === extensions.length, 'Repository catalog entry count differs from extension workspaces');

  const expectedEnvelopeFiles = [];
  for (const extension of extensions) {
    const source = await verifyPackageDirectory(extension.packageDirectory, extension);
    await verifyBuildAndDist(extension, source);
    const entry = catalog.entries.find(item => item.id === extension.id);
    assert(entry, `Repository catalog entry is missing: ${extension.id}`);
    assert(canonicalJson(entry.manifest) === canonicalJson(source.manifest), `${extension.id} repository manifest differs`);
    const variant = source.metadata.selectedVariant;
    assert(entry.packageDigests?.[variant] === source.packageDigest, `${extension.id} repository digest differs`);
    const releases = entry.releases || [];
    assert(releases.length > 0, `${extension.id} repository release history is missing`);
    assert(releases[0].version === entry.version, `${extension.id} latest release history is stale`);
    assert(
      canonicalJson(packageProjection(releases[0])) === canonicalJson(packageProjection(entry)),
      `${extension.id} latest release package differs from the catalog entry`,
    );
    assert(
      new Set(releases.map(release => release.version)).size === releases.length,
      `${extension.id} repository contains duplicate release versions`,
    );
    const ledger = await readJson(
      path.join(repositoryDirectory, 'releases', `${extension.id}.json`),
    );
    assert(
      canonicalJson(ledger) === canonicalJson(releaseLedgerDocument(entry)),
      `${extension.id} release ledger differs from the catalog`,
    );
    for (const release of releases) {
      const normalized = normalizeRepositoryRelease(release, extension.id);
      for (const [releaseVariant, packageUrl] of Object.entries(normalized.packageUrls)) {
        if (!packageUrl.startsWith('./packages/')) continue;
        expectedEnvelopeFiles.push(packageUrl.slice('./packages/'.length));
        const releaseEnvelope = await readJson(
          path.join(repositoryDirectory, packageUrl.slice('./'.length)),
        );
        verifyReleaseEnvelope(normalized, releaseVariant, releaseEnvelope, extension.id);
      }
    }
    const packageUrl = new URL(entry.packageUrls[variant], 'https://example.invalid/catalog.json');
    const relativeEnvelope = packageUrl.pathname.replace(/^\//, '');
    const envelope = await readJson(path.join(repositoryDirectory, relativeEnvelope));
    assert(canonicalJson(envelope.payload) === canonicalJson(source.payload), `${extension.id} repository payload differs`);
    assert(canonicalJson(envelope.signature) === canonicalJson(source.metadata.signature), `${extension.id} repository signature differs`);
  }

  const actualEnvelopeFiles = await listRegularFiles(path.join(repositoryDirectory, 'packages'));
  assert(
    canonicalJson(actualEnvelopeFiles) === canonicalJson([...new Set(expectedEnvelopeFiles)].sort()),
    'Repository contains stale or missing package envelopes',
  );
  process.stdout.write(`Verified ${extensions.length} extensions in ${repositoryConfig.name}\n`);
};

export const checkExtensions = async extensions => {
  await typecheckExtensions(extensions);
  await buildExtensions(extensions);
  await assembleExtensions(extensions);
  await publishRepository();
  await testBuiltExtensions(extensions);
  await verifyRepository();
};

export const cleanGenerated = async () => {
  await fs.rm(buildRoot, { recursive: true, force: true });
  await fs.rm(distPackagesDirectory, { recursive: true, force: true });
};
