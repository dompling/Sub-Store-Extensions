import { createHash, verify as verifySignature } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extensionId = 'org.substore.config-generator';
export const sourcePackageDirectory = path.join(repoRoot, 'package', extensionId);
export const buildDirectory = path.join(repoRoot, 'build');
export const distPackageDirectory = path.join(repoRoot, 'dist', 'package', extensionId);
export const repositoryDirectory = path.join(repoRoot, 'repository');
export const publicKeyPath = path.join(repoRoot, 'release', 'config-generator-public-key.pem');
const packageMetadataFiles = ['manifest.json', 'package.json', 'receipt.json'];

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
};

export const canonicalJson = value => JSON.stringify(canonicalize(value));
export const sha256Hex = value => createHash('sha256').update(value).digest('hex');

export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const pathExists = async file => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

export const copyDirectory = async (source, destination) => {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
};

const listRegularFiles = async (directory, current = directory) => {
  const names = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      names.push(...await listRegularFiles(directory, absolute));
      continue;
    }
    assert(entry.isFile(), `Package contains a non-regular file: ${absolute}`);
    names.push(path.relative(directory, absolute).split(path.sep).join('/'));
  }
  return names;
};

export const readPackage = async packageDirectory => {
  const manifest = await readJson(path.join(packageDirectory, 'manifest.json'));
  const receipt = await readJson(path.join(packageDirectory, 'receipt.json'));
  const metadata = await readJson(path.join(packageDirectory, 'package.json'));
  const declaredFiles = Object.keys(metadata.fileDigests || {}).sort();
  const actualFiles = await listRegularFiles(packageDirectory);
  const expectedFiles = [...packageMetadataFiles, ...declaredFiles].sort();
  assert(
    canonicalJson(actualFiles) === canonicalJson(expectedFiles),
    'Package contains missing, undeclared, or non-regular files',
  );
  const files = Object.fromEntries(
    await Promise.all(
      declaredFiles.map(async name => [
        name,
        await fs.readFile(path.join(packageDirectory, name), 'utf8'),
      ]),
    ),
  );
  return { manifest, receipt, metadata, files };
};

export const packageProjection = ({ manifest, metadata, files }) => ({
  schemaVersion: metadata.schemaVersion,
  manifest,
  selectedVariant: metadata.selectedVariant,
  variant: metadata.variant,
  containsExecutableCode: metadata.containsExecutableCode === true,
  containsInstallHook: metadata.containsInstallHook === true,
  files,
  fileDigests: metadata.fileDigests,
});

export const packagePayload = packageValue => ({
  ...packageProjection(packageValue),
  packageDigest: packageValue.metadata.packageDigest,
  receipt: packageValue.receipt,
});

export const verifyPackageDirectory = async packageDirectory => {
  const value = await readPackage(packageDirectory);
  assert(value.manifest.id === extensionId, `Unexpected extension id: ${value.manifest.id}`);
  assert(value.receipt.extensionId === extensionId, 'Receipt extension id does not match');
  assert(value.metadata.selectedVariant === 'node', 'Only the Node directory package is supported');
  assert(value.metadata.containsInstallHook === false, 'Install hooks are forbidden');

  const actualFileDigests = Object.fromEntries(
    Object.entries(value.files).map(([name, content]) => [name, sha256Hex(content)]),
  );
  assert(
    canonicalJson(actualFileDigests) === canonicalJson(value.metadata.fileDigests),
    'Package file digests do not match package.json',
  );

  const calculatedPackageDigest = sha256Hex(canonicalJson(packageProjection(value)));
  assert(calculatedPackageDigest === value.metadata.packageDigest, 'Package digest is stale');
  assert(value.receipt.packageDigest === calculatedPackageDigest, 'Receipt package digest is stale');

  const manifestDigest = sha256Hex(canonicalJson(value.manifest));
  assert(value.receipt.manifestDigest === manifestDigest, 'Receipt manifest digest is stale');
  const { receiptDigest, ...receiptBody } = value.receipt;
  assert(sha256Hex(canonicalJson(receiptBody)) === receiptDigest, 'Receipt digest is stale');

  for (const asset of Object.values(value.manifest.frontend?.assets || {})) {
    assert(asset?.path && asset?.digest, 'Frontend asset metadata is incomplete');
    assert(actualFileDigests[asset.path] === asset.digest, `Frontend asset digest is stale: ${asset.path}`);
  }

  const payload = packagePayload(value);
  const payloadDigest = sha256Hex(canonicalJson(payload));
  assert(payloadDigest === value.metadata.payloadDigest, 'Signed payload digest is stale');
  assert(value.metadata.signature?.digest === payloadDigest, 'Signature digest is stale');
  assert(value.metadata.signature?.algorithm === 'ed25519', 'Unsupported signature algorithm');
  const publicKey = await fs.readFile(publicKeyPath, 'utf8');
  assert(
    verifySignature(
      null,
      Buffer.from(canonicalJson(payload)),
      publicKey,
      Buffer.from(value.metadata.signature.value, 'base64'),
    ),
    'Ed25519 package signature is invalid',
  );

  return {
    ...value,
    payload,
    manifestDigest,
    packageDigest: calculatedPackageDigest,
    payloadDigest,
    fileDigests: actualFileDigests,
  };
};

export const directoryProjection = async packageDirectory => {
  const files = {};
  const visit = async (directory, prefix = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files[relative] = await fs.readFile(absolute, 'utf8');
      else throw new Error(`Unsupported package entry: ${relative}`);
    }
  };
  await visit(packageDirectory);
  return {
    schemaVersion: 1,
    format: 'substore-extension-directory-v1',
    rootName: extensionId,
    files,
  };
};
