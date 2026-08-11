import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assert,
  canonicalJson,
  sha256Hex,
  writeJson,
} from './lib.mjs';

export const createDigestContentPackage = ({
  manifest,
  files,
  selectedVariant = 'node',
  source = 'community-repository',
  createdAt,
  keyId = `community-${manifest?.id || 'extension'}`,
}) => {
  assert(manifest?.kind === 'content', 'Digest-only packages are limited to content extensions');
  const variant = manifest.variants?.[selectedVariant];
  assert(variant, `Content extension has no ${selectedVariant} variant`);
  assert(
    variant.containsExecutableCode === false,
    'Content extension variants must explicitly disable executable code',
  );
  assert(files && typeof files === 'object' && !Array.isArray(files), 'Content package files are required');
  for (const [name, value] of Object.entries(files)) {
    assert(name && typeof value === 'string', `Invalid content package file: ${name || '(empty)'}`);
  }

  const fileDigests = Object.fromEntries(
    Object.entries(files)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => [name, sha256Hex(value)]),
  );
  const projection = {
    schemaVersion: 1,
    manifest,
    selectedVariant,
    variant,
    containsExecutableCode: false,
    containsInstallHook: false,
    files,
    fileDigests,
  };
  const packageDigest = sha256Hex(canonicalJson(projection));
  const manifestDigest = sha256Hex(canonicalJson(manifest));
  const timestamp = typeof createdAt === 'number' ? createdAt : Date.parse(createdAt);
  assert(Number.isFinite(timestamp), 'Content package createdAt must be an ISO date or epoch timestamp');
  const receiptBody = {
    schemaVersion: 1,
    extensionId: manifest.id,
    version: manifest.version,
    publisher: manifest.publisher,
    selectedVariant,
    manifestDigest,
    packageDigest,
    implementation: {
      id: variant.implementationId,
      abi: variant.implementationAbi,
      ...(variant.frontendAssetId ? { frontendAssetId: variant.frontendAssetId } : {}),
      lanes: manifest.scriptExecutionLanes || {},
      containsExecutableCode: false,
    },
    installedAt: Math.trunc(timestamp),
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
    keyId,
    digest: payloadDigest,
    value: payloadDigest,
  };
  const metadata = {
    schemaVersion: 1,
    source,
    packageDigest,
    payloadDigest,
    selectedVariant,
    variant,
    containsExecutableCode: false,
    containsInstallHook: false,
    fileDigests,
    signature,
  };
  return { manifest, receipt, metadata, payload, signature };
};

export const writeDigestContentPackage = async extension => {
  assert(
    extension.config.signature?.algorithm === 'sha256-digest',
    `${extension.id} is not a digest-only content extension`,
  );
  assert(extension.contentFiles.length > 0, `${extension.id} does not declare contentFiles`);
  const files = Object.fromEntries(
    await Promise.all(
      extension.contentFiles.map(async file => [file.package, await fs.readFile(file.source, 'utf8')]),
    ),
  );
  const packageValue = createDigestContentPackage({
    manifest: extension.manifest,
    files,
    selectedVariant: extension.config.package?.variant || 'node',
    source: extension.config.package?.source || 'community-repository',
    createdAt: extension.config.package?.createdAt,
    keyId: extension.config.signature.keyId || `community-${extension.id}`,
  });

  await fs.rm(extension.packageDirectory, { recursive: true, force: true });
  await fs.mkdir(extension.packageDirectory, { recursive: true });
  await writeJson(path.join(extension.packageDirectory, 'manifest.json'), packageValue.manifest);
  await writeJson(path.join(extension.packageDirectory, 'receipt.json'), packageValue.receipt);
  await writeJson(path.join(extension.packageDirectory, 'package.json'), packageValue.metadata);
  for (const [relative, content] of Object.entries(files)) {
    const destination = path.resolve(extension.packageDirectory, relative);
    assert(
      destination.startsWith(`${extension.packageDirectory}${path.sep}`),
      `${extension.id} content file escapes its package directory: ${relative}`,
    );
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
  }
  return packageValue;
};
