import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

let renamePolicyGroupReferences;

before(async () => {
  const moduleUrl = new URL(
    '../frontend/src/extensions/config-generator/domain/policyGroupRename.ts',
    import.meta.url,
  );
  const source = await readFile(moduleUrl, 'utf8');
  const transformed = await transformWithEsbuild(source, fileURLToPath(moduleUrl), {
    format: 'esm',
    loader: 'ts',
    target: 'es2020',
  });
  const executableUrl = `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`;
  ({ renamePolicyGroupReferences } = await import(executableUrl));
});

test('renames every structured reference to a policy group', () => {
  const project = {
    name: 'rename-groups',
    remoteProxySources: [{
      name: 'Old Group',
      source: { kind: 'url', url: 'https://example.com/subscription' },
    }],
    groups: [
      {
        name: 'New Group',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      },
      {
        name: 'Consumer',
        type: 'ssid',
        members: [
          { kind: 'group', value: 'Old Group' },
          { kind: 'conditional', value: 'office:wifi:Old Group', policy: 'Old Group' },
          { kind: 'proxy', value: 'Old Group' },
        ],
        includeOtherGroups: ['Old Group', 'New Group'],
        targetOptions: {
          surge: {
            subnetDefault: 'Old Group',
            subnetRules: [
              { expression: 'SSID:Home', policy: 'Old Group' },
              { expression: 'SSID:Office', policy: 'DIRECT' },
            ],
          },
        },
      },
    ],
    rules: [
      { kind: 'inline', type: 'DOMAIN', value: 'example.com', policy: 'Old Group' },
      { kind: 'remote', ruleSet: 'remote-rules', policy: 'Old Group' },
      { kind: 'final', policy: 'Old Group' },
      { kind: 'comment', text: 'Old Group remains ordinary text' },
    ],
    outputs: {
      surge: { independentConfig: 'DOMAIN,example.com,Old Group' },
    },
  };

  const result = renamePolicyGroupReferences(project, 'Old Group', 'New Group');

  assert.deepEqual(result, {
    rulePolicies: 3,
    memberPolicies: 2,
    includedGroups: 1,
    subnetPolicies: 2,
    total: 8,
  });
  assert.deepEqual(project.groups[1].members, [
    { kind: 'group', value: 'New Group' },
    { kind: 'conditional', value: 'office:wifi:New Group', policy: 'New Group' },
    { kind: 'proxy', value: 'Old Group' },
  ]);
  assert.deepEqual(project.groups[1].includeOtherGroups, ['New Group']);
  assert.equal(project.groups[1].targetOptions.surge.subnetDefault, 'New Group');
  assert.deepEqual(
    project.groups[1].targetOptions.surge.subnetRules.map(rule => rule.policy),
    ['New Group', 'DIRECT'],
  );
  assert.deepEqual(
    project.rules.filter(rule => 'policy' in rule).map(rule => rule.policy),
    ['New Group', 'New Group', 'New Group'],
  );
  assert.equal(project.remoteProxySources[0].name, 'Old Group');
  assert.equal(project.outputs.surge.independentConfig, 'DOMAIN,example.com,Old Group');
});

test('does not rewrite references for an empty or unchanged group name', () => {
  const project = {
    groups: [],
    rules: [{ kind: 'final', policy: 'Old Group' }],
  };

  assert.equal(renamePolicyGroupReferences(project, '', 'New Group').total, 0);
  assert.equal(renamePolicyGroupReferences(project, 'Old Group', '').total, 0);
  assert.equal(renamePolicyGroupReferences(project, 'Old Group', 'Old Group').total, 0);
  assert.equal(project.rules[0].policy, 'Old Group');
});

test('commits group renames from both the form field and action title', async () => {
  const editorPage = await readFile(new URL(
    '../frontend/src/extensions/config-generator/pages/EditorPage.vue',
    import.meta.url,
  ), 'utf8');
  const groupForm = await readFile(new URL(
    '../frontend/src/extensions/config-generator/components/editor/PolicyGroupActionForm.vue',
    import.meta.url,
  ), 'utf8');

  assert.match(groupForm, /@blur="context\.commitGroupName\(group\)"/);
  assert.match(groupForm, /@keyup\.enter="context\.commitGroupName\(group\)"/);
  assert.match(editorPage, /renamePolicyGroupReferences\(form, previousName, nextName\)/);
  assert.match(editorPage, /commitGroupName\(group, action\.customName\)/);
});
