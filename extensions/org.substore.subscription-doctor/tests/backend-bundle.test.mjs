import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { loadExtension } from '../../../scripts/lib.mjs';

const require = createRequire(import.meta.url);
const extensionId = 'org.substore.subscription-doctor';
const workspace = await loadExtension(extensionId);
const extension = require(path.join(workspace.buildDirectory, 'backend/index.cjs'));

const ref = Object.freeze({
  schema: 'substore.resource-ref@1',
  providerId: 'org.substore.core',
  providerContributionId: 'org.substore.core.subscriptions',
  type: 'subscription',
  id: 'Y2',
  contract: 'substore.subscription@1',
});

function createHost({ nodes, outputDiagnostics = [], produceError } = {}) {
  let storedValue;
  let adapter;
  let contribution;
  const calls = [];
  const descriptor = {
    schema: 'substore.resource-descriptor@1',
    ref,
    name: 'Y2',
    displayName: 'Y2 自用',
    revision: 1,
    lifecycle: { state: 'active' },
    availability: { status: 'available' },
    contracts: [ref.contract],
    representations: ['substore-nodes-json'],
  };
  const resources = {
    async list(options) {
      calls.push(['list', options]);
      return [descriptor];
    },
    async get(value) {
      calls.push(['get', value]);
      return descriptor;
    },
    async produce(value, options) {
      calls.push(['produce', value, options]);
      if (produceError) throw produceError;
      return {
        schema: 'substore.resource-output@1',
        ref: value,
        representation: 'substore-nodes-json',
        body: JSON.stringify(nodes || []),
        mediaType: 'application/json',
        sourceRevision: 1,
        freshness: { state: 'fresh' },
        diagnostics: outputDiagnostics,
      };
    },
  };
  const services = {
    apiVersion: '1.0.0',
    extensionId,
    storage: {
      read: () => storedValue,
      write: value => {
        storedValue = structuredClone(value);
        calls.push(['storage.write']);
      },
    },
    resources,
  };
  const host = {
    apiVersion: '1.0.0',
    extensionId,
    services,
    registerAdapter(value) { adapter = value; },
    unregisterAdapter() { adapter = null; },
    registerContribution(value) { contribution = value; },
    unregisterContribution() { contribution = null; },
    activate: () => adapter.activate(),
    deactivate: () => adapter.deactivate(),
  };
  return {
    host,
    calls,
    state: () => ({ storedValue, adapter, contribution }),
  };
}

function routesFor(contribution) {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'delete']) {
    app[method] = (route, handler) => routes.set(`${method.toUpperCase()} ${route}`, handler);
  }
  contribution.registerRoutes(app);
  return routes;
}

function response() {
  let statusCode = 200;
  let payload;
  let mediaType;
  return {
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; },
    type(value) { mediaType = value; return this; },
    send(value) { payload = value; return this; },
    result: () => ({ statusCode, payload, mediaType }),
  };
}

async function invoke(routes, key, request = {}) {
  const handler = routes.get(key);
  assert.equal(typeof handler, 'function', key);
  const output = response();
  await handler(request, output);
  return output.result();
}

test('exports, activates, initializes and unregisters the stable executable contract', () => {
  assert.deepEqual(Object.keys(extension).sort(), [
    'activate',
    'deactivate',
    'extensionId',
    'implementationAbi',
  ]);
  const fixture = createHost();
  assert.deepEqual(extension.activate(fixture.host), {
    active: true,
    implementationAbi: 'subscription-doctor@1',
  });
  assert.deepEqual(fixture.state().storedValue, { schemaVersion: 1, reports: [] });
  assert.equal(fixture.state().contribution.extensionId, extensionId);
  extension.deactivate(fixture.host);
  assert.equal(fixture.state().adapter, null);
  assert.equal(fixture.state().contribution, null);
});

test('lists only broker resources and diagnoses the produced final node snapshot', async () => {
  const fixture = createHost({ nodes: [{
    type: 'ss',
    name: 'HK',
    server: 'hk.example.com',
    port: 443,
    cipher: 'aes-128-gcm',
    password: 'SECRET_TOKEN_123',
  }] });
  extension.activate(fixture.host);
  try {
    const routes = routesFor(fixture.state().contribution);
    assert.deepEqual([...routes.keys()].sort(), [
      'DELETE /api/extensions/subscription-doctor/report/:id',
      'GET /api/extensions/subscription-doctor/report/:id',
      'GET /api/extensions/subscription-doctor/report/:id/export/:format',
      'GET /api/extensions/subscription-doctor/reports',
      'GET /api/extensions/subscription-doctor/resources',
      'POST /api/extensions/subscription-doctor/check',
    ]);
    const listResult = await invoke(
      routes,
      'GET /api/extensions/subscription-doctor/resources',
    );
    assert.equal(listResult.statusCode, 200);
    assert.equal(listResult.payload.data.resources[0].name, 'Y2 自用');
    const checkResult = await invoke(
      routes,
      'POST /api/extensions/subscription-doctor/check',
      { body: { sourceRef: ref } },
    );
    assert.equal(checkResult.statusCode, 201, JSON.stringify(checkResult.payload));
    assert.equal(checkResult.payload.data.counts.total, 1);
    assert.equal(checkResult.payload.data.status, 'healthy');
    assert.deepEqual(checkResult.payload.data.networkChecks, {
      state: 'unsupported',
      runner: 'none',
      tested: 0,
      skipped: 1,
      reachable: 0,
      failed: 0,
      reasonCode: 'NODE_PROXY_RUNNER_UNAVAILABLE',
      features: {
        connectivity: 'unsupported',
        streaming: 'unsupported',
        egress: 'unsupported',
      },
    });
    assert.equal(checkResult.payload.data.profile.uniqueServers, 1);
    assert.equal(checkResult.payload.data.quality.tlsVerificationDisabled, 0);
    assert.equal(
      fixture.calls.some(call => call[0] === 'produce'
        && call[2].representation === 'substore-nodes-json'
        && call[2].freshnessPolicy === 'fresh'),
      true,
    );
    assert.doesNotMatch(JSON.stringify(fixture.state().storedValue), /SECRET_TOKEN_123/);
    assert.equal(fixture.state().storedValue.reports[0].networkChecks.state, 'unsupported');
  } finally {
    extension.deactivate(fixture.host);
  }
});

test('creates a same-source diff, retains twenty reports and deletes only own reports', async () => {
  const nodes = [{
    type: 'ss', name: 'HK', server: 'hk.example.com', port: 443,
    cipher: 'aes-128-gcm', password: 'secret',
  }];
  const fixture = createHost({ nodes });
  extension.activate(fixture.host);
  try {
    const routes = routesFor(fixture.state().contribution);
    let latest;
    for (let index = 0; index < 21; index += 1) {
      nodes.push({
        type: 'ss', name: `HK-${index}`, server: `hk-${index}.example.com`, port: 443,
        cipher: 'aes-128-gcm', password: `secret-${index}`,
      });
      latest = await invoke(
        routes,
        'POST /api/extensions/subscription-doctor/check',
        { body: { sourceRef: ref } },
      );
    }
    assert.equal(fixture.state().storedValue.reports.length, 20);
    assert.ok(latest.payload.data.diff);
    assert.equal(latest.payload.data.diff.counts.total, 1);
    const reportId = latest.payload.data.id;
    const deleted = await invoke(
      routes,
      'DELETE /api/extensions/subscription-doctor/report/:id',
      { params: { id: encodeURIComponent(reportId) } },
    );
    assert.equal(deleted.statusCode, 200);
    assert.equal(fixture.state().storedValue.reports.length, 19);
    assert.equal(
      fixture.calls.some(call => call[0] === 'storage.write'),
      true,
    );
    assert.equal(fixture.calls.some(call => `${call[0]}`.includes('subscription.write')), false);
  } finally {
    extension.deactivate(fixture.host);
  }
});

test('redacts persisted and exported reports and never returns stack or provider payloads', async () => {
  const sentinels = [
    'SECRET_TOKEN_123',
    'PASSWORD_456',
    'UUID_789',
    'PRIVATE_KEY_ABC',
    'QUERY_SECRET',
    'safe.example.com',
    '203.0.113.8',
  ];
  const fixture = createHost({
    nodes: [{
      type: 'vmess',
      name: 'SECRET_TOKEN_123',
      server: 'safe.example.com',
      port: 443,
      uuid: 'UUID_789',
      password: 'PASSWORD_456',
      'private-key': 'PRIVATE_KEY_ABC',
      url: 'https://example.com/sub?token=QUERY_SECRET',
    }],
    outputDiagnostics: [{
      severity: 'warning',
      code: 'UPSTREAM_NOTICE',
      message: 'https://example.com/sub?token=QUERY_SECRET SECRET_TOKEN_123 safe.example.com 203.0.113.8',
      path: 'nodes[0].server',
    }],
  });
  extension.activate(fixture.host);
  try {
    const routes = routesFor(fixture.state().contribution);
    const checked = await invoke(
      routes,
      'POST /api/extensions/subscription-doctor/check',
      { body: { sourceRef: ref } },
    );
    const id = checked.payload.data.id;
    const jsonExport = await invoke(
      routes,
      'GET /api/extensions/subscription-doctor/report/:id/export/:format',
      { params: { id, format: 'json' } },
    );
    const markdownExport = await invoke(
      routes,
      'GET /api/extensions/subscription-doctor/report/:id/export/:format',
      { params: { id, format: 'markdown' } },
    );
    for (const serialized of [
      JSON.stringify(fixture.state().storedValue),
      JSON.stringify(checked.payload),
      jsonExport.payload,
      markdownExport.payload,
    ]) {
      for (const sentinel of sentinels) assert.equal(serialized.includes(sentinel), false);
    }
  } finally {
    extension.deactivate(fixture.host);
  }

  const failure = new Error('provider failed with SECRET_TOKEN_123');
  failure.code = 'RESOURCE_UPSTREAM_TIMEOUT';
  failure.stack = 'STACK SECRET_TOKEN_123';
  failure.details = { body: 'PASSWORD_456', field: 'upstream' };
  const failedFixture = createHost({ produceError: failure });
  extension.activate(failedFixture.host);
  try {
    const failedResult = await invoke(
      routesFor(failedFixture.state().contribution),
      'POST /api/extensions/subscription-doctor/check',
      { body: { sourceRef: ref } },
    );
    const serialized = JSON.stringify(failedResult.payload);
    assert.equal(failedResult.statusCode, 504);
    assert.doesNotMatch(serialized, /STACK|PASSWORD_456/);
  } finally {
    extension.deactivate(failedFixture.host);
  }
});
