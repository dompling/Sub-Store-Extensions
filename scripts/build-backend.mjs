import { build, context } from 'esbuild';
import fs, { promises as fsPromises } from 'node:fs';
import path from 'node:path';
import { buildDirectory, repoRoot } from './lib.mjs';

const backendRoot = path.join(repoRoot, 'backend');
const sourceRoot = path.join(backendRoot, 'src');
const watch = process.argv.includes('--watch');

const aliasPlugin = {
  name: 'sub-store-extension-source-alias',
  setup(esbuild) {
    esbuild.onResolve({ filter: /^@\// }, args => {
      const base = path.join(sourceRoot, args.path.slice(2));
      const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]
        .find(candidate => fs.existsSync(candidate));
      return resolved ? { path: resolved } : null;
    });
  },
};

const options = {
  absWorkingDir: backendRoot,
  entryPoints: [path.join(sourceRoot, 'extensions/config-generator/package-entry.js')],
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: 'node',
  format: 'cjs',
  target: 'node16',
  outfile: path.join(buildDirectory, 'backend/index.cjs'),
  plugins: [aliasPlugin],
  banner: { js: "'use strict';" },
  logLevel: 'info',
};

await fsPromises.mkdir(path.dirname(options.outfile), { recursive: true });
if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
  process.stdout.write('Watching config-generator backend sources...\n');
  await new Promise(() => {});
} else {
  await build(options);
}
