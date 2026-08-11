import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assert,
  canonicalJson,
  pathExists,
  readJson,
  sha256Hex,
  writeJson,
} from './lib.mjs';

const metadataFiles = new Set(['manifest.json', 'package.json', 'receipt.json']);

const assertPackageFileName = name => {
  assert(
    typeof name === 'string' &&
      name.length > 0 &&
      !name.startsWith('/') &&
      !name.includes('\\') &&
      !/[\u0000-\u001f\u007f]/.test(name) &&
      name.split('/').every(segment => segment && segment !== '.' && segment !== '..') &&
      !metadataFiles.has(name),
    `Unsafe or reserved package file: ${name || '(empty)'}`,
  );
};

const normalizedFiles = files => {
  assert(files && typeof files === 'object' && !Array.isArray(files), 'Package files are required');
  for (const [name, value] of Object.entries(files)) {
    assertPackageFileName(name);
    assert(typeof value === 'string', `Invalid package file: ${name}`);
  }
  assert(
    new Set(Object.keys(files).map(name => name.normalize('NFC').toLowerCase())).size === Object.keys(files).length,
    'Package contains colliding file names',
  );
  return Object.fromEntries(
    Object.entries(files).sort(([left], [right]) => left.localeCompare(right)),
  );
};

const timestampValue = createdAt => {
  const timestamp = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  assert(Number.isFinite(timestamp), 'Package createdAt must be an ISO date or epoch timestamp');
  return Math.trunc(timestamp);
};

export const createDigestPackage = ({
  manifest: sourceManifest,
  files: inputFiles,
  selectedVariant = 'node',
  source = 'community-repository',
  createdAt,
}) => {
  const files = normalizedFiles(inputFiles);
  const manifest = structuredClone(sourceManifest);
  const variant = manifest.variants?.[selectedVariant];
  assert(variant, `Extension has no ${selectedVariant} variant`);

  const containsExecutableCode = variant.containsExecutableCode === true;
  if (manifest.kind === 'content') {
    assert(!containsExecutableCode, 'Content extension variants must explicitly disable executable code');
  } else {
    assert(manifest.kind === 'executable', `Digest packages do not support extension kind: ${manifest.kind}`);
    assert(containsExecutableCode, 'Executable extension variants must declare executable code');
    assert(variant.entrypoint, 'Executable variant does not declare an entrypoint');
    assert(files[variant.entrypoint], `Executable entrypoint is not packaged: ${variant.entrypoint}`);
  }
  assert(
    variant.containsInstallHook !== true && !variant.installHook && !manifest.installHook,
    'Extension install hooks are forbidden',
  );

  const fileDigests = Object.fromEntries(
    Object.entries(files).map(([name, value]) => [name, sha256Hex(value)]),
  );
  for (const asset of Object.values(manifest.frontend?.assets || {})) {
    assert(asset?.path && files[asset.path], `Frontend asset is missing: ${asset?.path || '(unknown)'}`);
    asset.digest = fileDigests[asset.path];
  }

  const packagedVariant = manifest.variants[selectedVariant];
  const projection = {
    schemaVersion: 1,
    manifest,
    selectedVariant,
    variant: packagedVariant,
    containsExecutableCode,
    containsInstallHook: false,
    files,
    fileDigests,
  };
  const packageDigest = sha256Hex(canonicalJson(projection));
  const manifestDigest = sha256Hex(canonicalJson(manifest));
  const implementation = {
    id: packagedVariant.implementationId,
    abi: packagedVariant.implementationAbi,
    ...(packagedVariant.frontendAssetId
      ? { frontendAssetId: packagedVariant.frontendAssetId }
      : {}),
    ...(containsExecutableCode ? { entrypoint: packagedVariant.entrypoint } : {}),
    lanes: Object.fromEntries(
      Object.entries(manifest.scriptExecutionLanes || {}).map(([laneId, lane]) => [
        laneId,
        {
          product: lane.product,
          implementationId: lane.implementationId,
        },
      ]),
    ),
    containsExecutableCode,
  };
  const receiptBody = {
    schemaVersion: 1,
    extensionId: manifest.id,
    version: manifest.version,
    publisher: manifest.publisher,
    selectedVariant,
    manifestDigest,
    packageDigest,
    implementation,
    installedAt: timestampValue(createdAt),
  };
  const receipt = {
    ...receiptBody,
    receiptDigest: sha256Hex(canonicalJson(receiptBody)),
  };
  const payload = {
    ...projection,
    packageDigest,
    receipt,
  };
  const payloadDigest = sha256Hex(canonicalJson(payload));
  const signature = {
    algorithm: 'sha256-digest',
    digest: payloadDigest,
    value: payloadDigest,
  };
  const metadata = {
    schemaVersion: 1,
    source,
    packageDigest,
    payloadDigest,
    selectedVariant,
    variant: packagedVariant,
    containsExecutableCode,
    containsInstallHook: false,
    fileDigests,
    signature,
  };
  return { manifest, receipt, metadata, payload, signature };
};

export const updateFrontendAssetDigests = async extension => {
  const manifest = await readJson(extension.manifestPath);
  const assets = Object.values(manifest.frontend?.assets || {});
  if (!assets.length) return manifest;

  let changed = false;
  for (const asset of assets) {
    const artifact = extension.artifacts.find(candidate => candidate.package === asset?.path);
    assert(artifact, `Frontend asset is not declared as an artifact: ${asset?.path || '(unknown)'}`);
    const source = path.resolve(extension.buildDirectory, artifact.build);
    assert(
      source.startsWith(`${extension.buildDirectory}${path.sep}`),
      `${extension.id} frontend artifact escapes its build directory: ${artifact.build}`,
    );
    assert(await pathExists(source), `Frontend build artifact is missing: ${artifact.build}`);
    const digest = sha256Hex(await fs.readFile(source, 'utf8'));
    if (asset.digest !== digest) {
      asset.digest = digest;
      changed = true;
    }
  }
  if (changed) await writeJson(extension.manifestPath, manifest);
  extension.manifest = manifest;
  return manifest;
};

const filesForExtension = async extension => {
  if (extension.manifest.kind === 'content') {
    assert(extension.contentFiles.length > 0, `${extension.id} does not declare contentFiles`);
    return Object.fromEntries(
      await Promise.all(
        extension.contentFiles.map(async file => [file.package, await fs.readFile(file.source, 'utf8')]),
      ),
    );
  }

  assert(extension.manifest.kind === 'executable', `${extension.id} has an unsupported extension kind`);
  assert(extension.artifacts.length > 0, `${extension.id} does not declare executable artifacts`);
  return Object.fromEntries(
    await Promise.all(
      extension.artifacts.map(async artifact => {
        assertPackageFileName(artifact.package);
        const source = path.resolve(extension.buildDirectory, artifact.build);
        assert(
          source.startsWith(`${extension.buildDirectory}${path.sep}`),
          `${extension.id} build artifact escapes its build directory: ${artifact.build}`,
        );
        assert(await pathExists(source), `Build artifact is missing: ${artifact.build}`);
        return [artifact.package, await fs.readFile(source, 'utf8')];
      }),
    ),
  );
};

export const writeDigestPackage = async extension => {
  assert(
    extension.config.signature?.algorithm === 'sha256-digest',
    `${extension.id} must use sha256-digest package integrity`,
  );
  const files = await filesForExtension(extension);
  const manifest = await readJson(extension.manifestPath);
  const packageValue = createDigestPackage({
    manifest,
    files,
    selectedVariant: extension.config.package?.variant || 'node',
    source: extension.config.package?.source || 'community-repository',
    createdAt: extension.config.package?.createdAt,
  });

  await writeJson(extension.manifestPath, packageValue.manifest);
  extension.manifest = packageValue.manifest;
  await fs.rm(extension.packageDirectory, { recursive: true, force: true });
  await fs.mkdir(extension.packageDirectory, { recursive: true });
  await writeJson(path.join(extension.packageDirectory, 'manifest.json'), packageValue.manifest);
  await writeJson(path.join(extension.packageDirectory, 'receipt.json'), packageValue.receipt);
  await writeJson(path.join(extension.packageDirectory, 'package.json'), packageValue.metadata);
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.resolve(extension.packageDirectory, relative);
    assert(
      destination.startsWith(`${extension.packageDirectory}${path.sep}`),
      `${extension.id} package file escapes its package directory: ${relative}`,
    );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
  }
  return packageValue;
};
