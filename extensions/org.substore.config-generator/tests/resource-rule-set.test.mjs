import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { build } from 'esbuild';
import { loadExtension } from '../../../scripts/lib.mjs';
import { parseYaml, preview, requestRoute, withRuntime } from './helpers/backend-runtime.mjs';

const extension = await loadExtension('org.substore.config-generator');
const coreBundle = path.join(extension.buildDirectory, 'tests/core-regression.cjs');

await build({
  absWorkingDir: extension.backend.sourceRoot,
  entryPoints: [path.join(extension.workspaceDirectory, 'tests/fixtures/core-regression-entry.js')],
  outfile: coreBundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  plugins: [{
    name: 'config-generator-test-alias',
    setup(context) {
      context.onResolve({ filter: /^@\// }, args => {
        const base = path.join(extension.backend.sourceRoot, args.path.slice(2));
        const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]
          .find(candidate => existsSync(candidate));
        return resolved ? { path: resolved } : null;
      });
    },
  }],
});

const core = await import(`file://${coreBundle}?resource-rule-set=${Date.now()}`);
const ref = {
  schema: 'substore.resource-ref@1',
  providerId: 'org.example.rules',
  providerContributionId: 'org.example.rules.rule-sets',
  type: 'rule-set',
  id: 'stable-rule-id',
  contract: 'substore.rule-set@1',
};
const descriptor = {
  schema: 'substore.resource-descriptor@1',
  ref,
  name: 'stable-rule-id',
  displayName: 'Shared Rules',
  contracts: ['substore.rule-set@1'],
  representations: [
    'surge-rule-list',
    'qx-filter',
    'loon-rule-list',
    'clash-classical-yaml',
    'clash-classical-text',
    'clash-domain-yaml',
    'clash-ipcidr-yaml',
  ],
  lifecycle: { state: 'active' },
  availability: { status: 'available' },
};
const outputFor = (representation, body) => ({
  schema: 'substore.resource-output@1',
  ref,
  representation,
  body,
  mediaType: representation.includes('yaml') ? 'application/yaml' : 'text/plain',
  sourceRevision: 7,
  freshness: { state: 'fresh' },
  diagnostics: [],
});
const resourceRuleSet = {
  name: 'resource-rules',
  source: {
    kind: 'resource',
    ref,
    expectedContract: 'substore.rule-set@1',
    lastKnownName: 'Shared Rules',
  },
  targetOptions: { clash: { behavior: 'classical', format: 'yaml' } },
};
const project = {
  name: 'resource-project',
  delivery: { publicBaseUrl: 'https://sub.example.com' },
  remoteProxySources: [],
  groups: [{
    name: 'Proxy',
    type: 'select',
    members: [{ kind: 'builtin', value: 'DIRECT' }],
  }],
  rules: [
    { kind: 'remote', name: 'Shared', ruleSet: resourceRuleSet.name, policy: 'Proxy' },
    { kind: 'final', policy: 'Proxy' },
  ],
  outputs: { surge: {}, qx: {}, clash: {}, loon: {} },
};

test('keeps ResourceRef identity complete and maps concrete representations', () => {
  assert.deepEqual(core.normalizeResourceRef(ref, 'substore.rule-set@1'), ref);
  assert.equal(core.ruleSetRepresentation(resourceRuleSet, 'surge'), 'surge-rule-list');
  assert.equal(core.ruleSetRepresentation(resourceRuleSet, 'qx'), 'qx-filter');
  assert.equal(core.ruleSetRepresentation(resourceRuleSet, 'loon'), 'loon-rule-list');
  assert.equal(core.ruleSetRepresentation(resourceRuleSet, 'clash'), 'clash-classical-yaml');
  assert.deepEqual(core.projectResourceTargets(project, [resourceRuleSet]), [ref]);
});

test('normalizes an API base URL to the public download root', () => {
  const apiProject = {
    ...project,
    delivery: { publicBaseUrl: 'https://sub.example.com/api/' },
  };
  assert.equal(
    core.resourceRuleSetDownloadUrl(apiProject, resourceRuleSet, 'surge'),
    'https://sub.example.com/download/config-project/resource-project/rule-set/resource-rules/Surge',
  );
});

test('generates all four targets through a resource-backed rule set', async () => {
  const outputs = new Map([
    [`${ref.providerContributionId}\0${ref.id}\0surge-rule-list`, outputFor('surge-rule-list', 'DOMAIN-SUFFIX,example.com')],
    [`${ref.providerContributionId}\0${ref.id}\0qx-filter`, outputFor('qx-filter', 'host-suffix, example.com')],
    [`${ref.providerContributionId}\0${ref.id}\0loon-rule-list`, outputFor('loon-rule-list', 'DOMAIN-SUFFIX,example.com')],
    [`${ref.providerContributionId}\0${ref.id}\0clash-classical-yaml`, outputFor('clash-classical-yaml', 'payload:\n  - DOMAIN-SUFFIX,example.com\n')],
  ]);
  const options = { resourceDescriptors: [descriptor], resourceOutputs: outputs };
  const surge = await preview('surge', project, [resourceRuleSet], options);
  const qx = await preview('qx', project, [resourceRuleSet], options);
  const loon = await preview('loon', project, [resourceRuleSet], options);
  const clashResult = await preview('clash', project, [resourceRuleSet], options);

  const encodedUrl = 'https://sub.example.com/download/config-project/resource-project/rule-set/resource-rules';
  assert.match(surge.body, new RegExp(`${encodedUrl}/Surge`));
  assert.match(qx.body, new RegExp(`${encodedUrl}/Quantumult%20X`));
  assert.match(loon.body, new RegExp(`${encodedUrl}/Loon`));
  const clash = parseYaml(clashResult.body);
  assert.equal(clash['rule-providers'].Shared.url, `${encodedUrl}/Clash`);
  assert.ok(clash.rules.includes('RULE-SET,Shared,Proxy'));
  assert.equal(clashResult.resourceOutputs[0].sourceRevision, 7);
});

test('downloads a resource representation through the shared four-target route', async () => {
  const outputs = new Map([
    [`${ref.providerContributionId}\0${ref.id}\0qx-filter`, outputFor('qx-filter', 'host-suffix, example.com')],
  ]);
  await withRuntime({
    initialStore: { version: 2, projects: [project], ruleSets: [resourceRuleSet] },
    resourceDescriptors: [descriptor],
    resourceOutputs: outputs,
  }, async ({ routes }) => {
    const response = await requestRoute(
      routes,
      'GET',
      '/download/config-project/:name/rule-set/:ruleSet/:target',
      { params: { name: project.name, ruleSet: resourceRuleSet.name, target: 'QX' } },
    );
    assert.equal(response.statusCode, 200);
    assert.equal(response.payload, 'host-suffix, example.com');
  });
});

test('fails closed when a resource provider is unavailable', async () => {
  const result = await preview('surge', project, [resourceRuleSet], {
    resourceDescriptors: [],
    resourceOutputs: new Map(),
    allowError: true,
  });
  assert.equal(result.statusCode, 400);
  assert.equal(result.payload.error.code, 'RESOURCE_NOT_FOUND');
});
