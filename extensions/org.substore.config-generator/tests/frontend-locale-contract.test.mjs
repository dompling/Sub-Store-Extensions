import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import {
  listRegularFiles,
  loadExtension,
} from '../../../scripts/lib.mjs';

const extension = await loadExtension('org.substore.config-generator');
const frontendRoot = path.join(extension.workspaceDirectory, 'frontend');
const sourceRoot = path.join(frontendRoot, 'src');
const localeRoot = path.join(
  sourceRoot,
  'extensions/config-generator/locales',
);
const localeNames = ['zh', 'en', 'ru'];

const profileSectionNames = content => [
  ...String(content).matchAll(/^\s*\[([^\]]+)\]\s*$/gm),
].map(match => match[1]);

const flattenMessages = (value, prefix = '', result = new Map()) => {
  for (const [key, child] of Object.entries(value || {})) {
    const pathKey = prefix ? `${prefix}.${key}` : key;
    if (child && typeof child === 'object' && !Array.isArray(child)) {
      flattenMessages(child, pathKey, result);
    } else {
      result.set(pathKey, child);
    }
  }
  return result;
};

const placeholders = value => [
  ...String(value).matchAll(/\{([^{}]+)\}/g),
].map(match => match[1]).sort();

const resolveMessage = (messages, key) => key
  .split('.')
  .reduce((value, segment) => value?.[segment], messages);

test('defaults QX and Loon independent editors to their complete profile skeletons', async () => {
  const targetsPath = path.join(
    sourceRoot,
    'extensions/config-generator/domain/targets.ts',
  );
  const bundled = await build({
    bundle: true,
    entryPoints: [targetsPath],
    format: 'esm',
    platform: 'node',
    write: false,
    loader: { '.png': 'dataurl' },
    plugins: [{
      name: 'config-generator-target-test-alias',
      setup(context) {
        context.onResolve({ filter: /^@\// }, args => ({
          path: path.join(sourceRoot, args.path.slice(2)),
        }));
      },
    }],
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
  const { CONFIG_GENERATOR_TARGET_REGISTRY } = await import(moduleUrl);

  assert.deepEqual(
    profileSectionNames(
      CONFIG_GENERATOR_TARGET_REGISTRY.qx.independentConfig.defaultValue,
    ),
    [
      'general',
      'rewrite_local',
      'dns',
      'policy',
      'server_local',
      'filter_local',
      'mitm',
    ],
  );
  assert.deepEqual(
    profileSectionNames(
      CONFIG_GENERATOR_TARGET_REGISTRY.loon.independentConfig.defaultValue,
    ),
    [
      'General',
      'Proxy',
      'Remote Proxy',
      'Remote Filter',
      'Proxy Group',
      'Rule',
      'Remote Rule',
      'Rewrite',
      'Remote Rewrite',
      'Host',
      'Script',
      'Remote Script',
      'Plugin',
      'MITM',
    ],
  );
});

test('ships complete zh, en and ru messages inside the extension', async () => {
  const messagesByLocale = Object.fromEntries(await Promise.all(
    localeNames.map(async locale => [
      locale,
      JSON.parse(await fs.readFile(path.join(localeRoot, `${locale}.json`), 'utf8')),
    ]),
  ));
  const baseline = flattenMessages(messagesByLocale.zh);

  assert.ok(baseline.size > 0);
  assert.equal(baseline.has('configGenerator.title'), true);
  assert.equal(baseline.has('navBar.pagesTitle.configGenerator'), true);
  assert.equal(baseline.has('tabBar.configGenerator'), true);

  for (const locale of localeNames.slice(1)) {
    const actual = flattenMessages(messagesByLocale[locale]);
    assert.deepEqual([...actual.keys()].sort(), [...baseline.keys()].sort(), locale);
    for (const [key, expected] of baseline) {
      assert.deepEqual(placeholders(actual.get(key)), placeholders(expected), `${locale}:${key}`);
    }
  }

  const sourceFiles = (await listRegularFiles(sourceRoot))
    .filter(file => /\.(?:ts|vue)$/.test(file));
  const referencedKeys = new Set();
  for (const file of sourceFiles) {
    const source = await fs.readFile(path.join(sourceRoot, file), 'utf8');
    for (const match of source.matchAll(/(['"`])(configGenerator(?:\.[A-Za-z0-9_-]+)+)\1/g)) {
      referencedKeys.add(match[2]);
    }
  }
  for (const key of referencedKeys) {
    for (const locale of localeNames) {
      assert.notEqual(resolveMessage(messagesByLocale[locale], key), undefined, `${locale}:${key}`);
    }
  }

  for (const locale of localeNames) {
    const messages = messagesByLocale[locale].configGenerator;
    assert.match(messages.emptyDescription, /Loon/);
    assert.match(messages.importDescription, /Loon/);
    assert.match(messages.policyMappings.subnet, /Clash/);
    assert.match(messages.policyMappings.subnet, /Loon/);
    assert.match(messages.policyMappings.ssid, /Clash/);
  }
});

test('registers extension messages through the Host composer instead of Host locale files', async () => {
  const files = await listRegularFiles(sourceRoot);
  const sources = await Promise.all(
    files
      .filter(file => /\.(?:ts|vue)$/.test(file))
      .map(async file => [file, await fs.readFile(path.join(sourceRoot, file), 'utf8')]),
  );
  const i18nSource = await fs.readFile(
    path.join(sourceRoot, 'extensions/config-generator/i18n.ts'),
    'utf8',
  );
  const runtimeSource = await fs.readFile(
    path.join(sourceRoot, 'extensions/config-generator/runtime-entry.ts'),
    'utf8',
  );

  assert.match(i18nSource, /mergeLocaleMessage/);
  assert.match(i18nSource, /getLocaleMessage/);
  assert.match(i18nSource, /setLocaleMessage/);
  assert.match(i18nSource, /useConfigGeneratorI18n/);
  assert.match(runtimeSource, /disposeConfigGeneratorMessages/);

  for (const [file, source] of sources) {
    if (file.endsWith('i18n.ts')) continue;
    assert.doesNotMatch(
      source,
      /\buseI18n\b/,
      `${file} must use the extension-owned i18n adapter`,
    );
  }
});

test('merges and disposes only the extension-owned locale namespaces', async () => {
  const i18nPath = path.join(
    sourceRoot,
    'extensions/config-generator/i18n.ts',
  );
  const bundled = await build({
    bundle: true,
    entryPoints: [i18nPath],
    format: 'esm',
    platform: 'node',
    write: false,
    plugins: [{
      name: 'config-generator-i18n-test-sdk',
      setup(context) {
        context.onResolve({ filter: /frontend-sdk-v1$/ }, () => ({
          namespace: 'test-sdk',
          path: 'frontend-sdk-v1',
        }));
        context.onLoad({ filter: /.*/, namespace: 'test-sdk' }, () => ({
          contents: 'export const useI18n = options => globalThis.__CONFIG_GENERATOR_TEST_USE_I18N__(options);',
          loader: 'js',
        }));
      },
    }],
  });
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`;
  const adapter = await import(moduleUrl);
  const state = Object.fromEntries(localeNames.map(locale => [locale, {
    specificWord: { save: locale },
    navBar: { pagesTitle: { extensions: locale } },
    tabBar: { sub: locale },
  }]));
  let mergeCount = 0;
  let useI18nOptions;
  const merge = (target, source) => {
    for (const [key, value] of Object.entries(source)) {
      target[key] = value && typeof value === 'object' && !Array.isArray(value)
        ? merge({ ...(target[key] || {}) }, value)
        : value;
    }
    return target;
  };
  const composer = {
    getLocaleMessage: locale => state[locale],
    mergeLocaleMessage(locale, incoming) {
      mergeCount += 1;
      state[locale] = merge({ ...state[locale] }, incoming);
    },
    setLocaleMessage(locale, incoming) {
      state[locale] = incoming;
    },
  };
  globalThis.__CONFIG_GENERATOR_TEST_USE_I18N__ = (options) => {
    useI18nOptions = options;
    return composer;
  };

  try {
    assert.equal(adapter.useConfigGeneratorI18n(), composer);
    adapter.installConfigGeneratorMessages(composer);
    assert.deepEqual(useI18nOptions, { useScope: 'global' });
    assert.equal(mergeCount, localeNames.length);
    for (const locale of localeNames) {
      assert.equal(typeof state[locale].configGenerator.title, 'string');
      assert.equal(typeof state[locale].navBar.pagesTitle.configGenerator, 'string');
      assert.equal(typeof state[locale].tabBar.configGenerator, 'string');
      assert.equal(state[locale].specificWord.save, locale);
    }

    adapter.disposeConfigGeneratorMessages();
    for (const locale of localeNames) {
      assert.equal(state[locale].configGenerator, undefined);
      assert.equal(state[locale].navBar.pagesTitle.configGenerator, undefined);
      assert.equal(state[locale].tabBar.configGenerator, undefined);
      assert.equal(state[locale].navBar.pagesTitle.extensions, locale);
      assert.equal(state[locale].tabBar.sub, locale);
      assert.equal(state[locale].specificWord.save, locale);
    }
  } finally {
    delete globalThis.__CONFIG_GENERATOR_TEST_USE_I18N__;
  }
});
