import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension } from '../../../scripts/lib.mjs';

const extension = await loadExtension('org.substore.rule-studio');
const frontendRoot = path.join(extension.workspaceDirectory, 'frontend/src/extensions/rule-studio');

test('uses the Host list pattern with one swipe action surface on desktop and mobile', async () => {
  const [list, item, routes, runtime] = await Promise.all([
    fs.readFile(path.join(frontendRoot, 'pages/ListPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'components/RuleStudioListItem.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'routes.ts'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'runtime-entry.ts'), 'utf8'),
  ]);

  assert.match(list, /RuleStudioListItem/);
  assert.match(list, /useListViewMode/);
  assert.equal(list.includes('list-toolbar'), false);
  assert.match(item, /<nut-swipe/);
  assert.match(item, /nut-swipe__left/);
  assert.match(item, /actions-toggle/);
  assert.match(item, /aria-expanded/);
  assert.match(item, /publish:\s*\[\]/);
  assert.match(item, /copy:\s*\[\]/);
  assert.match(item, /@click\.stop="\$emit\('copy'\)"/);
  assert.match(item, /fa-solid fa-clone/);
  assert.match(item, /handlePrimaryClick/);
  assert.match(item, /emit\('publish'\)/);
  assert.match(item, /project\.metadata\.iconUrl/);
  assert.match(item, /class="rule-item-avatar-image"/);
  assert.match(item, /fa-solid fa-list-check/);
  assert.match(item, /\.rule-item-avatar\s*\{[^}]*background:\s*transparent/s);
  assert.doesNotMatch(item, /\.archived \.rule-item-avatar\s*\{[^}]*background:/s);
  assert.equal(item.includes('desktop-actions'), false);
  assert.equal(item.includes('isDesktop'), false);
  assert.equal(item.includes('matchMedia'), false);
  assert.match(item, /\$emit\('edit'\)/);
  for (const event of ['refresh', 'preview', 'archive', 'restore']) {
    assert.match(item, new RegExp(`\\$emit\\('${event}'\\)`));
  }
  assert.match(routes, /supportsListViewMode:\s*true/);
  assert.match(routes, /settingsCommand:\s*RULE_STUDIO_COMMANDS\.catalogs/);
  assert.match(routes, /\/extensions\/rule-studio\/catalogs/);
  assert.match(runtime, /catalogs:\s*async \(\) => CatalogSettingsPage/);
});

test('opens a Host-style platform subscription panel from the rule-set list', async () => {
  const [list, targets] = await Promise.all([
    fs.readFile(path.join(frontendRoot, 'pages/ListPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'domain/targets.ts'), 'utf8'),
  ]);

  assert.match(list, /PreviewPanel/);
  assert.match(list, /useHostAPI/);
  assert.match(list, /@publish="openPublishDialog\(project\)"/);
  assert.match(list, /@copy="copyProjectLink\(project\)"/);
  assert.match(list, /navigator\.clipboard\.writeText/);
  assert.match(list, /\/download\/rule-set\/\$\{encodeURIComponent\(project\.ref\.id\)\}/);
  assert.equal(list.includes('autoDetectTarget'), false);
  assert.equal(list.includes('AUTO_DETECT_ICON'), false);
  assert.equal(list.includes("t('ruleStudio.autoDetect')"), false);
  assert.match(list, /RULE_STUDIO_TARGET_DEFINITIONS/);
  assert.match(list, /showSubscriptionOptions:\s*false/);

  for (const target of ['Surge', 'QX', 'Clash', 'Loon']) {
    assert.match(targets, new RegExp(`path:\\s*'${target}'`));
  }
  for (const icon of ['/surge.png', '/quanx.png', '/clash.png', '/loon.png']) {
    assert.match(targets, new RegExp(icon.replace('/', '\\/')));
  }
});

test('keeps rule library configuration outside the project editor', async () => {
  const [list, editor, settings, routes, constants] = await Promise.all([
    fs.readFile(path.join(frontendRoot, 'pages/ListPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'pages/EditorPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'pages/CatalogSettingsPage.vue'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'routes.ts'), 'utf8'),
    fs.readFile(path.join(frontendRoot, 'constants.ts'), 'utf8'),
  ]);

  assert.match(list, /RULE_STUDIO_COMMANDS\.catalogs/);
  assert.match(settings, /saveCatalogSettings/);
  assert.match(settings, /nut-switch/);
  assert.match(settings, /<nut-popup/);
  assert.match(settings, /createCustomCatalog/);
  assert.match(settings, /updateCustomCatalog/);
  assert.match(settings, /deleteCustomCatalog/);
  assert.match(settings, /RULE_STUDIO_COMMANDS\.addCatalog/);
  assert.equal(settings.includes('intro-card'), false);
  assert.match(settings, /class="catalog-page-heading"/);
  assert.equal(settings.includes('class="heading-add"'), false);
  assert.match(settings, /closeable/);
  assert.match(settings, /:lock-scroll="true"/);
  assert.match(settings, /:safe-area-inset-bottom="true"/);
  assert.match(settings, /@closed="resetDraft"/);
  assert.match(routes, /addCommand:\s*RULE_STUDIO_COMMANDS\.addCatalog/);
  assert.match(constants, /addCatalog/);
  assert.match(editor, /enabledSourceCatalogs/);
  assert.match(editor, /catalogEmpty/);
});
