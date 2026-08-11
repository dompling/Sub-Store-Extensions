import { context } from 'esbuild';
import { build as viteBuild } from 'vite';
import { loadSelectedExtensions } from './lib.mjs';
import { backendBuildOptions } from './tasks.mjs';

const extensions = await loadSelectedExtensions(process.argv.slice(2));
const closers = [];

for (const extension of extensions) {
  if (extension.frontend) {
    const key = 'SUB_STORE_EXTENSION_BUILD_DIR';
    const previous = process.env[key];
    process.env[key] = extension.buildDirectory;
    try {
      const watcher = await viteBuild({
        configFile: extension.frontend.config,
        mode: 'production',
        build: { watch: {} },
      });
      closers.push(() => watcher.close());
    } finally {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    }
  }
  if (extension.backend) {
    const buildContext = await context(backendBuildOptions(extension));
    await buildContext.watch();
    closers.push(() => buildContext.dispose());
  }
  process.stdout.write(`Watching ${extension.id}\n`);
}

let stopping = false;
const stop = async signal => {
  if (stopping) return;
  stopping = true;
  await Promise.allSettled(closers.map(close => close()));
  process.kill(process.pid, signal);
};

process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));
await new Promise(() => {});
