import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestRoute, withRuntime } from './helpers/backend-runtime.mjs';

const project = {
  name: 'client-target-project',
  remoteProxySources: [],
  groups: [],
  rules: [],
  outputs: {
    surge: {},
    qx: {},
    clash: {},
    loon: {},
  },
};

function resolveClientTarget(request = {}) {
  if (request.query?.platform) {
    return { value: request.query.platform, source: 'platform-query' };
  }
  if (request.query?.target) {
    return { value: request.query.target, source: 'target-query' };
  }
  const userAgent = `${request.headers?.['user-agent'] || ''}`;
  if (userAgent.includes('Quantumult')) return { value: 'QX', source: 'user-agent' };
  if (userAgent.includes('Loon')) return { value: 'Loon', source: 'user-agent' };
  if (userAgent.includes('Clash-Verge')) return { value: 'ClashMeta', source: 'user-agent' };
  if (userAgent.includes('Surge Mac')) return { value: 'SurgeMac', source: 'user-agent' };
  return { value: 'V2Ray', source: 'default' };
}

async function download(options = {}) {
  return withRuntime({
    initialStore: { version: 1, projects: [project], ruleSets: [] },
    resolveClientTarget,
    processResponse: async (_response, _processors, platform) => ({
      body: `TARGET:${platform}`,
    }),
  }, async ({ routes }) => requestRoute(
    routes,
    'GET',
    options.route || '/download/config-project/:name',
    {
      params: { name: project.name, ...(options.params || {}) },
      query: options.query || {},
      headers: options.headers || {},
    },
  ));
}

test('maps the Host detected client to the closest supported config target', async () => {
  const cases = [
    ['Quantumult%20X/1.4.0', 'QX'],
    ['Loon/852', 'Loon'],
    ['Clash-Verge/v2.4.2', 'Clash'],
    ['Surge Mac/5.12.0', 'Surge'],
    ['Mozilla/5.0', 'Surge'],
  ];

  for (const [userAgent, expected] of cases) {
    const result = await download({ headers: { 'user-agent': userAgent } });
    assert.equal(result.statusCode, 200, userAgent);
    assert.equal(result.payload, `TARGET:${expected}`, userAgent);
  }
});

test('keeps explicit platform and path targets ahead of User-Agent detection', async () => {
  const platformResult = await download({
    query: { platform: 'Loon', target: 'Surge' },
    headers: { 'user-agent': 'Clash-Verge/v2.4.2' },
  });
  assert.equal(platformResult.payload, 'TARGET:Loon');

  const pathResult = await download({
    route: '/download/config-project/:name/:target',
    params: { target: 'QX' },
    query: { target: 'Loon' },
    headers: { 'user-agent': 'Clash-Verge/v2.4.2' },
  });
  assert.equal(pathResult.payload, 'TARGET:QX');
});

test('keeps the legacy Surge fallback when the Host request service is unavailable', async () => {
  const result = await withRuntime({
    initialStore: { version: 1, projects: [project], ruleSets: [] },
    processResponse: async (_response, _processors, platform) => ({
      body: `TARGET:${platform}`,
    }),
  }, async ({ routes }) => requestRoute(
    routes,
    'GET',
    '/download/config-project/:name',
    { params: { name: project.name }, headers: { 'user-agent': 'Loon/852' } },
  ));

  assert.equal(result.statusCode, 200);
  assert.equal(result.payload, 'TARGET:Surge');
});
