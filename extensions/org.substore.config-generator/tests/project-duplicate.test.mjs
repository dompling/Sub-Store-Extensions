import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

let createConfigProjectDuplicate;

before(async () => {
  const moduleUrl = new URL(
    '../frontend/src/extensions/config-generator/domain/projectDuplicate.ts',
    import.meta.url,
  );
  const source = await readFile(moduleUrl, 'utf8');
  const transformed = await transformWithEsbuild(source, fileURLToPath(moduleUrl), {
    format: 'esm',
    loader: 'ts',
    target: 'es2020',
  });
  const executableUrl = `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`;
  ({ createConfigProjectDuplicate } = await import(executableUrl));
});

test('deep-copies a project with unique internal and visible names', () => {
  const project = {
    name: 'office',
    displayName: '办公配置',
    revision: 9,
    updated: 123456,
    remoteProxySources: [],
    groups: [{
      name: 'Main',
      type: 'select',
      members: [{ kind: 'builtin', value: 'DIRECT' }],
    }],
    rules: [{ kind: 'final', policy: 'Main' }],
    outputs: { surge: { independentConfig: '[General]' } },
  };
  const existingProjects = [
    project,
    { ...project, name: 'office-copy', displayName: '办公配置 副本' },
    { ...project, name: 'office-copy-2', displayName: '办公配置 副本 2' },
  ];

  const duplicate = createConfigProjectDuplicate(project, existingProjects, '副本');

  assert.equal(duplicate.name, 'office-copy-3');
  assert.equal(duplicate.displayName, '办公配置 副本 3');
  assert.equal(Object.hasOwn(duplicate, 'revision'), false);
  assert.equal(Object.hasOwn(duplicate, 'updated'), false);
  assert.deepEqual(duplicate.groups, project.groups);
  assert.notEqual(duplicate.groups, project.groups);
  assert.notEqual(duplicate.groups[0], project.groups[0]);

  duplicate.groups[0].name = 'Copied Main';
  assert.equal(project.groups[0].name, 'Main');
});

test('uses the internal name as the display-name base when no title exists', () => {
  const project = {
    name: 'plain-project',
    remoteProxySources: [],
    groups: [],
    rules: [],
    outputs: {},
  };

  const duplicate = createConfigProjectDuplicate(project, [project], 'Copy');

  assert.equal(duplicate.name, 'plain-project-copy');
  assert.equal(duplicate.displayName, 'plain-project Copy');
});

test('sanitizes legacy names before proposing the first copy', () => {
  const project = {
    name: '办公 配置',
    displayName: '办公配置',
    remoteProxySources: [],
    groups: [],
    rules: [],
    outputs: {},
  };

  const duplicate = createConfigProjectDuplicate(project, [project], '副本');

  assert.equal(duplicate.name, 'config-copy');
  assert.equal(duplicate.displayName, '办公配置 副本');
});
