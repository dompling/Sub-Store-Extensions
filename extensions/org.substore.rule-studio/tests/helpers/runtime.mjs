import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { loadExtension } from '../../../../scripts/lib.mjs';

const require = createRequire(import.meta.url);
export const extensionId = 'org.substore.rule-studio';
export const workspace = await loadExtension(extensionId);
export const extension = require(path.join(workspace.buildDirectory, 'backend/index.cjs'));

function createResponse() {
  let statusCode = 200;
  let payload;
  let mediaType;
  return {
    req: { route: { path: '' } },
    status(value) { statusCode = value; return this; },
    json(value) { payload = value; return this; },
    type(value) { mediaType = value; return this; },
    send(value) { payload = value; return this; },
    result: () => ({ statusCode, payload, mediaType }),
  };
}

function registerRoutes(contribution) {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    app[method] = (route, handler) => {
      routes.set(`${method.toUpperCase()} ${route}`, handler);
      return app;
    };
  }
  contribution.registerRoutes(app, {});
  return routes;
}

export function createRuntime({
  initialStore = null,
  networkGet,
  referencesListIncoming,
  resolveClientTarget,
  now = Date.now(),
} = {}) {
  let storedValue = initialStore;
  let adapter;
  let contribution;
  const cacheValues = new Map();
  const services = {
    apiVersion: '1.0.0',
    extensionId,
    storage: {
      read: () => storedValue,
      write: value => { storedValue = value; },
    },
    network: {
      get: networkGet || (async () => ({ statusCode: 200, headers: {}, body: 'DOMAIN,example.com' })),
    },
    cache: {
      get: key => cacheValues.has(key) ? cacheValues.get(key) : null,
      set: (key, value) => { cacheValues.set(key, value); },
    },
    resources: {
      list: async () => [],
      get: async () => null,
      produce: async () => null,
    },
    references: {
      listIncoming: referencesListIncoming || (async () => []),
    },
    tasks: { runRequest: task => task() },
  };
  if (resolveClientTarget) services.request = { resolveClientTarget };
  const host = {
    apiVersion: '1.0.0', extensionId, services,
    registerAdapter(value) { adapter = value; },
    unregisterAdapter() { adapter = null; },
    registerContribution(value) { contribution = value; },
    unregisterContribution() { contribution = null; },
    activate() { return adapter.activate(); },
    deactivate() { return adapter.deactivate(); },
  };
  extension.activate(host);
  return {
    routes: registerRoutes(contribution),
    contribution: () => contribution,
    storedValue: () => storedValue,
    cacheValues,
    now,
    close: () => extension.deactivate(host),
  };
}

export async function requestRoute(runtime, method, route, request = {}) {
  const handler = runtime.routes.get(`${method.toUpperCase()} ${route}`);
  assert.equal(typeof handler, 'function', `${method.toUpperCase()} ${route}`);
  const response = createResponse();
  await handler({ body: {}, query: {}, params: {}, ...request }, response);
  return response.result();
}

export const inlineProject = (overrides = {}) => ({
  name: 'Test rules',
  description: 'fixture',
  sources: [{
    id: 'source-inline',
    kind: 'inline',
    enabled: true,
    format: 'surge',
    content: '# comment\nDOMAIN,Example.COM,Proxy\nDOMAIN-SUFFIX,example.org\nIP-CIDR,192.168.1.4/24,no-resolve\nPROCESS-NAME,Example,DIRECT',
  }],
  options: { deduplicate: true, preserveComments: true },
  ...overrides,
});
