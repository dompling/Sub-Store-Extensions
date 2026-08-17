import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension, readJson } from '../../../scripts/lib.mjs';

const extensionId = 'org.substore.subscription-doctor';
const extension = await loadExtension(extensionId);

const read = relative => fs.readFile(path.join(extension.workspaceDirectory, relative), 'utf8');

test('declares the lightweight Node-only Resource Broker permission contract', async () => {
  const manifest = await readJson(extension.manifestPath);
  const workspacePackage = await readJson(path.join(extension.workspaceDirectory, 'package.json'));
  assert.equal(manifest.version, workspacePackage.version);
  assert.equal(manifest.kind, 'executable');
  assert.equal(manifest.host.backend, '>=2.36.37');
  assert.deepEqual(manifest.host.runtimes, ['node']);
  assert.deepEqual(manifest.requires.hard, ['resource-broker@1', 'route-gateway@1']);
  const permissions = new Map(manifest.permissions.map(value => [value.name, value]));
  assert.deepEqual([...permissions.keys()], [
    'storage.own',
    'resources.list',
    'resources.read',
    'resources.produce',
    'routes.namespaced',
    'navigation.register',
  ]);
  for (const name of ['resources.list', 'resources.read', 'resources.produce']) {
    assert.deepEqual(permissions.get(name).scope, ['subscription', 'collection']);
  }
  assert.equal(permissions.has('network.fetch'), false);
  assert.deepEqual(workspacePackage, {
    name: '@sub-store/extension-subscription-doctor',
    version: '0.1.2',
    private: true,
    type: 'module',
  });
});

test('keeps the backend graph limited to Node built-ins and its own source tree', async () => {
  const pending = [extension.backend.entrypoint];
  const visited = new Set();
  const externals = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file) || file.endsWith('.json')) continue;
    visited.add(file);
    const source = await fs.readFile(file, 'utf8');
    for (const match of source.matchAll(/\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) {
        externals.add(specifier);
        continue;
      }
      const base = path.resolve(path.dirname(file), specifier);
      const candidates = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')];
      let resolved;
      for (const candidate of candidates) {
        try {
          if ((await fs.stat(candidate)).isFile()) { resolved = candidate; break; }
        } catch {}
      }
      assert.ok(resolved, `unresolved ${specifier} from ${file}`);
      pending.push(resolved);
    }
  }
  assert.deepEqual([...externals].sort(), ['node:crypto', 'node:net', 'node:perf_hooks']);
  assert.equal([...visited].every(file => file.startsWith(extension.backend.sourceRoot)), true);
  const bundle = await fs.readFile(path.join(extension.buildDirectory, 'backend/index.cjs'), 'utf8');
  assert.equal(bundle.includes("require('@/"), false);
  assert.equal(bundle.includes('useSubsStore'), false);
});

test('registers two Host-owned frontend routes and matching zh/en/ru locale trees', async () => {
  const routes = await read('frontend/src/extensions/subscription-doctor/routes.ts');
  assert.match(routes, /path: SUBSCRIPTION_DOCTOR_PATH/);
  assert.match(routes, /\/report\/:id/);
  assert.match(routes, /backPath: '\/extensions'/);
  assert.match(routes, /backPath: SUBSCRIPTION_DOCTOR_PATH/);

  const localeDirectory = path.join(
    extension.workspaceDirectory,
    'frontend/src/extensions/subscription-doctor/locales',
  );
  const locales = await Promise.all(['zh', 'en', 'ru'].map(name => readJson(path.join(localeDirectory, `${name}.json`))));
  const keys = value => Object.entries(value).flatMap(([key, child]) => (
    child && typeof child === 'object' && !Array.isArray(child)
      ? keys(child).map(nested => `${key}.${nested}`)
      : [key]
  )).sort();
  assert.deepEqual(keys(locales[0]), keys(locales[1]));
  assert.deepEqual(keys(locales[0]), keys(locales[2]));
});

test('keeps the UI Host-aligned, accessible and free of polling or private Host store coupling', async () => {
  const home = await read('frontend/src/extensions/subscription-doctor/pages/HomePage.vue');
  const result = await read('frontend/src/extensions/subscription-doctor/pages/ResultPage.vue');
  const runtime = await read('frontend/src/extensions/subscription-doctor/runtime-entry.ts');
  const combined = `${home}\n${result}\n${runtime}`;
  assert.match(home, /aria-label=/);
  assert.match(home, /<nut-picker/);
  assert.match(home, /<nut-swipe/);
  assert.match(home, /font-awesome-icon/);
  assert.match(result, /compatibility-list/);
  assert.match(result, /quality-list/);
  assert.doesNotMatch(combined, /<select\b|<option\b/i);
  assert.match(home, /min-height:\s*48px/);
  assert.match(home, /\.source-form :deep\(\.nut-form-item__body\)\s*\{[^}]*flex:\s*1/s);
  assert.match(home, /\.source-form :deep\(\.nut-form-item__body__slots\)\s*\{[^}]*width:\s*100%/s);
  assert.match(home, /\.source-picker\s*\{[^}]*width:\s*100%/s);
  assert.match(home, /\.source-picker > span\s*\{[^}]*flex:\s*1/s);
  assert.match(home, /\.source-picker > span\s*\{[^}]*justify-items:\s*end/s);
  assert.doesNotMatch(home, /<small v-if="selectedResource">/);
  assert.match(result, /min-height:\s*44px/);
  assert.match(combined, /overflow-x:\s*clip/);
  assert.doesNotMatch(combined, /linear-gradient|summary-card|metric-grid|status-symbol|eyebrow/);
  assert.doesNotMatch(combined, /fa-(?:copy|download|signal|tv|location-dot|file-circle-check)/);
  assert.doesNotMatch(combined, /useSubsStore|setInterval|setTimeout|cron|WebSocket/);
  assert.match(runtime, /version:\s*__SUBSTORE_EXTENSION_VERSION__/);
  assert.doesNotMatch(runtime, /version:\s*['"]\d+\.\d+\.\d+/);
});

test('does not create background work or persist complete node objects', async () => {
  const backendFiles = [];
  const root = path.join(
    extension.workspaceDirectory,
    'backend/src/extensions/subscription-doctor',
  );
  const visit = async directory => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.name.endsWith('.js')) backendFiles.push(await fs.readFile(absolute, 'utf8'));
    }
  };
  await visit(root);
  const source = backendFiles.join('\n');
  assert.doesNotMatch(
    source,
    /\b(?:setInterval|setTimeout|scheduleJob)\s*\(|\bnode-cron\b|new\s+WebSocket\s*\(/,
  );

  const store = await read('backend/src/extensions/subscription-doctor/store.js');
  assert.doesNotMatch(store, /nodes\s*:/);
  assert.doesNotMatch(store, /server\s*:/);
  assert.doesNotMatch(store, /password\s*:/);
  assert.doesNotMatch(store, /uuid\s*:/i);
});
