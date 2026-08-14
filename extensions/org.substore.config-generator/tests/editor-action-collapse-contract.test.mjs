import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension } from '../../../scripts/lib.mjs';

const extension = await loadExtension('org.substore.config-generator');
const formPath = path.join(
  extension.workspaceDirectory,
  'frontend/src/extensions/config-generator/components/editor/RuleSetActionForm.vue',
);

test('keeps the RULE-SET action form single-rooted for ActionBlock collapse directives', async () => {
  const source = await fs.readFile(formPath, 'utf8');
  const template = source.match(/<template>([\s\S]*?)<\/template>\s*<script/)?.[1] || '';

  assert.match(
    template,
    /^\s*<div\s+v-if="ruleSet"\s+class="config-generator-action-form-wrapper">/,
  );
  assert.match(
    template,
    /<div[\s\S]*?<nut-form[\s\S]*?<\/nut-form>[\s\S]*?<nut-picker[\s\S]*?\/>[\s\S]*?<\/div>\s*$/,
  );
});
