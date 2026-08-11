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

export const buildRepositoryCatalog = (repositoryConfig, inputDocuments) => {
  const documents = [...inputDocuments]
    .sort((left, right) => left.entry.id.localeCompare(right.entry.id));
  const ids = documents.map(document => document.entry.id);
  assert(new Set(ids).size === ids.length, 'Repository contains duplicate extension ids');
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
  const { catalog, documents } = buildRepositoryCatalog(repositoryConfig, inputDocuments);
  const outputRoot = path.resolve(outputDirectory);
  const repositoryPackages = path.join(outputRoot, 'packages');
  await fs.rm(repositoryPackages, { recursive: true, force: true });
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
    await writeJson(destination, document.envelope);
  }
  await writeJson(path.join(outputRoot, 'catalog.json'), catalog);
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
    const packageUrl = new URL(entry.packageUrls[variant], 'https://example.invalid/catalog.json');
    const relativeEnvelope = packageUrl.pathname.replace(/^\//, '');
    expectedEnvelopeFiles.push(relativeEnvelope.replace(/^packages\//, ''));
    const envelope = await readJson(path.join(repositoryDirectory, relativeEnvelope));
    assert(canonicalJson(envelope.payload) === canonicalJson(source.payload), `${extension.id} repository payload differs`);
    assert(canonicalJson(envelope.signature) === canonicalJson(source.metadata.signature), `${extension.id} repository signature differs`);
  }

  const actualEnvelopeFiles = await listRegularFiles(path.join(repositoryDirectory, 'packages'));
  assert(
    canonicalJson(actualEnvelopeFiles) === canonicalJson(expectedEnvelopeFiles.sort()),
    'Repository contains stale or missing package envelopes',
  );
  process.stdout.write(`Verified ${extensions.length} extensions in ${repositoryConfig.name}\n`);
};

export const checkExtensions = async extensions => {
  await typecheckExtensions(extensions);
  await buildExtensions(extensions);
  await testBuiltExtensions(extensions);
  await assembleExtensions(extensions);
  await publishRepository();
  await verifyRepository();
};

export const cleanGenerated = async () => {
  await fs.rm(buildRoot, { recursive: true, force: true });
  await fs.rm(distPackagesDirectory, { recursive: true, force: true });
};
