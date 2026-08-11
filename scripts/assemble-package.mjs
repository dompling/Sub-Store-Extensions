import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  buildDirectory,
  copyDirectory,
  distPackageDirectory,
  sourcePackageDirectory,
  verifyPackageDirectory,
} from './lib.mjs';

await copyDirectory(sourcePackageDirectory, distPackageDirectory);
await fs.copyFile(
  path.join(buildDirectory, 'backend/index.cjs'),
  path.join(distPackageDirectory, 'backend/index.cjs'),
);
await fs.copyFile(
  path.join(buildDirectory, 'frontend/index.js'),
  path.join(distPackageDirectory, 'frontend/index.js'),
);
await fs.copyFile(
  path.join(buildDirectory, 'frontend/style.css'),
  path.join(distPackageDirectory, 'frontend/style.css'),
);

const verified = await verifyPackageDirectory(distPackageDirectory);
process.stdout.write(`Assembled verified package ${verified.packageDigest}\n${distPackageDirectory}\n`);
