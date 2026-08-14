import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension } from '../../../scripts/lib.mjs';

const extension = await loadExtension('org.substore.rule-studio');
const frontendRoot = path.join(
  extension.workspaceDirectory,
  'frontend/src/extensions/rule-studio',
);

test('uses Host pickers or explicit option cards instead of native selects for every rule-studio choice', async () => {
  const [editor, catalog, preview, settings, optionPicker] = await Promise.all([
    fs.readFile(path.join(frontendRoot, 'pages/EditorPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'components/SourceCatalogPicker.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'pages/PreviewPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'pages/CatalogSettingsPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'components/RuleStudioOptionPicker.vue'), 'utf8'),
  ]);
  const combined = `${editor}\n${catalog}\n${preview}\n${settings}\n${optionPicker}`;

  assert.equal(/<select\b/i.test(combined), false);
  assert.equal(/<option\b/i.test(combined), false);
  assert.equal(/<nut-picker\b/i.test(combined), false);
  assert.match(editor, /<RuleStudioOptionPicker/);
  assert.match(editor, /openSourceFormatPicker/);
  assert.match(editor, /class="source-kind-grid"/);
  assert.match(catalog, /<RuleStudioOptionPicker/);
  assert.match(catalog, /openFilterPicker/);
  assert.match(catalog, /allow-empty/);
  assert.match(catalog, /<nut-popup/);
  assert.match(catalog, /rule-studio-catalog-picker-popup/);
  assert.match(catalog, /handleVisibleChange/);
  assert.match(catalog, /\.catalog-item\s*\{[^}]*background:\s*var\(--card-color\)/s);
  assert.equal(catalog.includes('<Teleport'), false);
  assert.match(catalog, /else\s*\{[\s\S]*pickerVisible\.value\s*=\s*false/);
  assert.match(preview, /<RuleStudioOptionPicker/);
  assert.match(preview, /openRepresentationPicker/);
  assert.match(settings, /<RuleStudioOptionPicker/);
  assert.match(settings, /RULE_STUDIO_FORMATS\s*\n\s*\.filter\(option => option\.value !== 'auto'\)/);
  assert.match(settings, /const defaultCatalogFormat: RuleStudioFormat = 'surge'/);
  assert.match(settings, /v-model\.trim="catalogDraft\.url"[\s\S]*?class="nut-input-text"/);
  assert.match(settings, /v-model\.trim="catalogDraft\.name"[\s\S]*?class="nut-input-text"/);
  assert.match(settings, /v-model\.trim="catalogDraft\.description"[\s\S]*?class="nut-input-text"/);
  assert.match(optionPicker, /<nut-popup/);
  assert.match(optionPicker, /role="radiogroup"/);
  assert.match(optionPicker, /:z-index="13200"/);
  assert.match(optionPicker, /rule-studio-option-picker-popup/);
});
