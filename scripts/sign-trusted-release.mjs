import {
  createPrivateKey,
  createPublicKey,
  sign as signPayload,
} from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  assert,
  canonicalJson,
  copyDirectory,
  loadExtension,
  pathExists,
  readJson,
  repoRoot,
  sha256Hex,
  verifyPackageDirectory,
  writeJson,
} from './lib.mjs';

const argument = name => {
  const exact = process.argv.indexOf(`--${name}`);
  if (exact >= 0) return process.argv[exact + 1];
  const prefix = `--${name}=`;
  return process.argv.find(value => value.startsWith(prefix))?.slice(prefix.length);
};

const normalizedPem = value => `${value}`.trim().replace(/\r\n/g, '\n');

const extensionId = argument('extension');
const privateKeyPathValue = argument('private-key');
const keyId = argument('key-id');
const installedAtValue = argument('installed-at');
const selectedVariant = argument('variant') || 'node';

assert(extensionId, '--extension is required');
assert(privateKeyPathValue, '--private-key is required');
assert(keyId, '--key-id is required');
assert(installedAtValue, '--installed-at is required');

const installedAt = Date.parse(installedAtValue);
assert(Number.isFinite(installedAt), '--installed-at must be an ISO timestamp');

const extension = await loadExtension(extensionId);
assert(
  extension.config.signature?.algorithm === 'ed25519',
  `${extensionId} is not an Ed25519 trusted executable extension`,
);
assert(extension.publicKeyPath, `${extensionId} does not declare a public key`);

const privateKeyPath = path.resolve(repoRoot, privateKeyPathValue);
assert(await pathExists(privateKeyPath), `Private key does not exist: ${privateKeyPathValue}`);
const privateKeyRelativePath = path.relative(repoRoot, privateKeyPath);
if (
  privateKeyRelativePath &&
  !privateKeyRelativePath.startsWith(`..${path.sep}`) &&
  !path.isAbsolute(privateKeyRelativePath)
) {
  assert(
    privateKeyRelativePath === '.keys' ||
      privateKeyRelativePath.startsWith(`.keys${path.sep}`),
    'Private keys stored inside the repository must stay beneath ignored .keys/',
  );
}
const privateKeyStat = await fs.stat(privateKeyPath);
assert(
  (privateKeyStat.mode & 0o077) === 0,
  'Private key must not be readable or writable by group/other users',
);
const privateKeyPem = await fs.readFile(privateKeyPath, 'utf8');
const privateKey = createPrivateKey(privateKeyPem);
const derivedPublicKey = createPublicKey(privateKey).export({
  type: 'spki',
  format: 'pem',
});
const declaredPublicKey = await fs.readFile(extension.publicKeyPath, 'utf8');
assert(
  normalizedPem(derivedPublicKey) === normalizedPem(declaredPublicKey),
  'Private key does not match the extension public key',
);

const sourceManifest = await readJson(extension.manifestPath);
const workspacePackage = await readJson(
  path.join(extension.workspaceDirectory, 'package.json'),
);
assert(
  workspacePackage.version === sourceManifest.version,
  'Workspace package and manifest versions differ',
);

const variant = sourceManifest.variants?.[selectedVariant];
assert(variant, `Manifest does not declare variant ${selectedVariant}`);
assert(
  variant.containsExecutableCode === true,
  'Trusted release signing is only available for executable variants',
);
assert(variant.entrypoint, 'Executable variant does not declare an entrypoint');

const files = {};
for (const artifact of extension.artifacts) {
  const source = path.join(extension.buildDirectory, artifact.build);
  assert(await pathExists(source), `Build artifact is missing: ${artifact.build}`);
  files[artifact.package] = await fs.readFile(source, 'utf8');
}
assert(files[variant.entrypoint], `Variant entrypoint is not a declared artifact: ${variant.entrypoint}`);

const fileDigests = Object.fromEntries(
  Object.entries(files).map(([name, content]) => [name, sha256Hex(content)]),
);
const manifest = structuredClone(sourceManifest);
for (const asset of Object.values(manifest.frontend?.assets || {})) {
  assert(asset?.path && files[asset.path], `Frontend asset is missing: ${asset?.path || '(unknown)'}`);
  asset.digest = fileDigests[asset.path];
}

const packageProjection = {
  schemaVersion: 1,
  manifest,
  selectedVariant,
  variant,
  containsExecutableCode: true,
  containsInstallHook: false,
  files,
  fileDigests,
};
const packageDigest = sha256Hex(canonicalJson(packageProjection));
const implementation = {
  id: variant.implementationId,
  abi: variant.implementationAbi,
  frontendAssetId: variant.frontendAssetId,
  entrypoint: variant.entrypoint,
  lanes: Object.fromEntries(
    Object.entries(manifest.scriptExecutionLanes || {}).map(([laneId, lane]) => [
      laneId,
      {
        product: lane.product,
        implementationId: lane.implementationId,
      },
    ]),
  ),
  containsExecutableCode: true,
};
const receiptBody = {
  schemaVersion: 1,
  extensionId: manifest.id,
  version: manifest.version,
  publisher: manifest.publisher,
  selectedVariant,
  manifestDigest: sha256Hex(canonicalJson(manifest)),
  packageDigest,
  implementation,
  installedAt,
};
const receipt = {
  ...receiptBody,
  receiptDigest: sha256Hex(canonicalJson(receiptBody)),
};
const payload = {
  ...packageProjection,
  packageDigest,
  receipt,
};
const payloadDigest = sha256Hex(canonicalJson(payload));
const signatureValue = signPayload(
  null,
  Buffer.from(canonicalJson(payload)),
  privateKey,
).toString('base64');
const metadata = {
  schemaVersion: 1,
  source: 'org.substore.extensions',
  packageDigest,
  payloadDigest,
  selectedVariant,
  variant,
  containsExecutableCode: true,
  containsInstallHook: false,
  fileDigests,
  signature: {
    algorithm: 'ed25519',
    keyId,
    digest: payloadDigest,
    value: signatureValue,
  },
};

const stagingDirectory = await fs.mkdtemp(
  path.join(repoRoot, `.trusted-release-${extensionId}-`),
);
try {
  await writeJson(path.join(stagingDirectory, 'manifest.json'), manifest);
  await writeJson(path.join(stagingDirectory, 'receipt.json'), receipt);
  await writeJson(path.join(stagingDirectory, 'package.json'), metadata);
  for (const [name, content] of Object.entries(files)) {
    const destination = path.join(stagingDirectory, name);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content, 'utf8');
  }
  await verifyPackageDirectory(stagingDirectory, extension);

  await writeJson(extension.manifestPath, manifest);
  await copyDirectory(stagingDirectory, extension.packageDirectory);
  const verified = await verifyPackageDirectory(extension.packageDirectory, extension);
  process.stdout.write(
    `${extensionId}@${manifest.version} signed with ${keyId}\n` +
      `manifest ${verified.manifestDigest}\n` +
      `package ${verified.packageDigest}\n` +
      `payload ${verified.payloadDigest}\n`,
  );
} finally {
  await fs.rm(stagingDirectory, { recursive: true, force: true });
}
