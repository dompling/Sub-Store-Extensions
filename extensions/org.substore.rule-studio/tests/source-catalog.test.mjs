import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, requestRoute } from './helpers/runtime.mjs';

const apiRoot = 'https://api.github.com/repos/blackmatrix7/ios_rule_script/git/trees/';

const treeResponse = (tree, { truncated = false } = {}) => ({
  statusCode: 200,
  headers: {},
  body: JSON.stringify({ tree, truncated }),
});

const successSequence = ({ suffix = '' } = {}) => [
  treeResponse([
    { path: 'README.md', type: 'blob', sha: 'readme-sha' },
    { path: 'rule', type: 'tree', sha: `rule-sha${suffix}` },
  ]),
  treeResponse([
    { path: 'Clash', type: 'tree', sha: 'clash-sha' },
    { path: 'Surge', type: 'tree', sha: `surge-sha${suffix}` },
  ]),
  treeResponse([
    { path: 'Advertising', type: 'tree', sha: 'category-sha' },
    {
      path: `Advertising/Advertising${suffix}.list`,
      type: 'blob',
      sha: `advertising-sha${suffix}`,
      size: 1234,
    },
    {
      path: 'Streaming/You Tube.list',
      type: 'blob',
      sha: 'youtube-sha',
      size: 5678,
    },
    { path: 'Streaming/README.md', type: 'blob', sha: 'docs-sha', size: 99 },
    { path: 'Nested/ignored.list', type: 'tree', sha: 'not-a-blob' },
    { path: '../outside.list', type: 'blob', sha: 'unsafe-sha', size: 1 },
  ]),
];

function sequencedNetwork(sequence, calls) {
  return async options => {
    calls.push(options);
    const response = sequence.shift();
    assert.ok(response, `unexpected catalog request: ${options.url}`);
    if (response instanceof Error) throw response;
    return response;
  };
}

test('lists built-in catalogs without fetching GitHub', async () => {
  let calls = 0;
  const runtime = createRuntime({ networkGet: async () => { calls += 1; } });
  try {
    const result = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs',
    );
    assert.equal(result.statusCode, 200);
    assert.equal(calls, 0);
    assert.deepEqual(
      result.payload.data.map(item => item.id),
      ['blackmatrix7-surge'],
    );
    assert.equal(result.payload.data[0].format, 'surge');
    assert.equal(result.payload.data[0].rootPath, 'rule/Surge');
  } finally {
    runtime.close();
  }
});

test('walks to the configured subtree before recursively indexing list files', async () => {
  const calls = [];
  const sequence = successSequence();
  const runtime = createRuntime({ networkGet: sequencedNetwork(sequence, calls) });
  try {
    const result = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    assert.equal(result.statusCode, 200);
    assert.equal(result.payload.data.catalog.id, 'blackmatrix7-surge');
    assert.equal(result.payload.data.freshness.state, 'fresh');
    assert.equal(
      result.payload.data.freshness.expiresAt - result.payload.data.freshness.fetchedAt,
      24 * 60 * 60 * 1000,
    );
    assert.equal(result.payload.data.warningCode, undefined);
    assert.deepEqual(calls.map(item => item.url), [
      `${apiRoot}master`,
      `${apiRoot}rule-sha`,
      `${apiRoot}surge-sha?recursive=1`,
    ]);
    assert.equal(calls.some(item => item.url.includes('master?recursive=1')), false);
    assert.ok(calls.every(item => item.headers.Accept === 'application/vnd.github+json'));
    assert.deepEqual(result.payload.data.items.map(item => ({
      name: item.name,
      category: item.category,
      path: item.path,
      format: item.format,
      size: item.size,
      url: item.url,
    })), [
      {
        name: 'Advertising',
        category: 'Advertising',
        path: 'Advertising/Advertising.list',
        format: 'surge',
        size: 1234,
        url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Advertising/Advertising.list',
      },
      {
        name: 'You Tube',
        category: 'Streaming',
        path: 'Streaming/You Tube.list',
        format: 'surge',
        size: 5678,
        url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Streaming/You%20Tube.list',
      },
    ]);
    assert.ok(result.payload.data.items.every(item => /^[a-f0-9]{24}$/.test(item.id)));
  } finally {
    runtime.close();
  }
});

test('serves a fresh catalog from cache and refresh=true bypasses it', async () => {
  const calls = [];
  const sequence = [
    ...successSequence(),
    ...successSequence({ suffix: '-v2' }),
  ];
  const runtime = createRuntime({ networkGet: sequencedNetwork(sequence, calls) });
  try {
    const first = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    const cached = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    assert.equal(first.payload.data.items[0].path, 'Advertising/Advertising.list');
    assert.deepEqual(cached.payload.data, first.payload.data);
    assert.equal(calls.length, 3);

    const refreshed = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' }, query: { refresh: 'true' } },
    );
    assert.equal(calls.length, 6);
    assert.equal(refreshed.payload.data.items[0].path, 'Advertising/Advertising-v2.list');
  } finally {
    runtime.close();
  }
});

test('fails closed when the configured catalog path no longer exists', async () => {
  const runtime = createRuntime({
    networkGet: async () => treeResponse([
      { path: 'README.md', type: 'blob', sha: 'readme-sha' },
    ]),
  });
  try {
    const result = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    assert.equal(result.statusCode, 502);
    assert.equal(result.payload.error.code, 'RULE_STUDIO_CATALOG_PATH_NOT_FOUND');
  } finally {
    runtime.close();
  }
});

test('uses last-known-good catalog metadata after refresh network failure', async () => {
  const calls = [];
  const offline = Object.assign(new Error('request contains token=secret'), {
    code: 'ECONNRESET',
  });
  const sequence = [...successSequence(), offline];
  const runtime = createRuntime({ networkGet: sequencedNetwork(sequence, calls) });
  try {
    const first = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    const stale = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' }, query: { refresh: 'true' } },
    );
    assert.equal(stale.statusCode, 200);
    assert.deepEqual(stale.payload.data.items, first.payload.data.items);
    assert.equal(stale.payload.data.freshness.state, 'stale');
    assert.equal(
      stale.payload.data.freshness.expiresAt - stale.payload.data.freshness.fetchedAt,
      7 * 24 * 60 * 60 * 1000,
    );
    assert.equal(stale.payload.data.warningCode, 'RULE_STUDIO_CATALOG_FETCH_FAILED');
    assert.equal(JSON.stringify(stale.payload).includes('token=secret'), false);
  } finally {
    runtime.close();
  }
});

test('fails closed on a truncated tree without cache and falls back when cached', async () => {
  const truncatedSequence = [
    ...successSequence().slice(0, 2),
    treeResponse([], { truncated: true }),
  ];
  const noCacheRuntime = createRuntime({
    networkGet: sequencedNetwork(truncatedSequence, []),
  });
  try {
    const failed = await requestRoute(
      noCacheRuntime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    assert.equal(failed.statusCode, 502);
    assert.equal(failed.payload.error.code, 'RULE_STUDIO_CATALOG_TRUNCATED');
  } finally {
    noCacheRuntime.close();
  }

  const calls = [];
  const cachedSequence = [
    ...successSequence(),
    ...successSequence().slice(0, 2),
    treeResponse([], { truncated: true }),
  ];
  const cachedRuntime = createRuntime({
    networkGet: sequencedNetwork(cachedSequence, calls),
  });
  try {
    const first = await requestRoute(
      cachedRuntime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    const stale = await requestRoute(
      cachedRuntime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' }, query: { refresh: 'true' } },
    );
    assert.deepEqual(stale.payload.data.items, first.payload.data.items);
    assert.equal(stale.payload.data.freshness.state, 'stale');
    assert.equal(stale.payload.data.warningCode, 'RULE_STUDIO_CATALOG_TRUNCATED');
  } finally {
    cachedRuntime.close();
  }
});

test('reports GitHub rate limiting without exposing the upstream response body', async () => {
  const runtime = createRuntime({
    networkGet: async () => ({
      statusCode: 403,
      headers: { 'x-ratelimit-remaining': '0' },
      body: '{"message":"token=secret"}',
    }),
  });
  try {
    const result = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'blackmatrix7-surge' } },
    );
    assert.equal(result.statusCode, 503);
    assert.equal(result.payload.error.code, 'RULE_STUDIO_CATALOG_RATE_LIMITED');
    assert.equal(JSON.stringify(result.payload).includes('token=secret'), false);
  } finally {
    runtime.close();
  }
});

test('returns a stable not-found error for unknown catalogs without network access', async () => {
  let calls = 0;
  const runtime = createRuntime({ networkGet: async () => { calls += 1; } });
  try {
    const result = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: 'missing' } },
    );
    assert.equal(result.statusCode, 404);
    assert.equal(result.payload.error.code, 'RULE_STUDIO_CATALOG_NOT_FOUND');
    assert.equal(calls, 0);
  } finally {
    runtime.close();
  }
});
