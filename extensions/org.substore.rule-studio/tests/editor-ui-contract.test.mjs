import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension } from '../../../scripts/lib.mjs';

const extension = await loadExtension('org.substore.rule-studio');
const frontendRoot = path.join(extension.workspaceDirectory, 'frontend/src/extensions/rule-studio');

test('uses a flat host-style form, source summaries and bottom editor popup', async () => {
  const editor = await fs.readFile(path.join(frontendRoot, 'pages/EditorPage.vue'), 'utf8');

  assert.match(editor, /<nut-form/);
  assert.match(editor, /class="source-summary-card"/);
  assert.match(editor, /<nut-popup/);
  assert.match(editor, /sourceEditorVisible/);
  assert.equal(editor.includes('basicOpen'), false);
  assert.equal(editor.includes('sourcesOpen'), false);
  assert.equal(editor.includes('optionsOpen'), false);
  assert.equal(editor.includes('project-overview-card'), false);
  assert.equal(editor.includes('overview-metrics'), false);
  assert.match(editor, /class="editor-sections"/);
  assert.equal(editor.includes('sticky-title-wrapper'), false);
  assert.equal(editor.includes('section-title'), false);
  assert.equal(editor.includes('section-summary'), false);
  assert.equal(editor.includes('rect-down'), false);
  assert.equal(editor.includes('rect-right'), false);
  assert.match(
    editor,
    /<nut-form class="form" :model-value="form">[\s\S]*?v-model\.trim="form\.name"[\s\S]*?v-model="form\.description"[\s\S]*?v-model="form\.options\.deduplicate"[\s\S]*?v-model="form\.options\.preserveComments"[\s\S]*?<\/nut-form>/,
  );
  assert.match(editor, /class="source-kind-grid"/);
  assert.match(editor, /class="source-theme-panel"/);
  assert.match(editor, /v-model\.trim="form\.name"[\s\S]*?class="nut-input-text"/);
  assert.match(editor, /v-model="form\.description"[\s\S]*?class="nut-input-text"/);
  assert.match(editor, /class="icon-url-form-item"/);
  assert.match(editor, /v-model\.trim="form\.iconUrl"/);
  assert.equal(editor.includes('project-icon-picker'), false);
  assert.equal(editor.includes('project-icon-preview'), false);
  assert.match(editor, /class="icon-repository-button"/);
  assert.match(editor, /<IconPopup/);
  assert.match(editor, /@setIcon="setIconFromRepository"/);
  assert.match(editor, /Toast\.success\(t\('ruleStudio\.saved'\)\);[\s\S]*?router\.back\(\);/);
  assert.equal(editor.includes("router.replace(`/extensions/rule-studio/edit/"), false);
  assert.match(editor, /v-model\.trim="sourceDraft\.name"[\s\S]*?class="nut-input-text"/);
  assert.match(editor, /v-model="sourceDraft\.url"[\s\S]*?class="nut-input-text"/);
  assert.match(editor, /v-model="sourceDraft\.content"[\s\S]*?class="nut-input-text"/);
  assert.match(editor, /closeable/);
  assert.match(editor, /:lock-scroll="true"/);
  assert.match(editor, /:safe-area-inset-bottom="true"/);
  assert.match(editor, /@closed="resetSourceEditor"/);
  assert.match(editor, /\.preview-action\s*\{[^}]*flex:\s*0 0 40%/s);
  assert.match(editor, /\.save-action\s*\{[^}]*flex:\s*0 0 calc\(60% - 6px\)/s);
  assert.match(editor, /max-width:\s*900px/);
  assert.equal(/<select\b/i.test(editor), false);
  assert.equal(/<option\b/i.test(editor), false);
});

test('preview uses a compact format picker, copy action and grouped diagnostics', async () => {
  const preview = await fs.readFile(path.join(frontendRoot, 'pages/PreviewPage.vue'), 'utf8');

  assert.match(preview, /class="preview-header-card"/);
  assert.match(preview, /class="representation-field"/);
  assert.match(preview, /<RuleStudioOptionPicker/);
  assert.match(preview, /copyOutput/);
  assert.match(preview, /class="summary-grid"/);
  assert.match(preview, /diagnosticGroups/);
  assert.equal(preview.includes('representation-tabs'), false);
  assert.equal(/<select\b/i.test(preview), false);
  assert.equal(/<option\b/i.test(preview), false);
});

test('catalog picker consumes enabled catalogs without configuring libraries inside the editor', async () => {
  const [picker, editor] = await Promise.all([
    fs.readFile(path.join(frontendRoot, 'components/SourceCatalogPicker.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'pages/EditorPage.vue'), 'utf8'),
  ]);

  assert.match(picker, /catalogs:\s*RuleStudioSourceCatalog\[\]/);
  assert.match(picker, /catalogResults/);
  assert.match(picker, /<nut-popup/);
  assert.match(picker, /pop-class="rule-studio-catalog-picker-popup"/);
  assert.match(picker, /:lock-scroll="true"/);
  assert.match(picker, /:z-index="13000"/);
  assert.equal(picker.includes('<Teleport'), false);
  assert.equal(picker.includes('position: fixed'), false);
  assert.equal(picker.includes('previousBodyOverflow'), false);
  assert.equal(picker.includes('bodyLocked'), false);
  assert.equal(picker.includes("pickerPurpose = ref<'library' | 'filter'>"), false);
  assert.equal(picker.includes('openLibraryPicker'), false);
  assert.match(editor, /class="catalog-empty-action"/);
  assert.match(editor, /goCatalogSettings/);
  assert.match(editor, /router\.push\('\/extensions\/rule-studio\/catalogs'\)/);
});
