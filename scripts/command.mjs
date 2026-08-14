import {
  buildBackendExtensions,
  buildExtensions,
  buildFrontendExtensions,
  checkExtensions,
  assembleExtensions,
  publishRepository,
  testBuiltExtensions,
  testExtensions,
  typecheckExtensions,
  verifyRepository,
} from './tasks.mjs';
import { loadAllExtensions, loadSelectedExtensions } from './lib.mjs';

const [command, ...args] = process.argv.slice(2);

const main = async () => {
  if (command === 'list') {
    for (const extension of await loadAllExtensions()) {
      process.stdout.write(
        `${extension.id}\t${extension.manifest.version}\t${extension.manifest.name}\t${extension.config.repository?.distribution || 'community'}\n`,
      );
    }
    return;
  }

  const extensions = await loadSelectedExtensions(args);
  switch (command) {
    case 'typecheck':
      await typecheckExtensions(extensions);
      break;
    case 'build:frontend':
      await buildFrontendExtensions(extensions);
      break;
    case 'build:backend':
      await buildBackendExtensions(extensions);
      break;
    case 'build':
      await buildExtensions(extensions);
      break;
    case 'test':
      await testExtensions(extensions);
      break;
    case 'test:built':
      await testBuiltExtensions(extensions);
      break;
    case 'package':
      await buildExtensions(extensions);
      await assembleExtensions(extensions);
      break;
    case 'package:assemble':
      await assembleExtensions(extensions);
      break;
    case 'repository':
      await publishRepository(extensions);
      break;
    case 'verify':
      await verifyRepository(extensions);
      break;
    case 'release:build':
    case 'check':
      await checkExtensions(extensions);
      break;
    default:
      throw new Error(`Unknown extension command: ${command || '(missing)'}`);
  }
};

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
