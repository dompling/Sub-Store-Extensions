import path from 'node:path';
import {
  extensionId,
  repositoryDirectory,
  sourcePackageDirectory,
  verifyPackageDirectory,
  writeJson,
} from './lib.mjs';

const verified = await verifyPackageDirectory(sourcePackageDirectory);
const version = verified.manifest.version;
const packagePath = `./packages/${extensionId}/${version}/node.json`;
const envelope = {
  schemaVersion: 1,
  source: 'sub-store-config-generator-repository',
  manifest: verified.manifest,
  receipt: verified.receipt,
  packageDigest: verified.packageDigest,
  selectedVariant: verified.metadata.selectedVariant,
  payload: verified.payload,
  signature: verified.metadata.signature,
};
const catalog = {
  schemaVersion: 1,
  sequence: 1,
  generatedAt: new Date(verified.receipt.installedAt).toISOString(),
  publisher: {
    id: verified.manifest.publisher.id,
    name: verified.manifest.publisher.name,
  },
  entries: [
    {
      id: extensionId,
      version,
      manifest: verified.manifest,
      distribution: 'trusted-official-mirror',
      packageUrl: packagePath,
      packageUrls: { node: packagePath },
      packageDigest: verified.packageDigest,
      packageDigests: { node: verified.packageDigest },
      source: 'sub-store-config-generator-repository',
      sourceName: 'Sub-Store Config Generator',
    },
  ],
};

await writeJson(
  path.join(repositoryDirectory, 'packages', extensionId, version, 'node.json'),
  envelope,
);
await writeJson(path.join(repositoryDirectory, 'catalog.json'), catalog);
process.stdout.write(`Published deterministic repository for ${extensionId}@${version}\n`);
