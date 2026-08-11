import { spawn } from 'node:child_process';
import path from 'node:path';
import { repoRoot } from './lib.mjs';

const backendDirectory = path.resolve(
  repoRoot,
  process.env.SUB_STORE_BACKEND_DIR || '../Sub-Store/backend',
);
const child = spawn('pnpm', ['start', ...process.argv.slice(2)], {
  cwd: backendDirectory,
  stdio: 'inherit',
  env: {
    ...process.env,
    SUB_STORE_EXTENSION_PACKAGE_SEED_PATH: path.join(repoRoot, 'package'),
  },
});

child.once('exit', code => {
  process.exitCode = code ?? 1;
});
