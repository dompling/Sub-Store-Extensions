import vue from '@vitejs/plugin-vue';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';

const frontendRoot = __dirname;
const manifest = JSON.parse(readFileSync(
  path.resolve(frontendRoot, '../backend/src/extensions/subscription-doctor/manifest.json'),
  'utf8',
)) as { version?: unknown };
if (typeof manifest.version !== 'string') {
  throw new Error('Subscription-doctor manifest requires a release version');
}

const extensionBuildRoot = process.env.SUB_STORE_EXTENSION_BUILD_DIR
  || path.resolve(frontendRoot, '../build');
const sdkId = '@/extensions/frontend-sdk-v1';
const sdkGlobal = '__SUBSTORE_EXTENSION_FRONTEND_SDK_V1__';
const isSdkExternal = (id: string) => id === sdkId
  || id.endsWith('/frontend/types/frontend-sdk-v1.ts');
const isExtensionExternal = (id: string) => id === 'vue' || isSdkExternal(id);
const extensionGlobal = (id: string) => {
  if (!isExtensionExternal(id)) {
    throw new Error(`Unexpected subscription-doctor external: ${id}`);
  }
  return sdkGlobal;
};

export default defineConfig({
  root: frontendRoot,
  publicDir: false,
  plugins: [vue()],
  resolve: {
    alias: {
      '@': path.resolve(frontendRoot, 'src'),
    },
  },
  build: {
    outDir: path.resolve(extensionBuildRoot, 'frontend'),
    emptyOutDir: true,
    cssCodeSplit: false,
    sourcemap: false,
    minify: 'terser',
    target: 'es2018',
    assetsInlineLimit: Number.MAX_SAFE_INTEGER,
    lib: {
      entry: path.resolve(
        frontendRoot,
        'src/extensions/subscription-doctor/runtime-entry.ts',
      ),
      name: 'SubStoreSubscriptionDoctorExtension',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: isExtensionExternal,
      output: {
        inlineDynamicImports: true,
        globals: extensionGlobal,
        assetFileNames: asset => asset.name?.endsWith('.css')
          ? 'style.css'
          : '[name][extname]',
      },
    },
  },
  define: {
    __SUBSTORE_EXTENSION_VERSION__: JSON.stringify(manifest.version),
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
});
