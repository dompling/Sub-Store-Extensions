import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension, readJson } from '../../../scripts/lib.mjs';

const extensionId = 'org.substore.rule-studio';
const extension = await loadExtension(extensionId);

test('declares an executable Rule Broker provider with stable identity', async () => {
  const manifest = await readJson(extension.manifestPath);
  assert.equal(manifest.name, '规则集配置');
  assert.equal(manifest.kind, 'executable');
  assert.equal(manifest.icon, 'fa-solid fa-list-check');
  assert.equal(manifest.host.implementationAbi, 'rule-studio@1');
  assert.equal(manifest.host.backend, '>=2.36.38');
  assert.deepEqual(manifest.host.runtimes, ['node']);
  assert.equal(manifest.contributes.artifactSources[0].id, 'org.substore.rule-studio.rule-sets');
  assert.equal(manifest.contributes.artifactSources[0].contract, 'substore.rule-set@1');
  assert.ok(manifest.contributes.artifactSources[0].representations.includes('qx-filter'));
  assert.ok(manifest.permissions.some(item => item.name === 'artifact-source.register' && item.scope.includes('rule-set')));
  const networkPermission = manifest.permissions.find(item => item.name === 'network.fetch');
  assert.ok(networkPermission.scope.includes('api.github.com'));
  assert.ok(networkPermission.scope.includes('raw.githubusercontent.com'));
});

test('keeps frontend routes and version injection in the independently built package', async () => {
  const runtimeEntry = await fs.readFile(path.join(extension.workspaceDirectory, 'frontend/src/extensions/rule-studio/runtime-entry.ts'), 'utf8');
  const routes = await fs.readFile(path.join(extension.workspaceDirectory, 'frontend/src/extensions/rule-studio/routes.ts'), 'utf8');
  assert.match(runtimeEntry, /version:\s*__SUBSTORE_EXTENSION_VERSION__/);
  for (const route of ['/extensions/rule-studio', '/extensions/rule-studio/edit/:id', '/extensions/rule-studio/preview/:id']) assert.match(routes, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('uses create or update mode for the save request and returns to the previous page', async () => {
  const editor = await fs.readFile(
    path.join(
      extension.workspaceDirectory,
      'frontend/src/extensions/rule-studio/pages/EditorPage.vue',
    ),
    'utf8',
  );
  assert.match(editor, /const persisted = ref\(editing\)/);
  assert.match(editor, /saveProject\(form, persisted\.value\)/);
  assert.match(editor, /Toast\.success\(t\('ruleStudio\.saved'\)\);[\s\S]*?router\.back\(\);/);
  assert.doesNotMatch(editor, /persisted\.value = true/);
});

test('keeps catalog selection additive and converts selected items into normal URL sources', async () => {
  const editor = await fs.readFile(
    path.join(
      extension.workspaceDirectory,
      'frontend/src/extensions/rule-studio/pages/EditorPage.vue',
    ),
    'utf8',
  );
  const picker = await fs.readFile(
    path.join(
      extension.workspaceDirectory,
      'frontend/src/extensions/rule-studio/components/SourceCatalogPicker.vue',
    ),
    'utf8',
  );
  assert.match(editor, /SourceCatalogPicker/);
  assert.match(editor, /kind:\s*'url' as const/);
  assert.match(editor, /format:\s*item\.format/);
  assert.match(picker, /RULE_STUDIO_MAX_ENABLED_SOURCES/);
  assert.match(picker, /addedUrls\.has\(item\.url\)/);
  assert.match(picker, /filteredItems\.value\.slice\(0, visibleLimit\.value\)/);
});

test('does not import Host-private backend modules or another plugin source', async () => {
  const files = await fs.readdir(path.join(extension.workspaceDirectory, 'backend/src/extensions/rule-studio'), { recursive: true });
  const sources = await Promise.all(files.filter(name => name.endsWith('.js')).map(name => fs.readFile(path.join(extension.workspaceDirectory, 'backend/src/extensions/rule-studio', name), 'utf8')));
  const combined = sources.join('\n');
  assert.equal(combined.includes('@/'), false);
  assert.equal(combined.includes('config-generator'), false);
  assert.equal(combined.includes('subscription-doctor'), false);
});
