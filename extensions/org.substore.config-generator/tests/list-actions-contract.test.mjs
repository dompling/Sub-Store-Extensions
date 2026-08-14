import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const componentPath = path.resolve(
  testDirectory,
  '../frontend/src/extensions/config-generator/components/ConfigGeneratorListItem.vue',
);

test('exposes the existing swipe actions through an expand button', async () => {
  const source = await readFile(componentPath, 'utf8');

  assert.match(source, /<nut-swipe[\s\S]*?ref="swipe"/);
  assert.match(source, /@open="setActionsOpen"/);
  assert.match(source, /@close="setActionsClosed"/);
  assert.match(source, /@click\.stop="toggleActions"/);
  assert.match(source, /:aria-expanded="actionsOpen"/);
  assert.match(source, /fa-angles-right/);
  assert.match(source, /'is-open': actionsOpen/);
  assert.match(source, /swipe\.value\?\.close\(\)/);
  assert.match(source, /appearanceSetting\.value\.isLeftRight\s*\?\s*'right'\s*:\s*'left'/);
  assert.match(source, /swipe\.value\?\.open\(position\)/);
  assert.match(source, /@click\.stop="\$emit\('copy'\)"/);
  assert.match(source, /fa-solid fa-clone/);
  assert.match(source, /handlePrimaryClick/);
  assert.match(source, /if \(actionsOpen\.value\)[\s\S]*?swipe\.value\?\.close\(\)[\s\S]*?return/);
  assert.match(source, /emit\('publish'\)/);
});

test('keeps the config-project list action contract unchanged', async () => {
  const source = await readFile(componentPath, 'utf8');

  assert.match(source, /publish:\s*\[\]/);
  assert.match(source, /copy:\s*\[\]/);
  assert.match(source, /edit:\s*\[\]/);
  assert.match(source, /remove:\s*\[\]/);
  assert.doesNotMatch(source, /preview:\s*\[\]/);
});
