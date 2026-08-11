import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildDirectory,
  canonicalJson,
  distPackageDirectory,
  extensionId,
  pathExists,
  readJson,
  repositoryDirectory,
  sha256Hex,
  sourcePackageDirectory,
  verifyPackageDirectory,
} from './lib.mjs';

const source = await verifyPackageDirectory(sourcePackageDirectory);

for (const [built, packaged] of [
  ['backend/index.cjs', 'backend/index.cjs'],
  ['frontend/index.js', 'frontend/index.js'],
  ['frontend/style.css', 'frontend/style.css'],
]) {
  const builtPath = path.join(buildDirectory, built);
  if (await pathExists(builtPath)) {
    const digest = sha256Hex(await fs.readFile(builtPath, 'utf8'));
    if (digest !== source.fileDigests[packaged]) {
      throw new Error(`Build output differs from the signed release: ${built}`);
    }
  }
}

if (await pathExists(distPackageDirectory)) {
  const dist = await verifyPackageDirectory(distPackageDirectory);
  if (dist.packageDigest !== source.packageDigest) {
    throw new Error('Dist package does not match the tracked signed package');
  }
}

const catalog = await readJson(path.join(repositoryDirectory, 'catalog.json'));
const entry = catalog.entries?.find(item => item.id === extensionId);
if (!entry) throw new Error('Repository catalog entry is missing');
if (canonicalJson(entry.manifest) !== canonicalJson(source.manifest)) {
  throw new Error('Repository manifest differs from the signed package');
}
if (entry.packageDigests?.node !== source.packageDigest) {
  throw new Error('Repository package digest differs from the signed package');
}
const packageUrl = new URL(entry.packageUrls.node, 'https://example.invalid/catalog.json');
const repositoryPackagePath = path.join(repositoryDirectory, packageUrl.pathname.replace(/^\//, ''));
const envelope = await readJson(repositoryPackagePath);
if (canonicalJson(envelope.payload) !== canonicalJson(source.payload)) {
  throw new Error('Repository package payload differs from the directory package');
}
if (canonicalJson(envelope.signature) !== canonicalJson(source.metadata.signature)) {
  throw new Error('Repository package signature differs from the directory package');
}

process.stdout.write(
  `Verified ${extensionId}@${source.manifest.version}\n` +
  `packageDigest: ${source.packageDigest}\n` +
  `payloadDigest: ${source.payloadDigest}\n`,
);
