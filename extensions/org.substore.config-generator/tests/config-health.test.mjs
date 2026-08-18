import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestRoute, withRuntime } from './helpers/backend-runtime.mjs';

const emptyOutputs = () => ({
  surge: {},
  qx: {},
  clash: {},
  loon: {},
});

const baseProject = (overrides = {}) => ({
  name: 'health-project',
  remoteProxySources: [],
  groups: [],
  rules: [],
  outputs: emptyOutputs(),
  ...overrides,
});

const health = async (project, ruleSets = [], options = {}) => withRuntime({
  initialStore: {
    version: 2,
    projects: [project],
    ruleSets,
  },
  ...options,
}, async ({ routes, fixture }) => ({
  result: await requestRoute(
    routes,
    'GET',
    '/api/extensions/config-generator/project/:name/health',
    { params: { name: project.name } },
  ),
  fixture,
}));

test('reports a portable project as healthy across all four targets', async () => {
  const project = baseProject({
    groups: [{ name: 'Main', type: 'select', members: [{ kind: 'builtin', value: 'DIRECT' }] }],
    rules: [{ kind: 'final', policy: 'Main' }],
  });
  const { result } = await health(project);

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload.status, 'success');
  const report = result.payload.data;
  assert.equal(report.status, 'healthy');
  assert.deepEqual(report.counts, { error: 0, warning: 0, info: 0 });
  assert.deepEqual(Object.keys(report.targets), ['surge', 'qx', 'clash', 'loon']);
  assert.deepEqual(report.coverage.notChecked, [
    'embedded-source-output',
    'remote-url-reachability',
    'remote-rule-content',
    'resource-output-content',
    'response-transformers',
    'node-connectivity',
  ]);
});

test('turns missing policy references into actionable errors without mutating the store', async () => {
  const project = baseProject({
    groups: [{ name: 'Main', type: 'select', members: [] }],
    rules: [{ kind: 'final', policy: 'Missing' }],
  });
  const { result, fixture } = await health(project);

  assert.equal(result.statusCode, 200);
  const report = result.payload.data;
  assert.equal(report.status, 'error');
  const issue = report.diagnostics.find(item => item.code === 'POLICY_REFERENCE_INVALID');
  assert.ok(issue);
  assert.equal(issue.path, 'rules[0].policy');
  assert.equal(issue.fix.section, 'ruleSets');
  assert.match(issue.suggestion, /DIRECT|REJECT|policy group/i);
  assert.deepEqual(fixture.storedValue().projects, [project]);
});

test('shows target-specific group fallbacks and empty-group behavior', async () => {
  const project = baseProject({
    groups: [{ name: 'Smart', type: 'smart', members: [] }],
    rules: [{ kind: 'final', policy: 'Smart' }],
  });
  const { result } = await health(project);
  const report = result.payload.data;

  assert.equal(report.status, 'error');
  assert.ok(report.diagnostics.some(item => item.code === 'POLICY_GROUP_FALLBACK' && item.target === 'qx'));
  assert.ok(report.diagnostics.some(item => item.code === 'POLICY_GROUP_EMPTY' && item.target === 'surge'));
  assert.ok(report.diagnostics.some(item => item.code === 'POLICY_GROUP_EMPTY' && item.target === 'clash' && item.severity === 'warning'));
  assert.equal(report.targets.clash.status, 'warning');
  assert.equal(report.targets.loon.status, 'warning');
});

test('checks target-owned rule sets and does not fetch remote content', async () => {
  let networkCalls = 0;
  const project = baseProject({
    groups: [{ name: 'Main', type: 'select', members: [{ kind: 'builtin', value: 'DIRECT' }] }],
    rules: [
      { kind: 'remote', ruleSet: 'qx-only', policy: 'Main' },
      { kind: 'final', policy: 'Main' },
    ],
  });
  const ruleSets = [{
    name: 'qx-only',
    source: { kind: 'url', url: 'https://example.com/rules.list', target: 'qx' },
  }];
  const { result } = await health(project, ruleSets, {
    networkGet: async () => {
      networkCalls += 1;
      return { statusCode: 200, body: '' };
    },
  });
  const report = result.payload.data;

  assert.equal(result.statusCode, 200);
  assert.equal(networkCalls, 0);
  assert.ok(report.diagnostics.some(item => item.code === 'RULE_SET_INVALID' && item.target === 'surge'));
  assert.ok(report.diagnostics.some(item => item.code === 'RULE_SET_INVALID' && item.target === 'loon'));
  assert.equal(report.targets.qx.status, 'healthy');
});

test('probes resource descriptors without producing resource content', async () => {
  const project = baseProject({
    delivery: { publicBaseUrl: 'https://sub.example.com' },
    groups: [{ name: 'Main', type: 'select', members: [{ kind: 'builtin', value: 'DIRECT' }] }],
    rules: [{ kind: 'remote', ruleSet: 'catalog', policy: 'Main' }, { kind: 'final', policy: 'Main' }],
  });
  const ref = {
    schema: 'substore.resource-ref@1',
    providerId: 'rules',
    providerContributionId: 'catalog',
    type: 'rule-set',
    id: 'catalog',
    contract: 'substore.rule-set@1',
  };
  const ruleSets = [{
    name: 'catalog',
    source: { kind: 'resource', ref, expectedContract: 'substore.rule-set@1' },
  }];
  const descriptor = {
    schema: 'substore.resource-descriptor@1',
    ref,
    name: 'Catalog',
    representations: ['surge-rule-list'],
    contracts: ['substore.rule-set@1'],
    lifecycle: { state: 'active' },
    availability: { status: 'available' },
  };
  const { result } = await health(project, ruleSets, {
    resourceDescriptors: [descriptor],
  });
  const report = result.payload.data;

  assert.equal(result.statusCode, 200);
  assert.ok(report.diagnostics.some(item => item.code === 'RULE_SET_INVALID' && item.target === 'qx'));
  assert.ok(report.diagnostics.some(item => item.code === 'RULE_SET_INVALID' && item.target === 'clash'));
  assert.equal(report.diagnostics.some(item => item.message.includes('produced no content')), false);
});

test('only probes resource descriptors referenced by active remote rules', async () => {
  const project = baseProject({
    delivery: { publicBaseUrl: 'https://sub.example.com' },
    groups: [{ name: 'Main', type: 'select', members: [{ kind: 'builtin', value: 'DIRECT' }] }],
    rules: [{ kind: 'remote', ruleSet: 'used', policy: 'Main' }, { kind: 'final', policy: 'Main' }],
  });
  const resourceRef = id => ({
    schema: 'substore.resource-ref@1',
    providerId: 'rules',
    providerContributionId: id,
    type: 'rule-set',
    id,
    contract: 'substore.rule-set@1',
  });
  const ruleSets = ['used', 'unused'].map(name => ({
    name,
    source: {
      kind: 'resource',
      ref: resourceRef(name),
      expectedContract: 'substore.rule-set@1',
    },
  }));
  const resourceDescriptors = ruleSets.map(ruleSet => ({
    schema: 'substore.resource-descriptor@1',
    ref: ruleSet.source.ref,
    name: ruleSet.name,
    representations: [],
    contracts: ['substore.rule-set@1'],
    lifecycle: { state: 'active' },
    availability: { status: 'available' },
  }));

  const { fixture } = await health(project, ruleSets, { resourceDescriptors });

  assert.equal(fixture.resourceGetCalls(), 1);
});

test('returns the existing not-found contract for an unknown project', async () => {
  await withRuntime({
    initialStore: { version: 2, projects: [], ruleSets: [] },
  }, async ({ routes }) => {
    const result = await requestRoute(
      routes,
      'GET',
      '/api/extensions/config-generator/project/:name/health',
      { params: { name: 'missing' } },
    );
    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.status, 'failed');
    assert.equal(result.payload.error.code, 'CONFIG_GENERATOR_PROJECT_NOT_FOUND');
  });
});
