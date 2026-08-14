import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension } from '../../../scripts/lib.mjs';

const extension = await loadExtension('org.substore.subscription-doctor');

test('uses a compact Host-style report and exposes compatibility, quality and network capability', async () => {
  const resultPage = await fs.readFile(
    path.join(
      extension.workspaceDirectory,
      'frontend/src/extensions/subscription-doctor/pages/ResultPage.vue',
    ),
    'utf8',
  );

  assert.match(resultPage, /report\.status/);
  assert.match(resultPage, /compatibility-list/);
  assert.match(resultPage, /quality-list/);
  assert.match(resultPage, /network-check-row/);
  assert.match(resultPage, /subscriptionDoctor\.streamingCheck/);
  assert.match(resultPage, /subscriptionDoctor\.egressCheck/);
  assert.doesNotMatch(resultPage, /actionGroups|actionableStatus|advancedOpen/);
  assert.doesNotMatch(resultPage, /summary-card|metric-grid|status-symbol|eyebrow/);
  assert.doesNotMatch(resultPage, /linear-gradient|subscriptionDoctor\.impact|subscriptionDoctor\.suggestion/);
});
