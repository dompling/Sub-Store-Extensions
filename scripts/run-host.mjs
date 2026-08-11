import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

const backendCandidates = [
  process.env.SUB_STORE_BACKEND_DIR
    ? path.resolve(repoRoot, process.env.SUB_STORE_BACKEND_DIR)
    : null,
  path.resolve(repoRoot, '../Sub-Store/backend'),
  path.resolve(repoRoot, '../../Sub-Store/backend'),
].filter(Boolean);
const backendDirectory = backendCandidates.find(candidate => existsSync(candidate));
if (!backendDirectory) {
  throw new Error(`Sub-Store backend was not found. Checked: ${backendCandidates.join(', ')}`);
}
const childEnvironment = { ...process.env };
const packageSeedPath = process.env.SUB_STORE_EXTENSION_PACKAGE_SEED_PATH?.trim();
if (packageSeedPath) {
  childEnvironment.SUB_STORE_EXTENSION_PACKAGE_SEED_PATH = path.resolve(repoRoot, packageSeedPath);
} else {
  delete childEnvironment.SUB_STORE_EXTENSION_PACKAGE_SEED_PATH;
}
const child = spawn('pnpm', ['start', ...process.argv.slice(2)], {
  cwd: backendDirectory,
  stdio: 'inherit',
  env: childEnvironment,
});

child.once('exit', code => {
  process.exitCode = code ?? 1;
});
