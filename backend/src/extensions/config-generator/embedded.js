import { createBackendExtensionSdkV1 } from '../backend-sdk-v1';
import { registerExtension } from '../registry';
import { createConfigGeneratorAdapter } from './adapter';
import { configGeneratorExtension } from './index';
import { bindConfigGeneratorSdk } from './sdk';

/** Register the build-time implementation used by non-Node script runtimes. */
export function registerEmbeddedConfigGenerator(manager) {
    const manifest = manager.getManifest(configGeneratorExtension.extensionId);
    bindConfigGeneratorSdk(
        createBackendExtensionSdkV1({
            extensionId: configGeneratorExtension.extensionId,
            manifest,
            store: manager.store,
        }),
    );
    const adapter = createConfigGeneratorAdapter();
    manager.registerAdapter(configGeneratorExtension.extensionId, adapter);
    registerExtension(configGeneratorExtension);
    return { adapter, contribution: configGeneratorExtension };
}

export default registerEmbeddedConfigGenerator;
