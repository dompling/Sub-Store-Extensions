import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const source = relative => path.resolve(
  testDirectory,
  '../frontend/src/extensions/config-generator',
  relative,
);

test('renders a single aggregated four-client health report with actionable findings', async () => {
  const page = await readFile(source('pages/HealthPage.vue'), 'utf8');

  assert.match(page, /:aria-busy="loading"/);
  assert.match(page, /role="alert"/);
  assert.match(page, /CONFIG_GENERATOR_TARGET_DEFINITIONS/);
  assert.match(page, /configStore\.getProjectHealth\(projectName\)/);
  assert.doesNotMatch(page, /configStore\.preview\(/);
  assert.match(page, /report\.coverage\.notChecked/);
  assert.match(page, /item\.path/);
  assert.match(page, /issueSuggestion\(item\)/);
  assert.match(page, /configGenerator\.health\.suggestion/);
  assert.match(page, /configGenerator\.health\.allClearTitle/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /:aria-selected=/);
  assert.match(page, /encodeURIComponent\(projectName\)/);
});

test('uses the dedicated read-only health API instead of four preview requests', async () => {
  const api = await readFile(source('api.ts'), 'utf8');
  const store = await readFile(source('store.ts'), 'utf8');
  const page = await readFile(source('pages/HealthPage.vue'), 'utf8');

  assert.match(api, /getProjectHealth:/);
  assert.match(api, /project\/\$\{encodeURIComponent\(name\)\}\/health/);
  assert.match(api, /method:\s*'get'/);
  assert.match(store, /async getProjectHealth\(name: string\)/);
  assert.match(store, /CONFIG_GENERATOR_HEALTH_FAILED/);
  assert.match(store, /healthErrorCode/);
  assert.match(page, /configStore\.healthErrorCode === 'CONFIG_GENERATOR_PROJECT_NOT_FOUND'/);
});

test('supports section-level editor links from health findings', async () => {
  const editor = await readFile(source('pages/EditorPage.vue'), 'utf8');

  assert.match(editor, /route\.query\.section/);
  assert.match(editor, /rawSection === 'rules' \? 'ruleSets' : rawSection/);
  assert.match(editor, /activeEditorTab\.value = String\(section\)/);
  assert.match(editor, /route\.query\.target/);
  assert.match(editor, /isConfigGeneratorTarget\(rawTarget\)/);
  assert.match(editor, /applyEditorRouteLocation\(\)/);
});
