import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, requestRoute } from './helpers/runtime.mjs';

const remoteProject = {
  id: 'remote-project', name: 'Remote', description: '', lifecycle: { state: 'active' },
  sources: [{ id: 'remote', kind: 'url', url: 'https://example.com/rules?token=secret', enabled: true, format: 'surge' }],
  options: { deduplicate: true, preserveComments: true }, revision: 1, createdAt: 1, updatedAt: 1,
};

test('uses fresh cache and keeps URL secrets out of cache keys', async () => {
  let calls = 0;
  const runtime = createRuntime({ networkGet: async () => { calls += 1; return { statusCode: 200, headers: { etag: 'v1' }, body: 'DOMAIN,example.com' }; } });
  try {
    for (let index = 0; index < 2; index += 1) {
      const result = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/preview', { body: { project: remoteProject, representation: 'surge-rule-list' } });
      assert.equal(result.statusCode, 200);
    }
    assert.equal(calls, 1);
    assert.equal([...runtime.cacheValues.keys()].some(key => key.includes('secret')), false);
  } finally {
    runtime.close();
  }
});

test('falls back to last-known-good content after a forced refresh failure', async () => {
  let calls = 0;
  const runtime = createRuntime({ networkGet: async () => {
    calls += 1;
    if (calls === 1) return { statusCode: 200, headers: {}, body: 'DOMAIN,example.com' };
    throw Object.assign(new Error('offline'), { code: 'ECONNRESET' });
  } });
  try {
    const first = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/preview', { body: { project: remoteProject, representation: 'surge-rule-list' } });
    assert.equal(first.payload.data.freshness.state, 'fresh');
    const stale = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/preview', { body: { project: remoteProject, representation: 'surge-rule-list', forceRefresh: true } });
    assert.equal(stale.statusCode, 200);
    assert.equal(stale.payload.data.freshness.state, 'stale');
    assert.ok(stale.payload.data.diagnostics.some(item => item.code === 'RESOURCE_STALE'));
  } finally {
    runtime.close();
  }
});

test('cache-only fails closed without making a network request when cache is empty', async () => {
  let calls = 0;
  const runtime = createRuntime({
    initialStore: { schemaVersion: 1, projects: [remoteProject] },
    networkGet: async () => {
      calls += 1;
      return { statusCode: 200, headers: {}, body: 'DOMAIN,example.com' };
    },
  });
  try {
    const source = runtime.contribution().artifactSources[0];
    await assert.rejects(
      source.produce({
        id: remoteProject.id,
        representation: 'surge-rule-list',
        freshnessPolicy: 'cache-only',
      }),
      error => error.code === 'RESOURCE_CACHE_MISS' && error.statusCode === 409,
    );
    assert.equal(calls, 0);
  } finally {
    runtime.close();
  }
});

test('fresh rejects last-known-good stale output instead of silently claiming freshness', async () => {
  let calls = 0;
  const runtime = createRuntime({
    initialStore: { schemaVersion: 1, projects: [remoteProject] },
    networkGet: async () => {
      calls += 1;
      if (calls === 1) return { statusCode: 200, headers: {}, body: 'DOMAIN,example.com' };
      throw Object.assign(new Error('offline'), { code: 'ECONNRESET' });
    },
  });
  try {
    const source = runtime.contribution().artifactSources[0];
    await source.produce({
      id: remoteProject.id,
      representation: 'surge-rule-list',
      freshnessPolicy: 'allow-stale',
    });
    await assert.rejects(
      source.produce({
        id: remoteProject.id,
        representation: 'surge-rule-list',
        freshnessPolicy: 'fresh',
        forceRefresh: true,
      }),
      error => error.code === 'RESOURCE_STALE' && error.statusCode === 409,
    );
    assert.equal(calls, 2);
  } finally {
    runtime.close();
  }
});
