import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { defineConfig } from 'vite';

const frontendRoot = __dirname;
const extensionBuildRoot = process.env.SUB_STORE_EXTENSION_BUILD_DIR
  || path.resolve(frontendRoot, '../build');
const sdkId = '@/extensions/frontend-sdk-v1';
const sdkGlobal = '__SUBSTORE_EXTENSION_FRONTEND_SDK_V1__';
const isSdkExternal = (id: string) => id === sdkId
  || id.endsWith('/frontend/types/frontend-sdk-v1.ts');
const isExtensionExternal = (id: string) => id === 'vue' || isSdkExternal(id);
const extensionGlobal = (id: string) => {
  if (!isExtensionExternal(id)) {
    throw new Error(`Unexpected config-generator external: ${id}`);
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
      entry: path.resolve(frontendRoot, 'src/extensions/config-generator/runtime-entry.ts'),
      name: 'SubStoreConfigGeneratorExtension',
      formats: ['iife'],
      fileName: () => 'index.js',
    },
    rollupOptions: {
      external: isExtensionExternal,
      output: {
        inlineDynamicImports: true,
        globals: extensionGlobal,
        assetFileNames: asset => asset.name?.endsWith('.css') ? 'style.css' : '[name][extname]',
      },
    },
  },
  css: {
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/assets/styles/custom_variables.scss";@import "@nutui/nutui/dist/styles/variables-jdt.scss";@import "@/assets/styles/mixins.scss";`,
        silenceDeprecations: ['import', 'legacy-js-api'],
      },
    },
  },
  define: {
    __VUE_I18N_FULL_INSTALL__: true,
    __VUE_I18N_LEGACY_API__: false,
    __INTLIFY_PROD_DEVTOOLS__: false,
  },
});
