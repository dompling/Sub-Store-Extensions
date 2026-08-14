import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { writeDigestPackageToDirectory } from './content-package.mjs';
import { installLocalExtension, localHostOptions } from './install-local.mjs';
import { loadSingleExtension } from './lib.mjs';
import { buildBackendExtensions, buildFrontendExtensions } from './tasks.mjs';

export const installDevelopmentExtension = async ({
  extension,
  host = 'http://127.0.0.1:3000',
  token = '',
  temporaryParentDirectory = os.tmpdir(),
  buildFrontend = buildFrontendExtensions,
  buildBackend = buildBackendExtensions,
  writePackage = writeDigestPackageToDirectory,
  install = installLocalExtension,
}) => {
  const temporaryRoot = await fs.mkdtemp(
    path.join(temporaryParentDirectory, 'substore-extension-dev-install-'),
  );
  const packageDirectory = path.join(temporaryRoot, extension.id);

  try {
    await buildFrontend([extension]);
    await buildBackend([extension]);
    await writePackage(extension, packageDirectory, { updateSourceManifest: false });
    return await install({
      extension,
      packageDirectory,
      host,
      token,
      reinstall: true,
    });
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
};

export const runDevelopmentInstall = async (
  args = process.argv.slice(2),
  environment = process.env,
) => {
  const extension = await loadSingleExtension(args);
  const { host, token } = localHostOptions(args, environment);
  const result = await installDevelopmentExtension({ extension, host, token });

  process.stdout.write(
    `Built and installed ${extension.id}@${result.verified.manifest.version}\n` +
    `Host: ${result.host}\n`,
  );
  return result;
};

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runDevelopmentInstall().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
