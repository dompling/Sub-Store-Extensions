import { spawn } from 'node:child_process';
import { repoRoot } from './lib.mjs';

const children = [
  spawn('pnpm', ['exec', 'vite', 'build', '--config', 'frontend/vite.config.ts', '--watch'], {
    cwd: repoRoot,
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['scripts/build-backend.mjs', '--watch'], {
    cwd: repoRoot,
    stdio: 'inherit',
  }),
];

const stop = signal => {
  for (const child of children) child.kill(signal);
};
process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

const result = await Promise.race(
  children.map(child => new Promise(resolve => child.once('exit', code => resolve(code ?? 1)))),
);
stop('SIGTERM');
process.exitCode = result;
