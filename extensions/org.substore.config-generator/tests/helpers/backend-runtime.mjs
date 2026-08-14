import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { loadExtension } from '../../../../scripts/lib.mjs';

const require = createRequire(import.meta.url);
const extensionId = 'org.substore.config-generator';
const workspace = await loadExtension(extensionId);
const extension = require(path.join(workspace.buildDirectory, 'backend/index.cjs'));

function createResponse() {
  let statusCode = 200;
  let payload;
  return {
    req: { route: { path: '' } },
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
    type() {
      return this;
    },
    send(value) {
      payload = value;
      return this;
    },
    result() {
      return { statusCode, payload };
    },
  };
}

function registerRoutes(contribution, produceBuiltinArtifact) {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    app[method] = (route, handler) => {
      routes.set(`${method.toUpperCase()} ${route}`, handler);
      return app;
    };
  }
  contribution.registerRoutes(app, { produceBuiltinArtifact });
  return routes;
}

function createHost({
  initialStore = null,
  networkGet = async () => ({ statusCode: 200, body: '' }),
  processResponse = async response => response,
  cache = new Map(),
  resourceDescriptors = [],
  resourceOutputs = new Map(),
  resolveClientTarget,
} = {}) {
  let storedValue = initialStore;
  let adapter;
  let contribution;
  const services = {
    apiVersion: '1.0.0',
    extensionId,
    storage: {
      read: () => storedValue,
      write: value => {
        storedValue = value;
      },
    },
    resources: {
      listArtifacts: () => [],
      list: async ({ types, contracts } = {}) => resourceDescriptors.filter(item =>
        (!types?.length || types.includes(item.ref.type))
          && (!contracts?.length || contracts.includes(item.ref.contract))),
      get: async ref => {
        const descriptor = resourceDescriptors.find(item => JSON.stringify(item.ref) === JSON.stringify(ref));
        if (!descriptor) {
          const error = new Error('Resource not found');
          error.code = 'RESOURCE_NOT_FOUND';
          throw error;
        }
        return descriptor;
      },
      produce: async (ref, options) => {
        const key = `${ref.providerContributionId}\0${ref.id}\0${options.representation}`;
        const output = resourceOutputs.get(key);
        if (!output) {
          const error = new Error('Resource output not found');
          error.code = 'RESOURCE_NOT_FOUND';
          throw error;
        }
        return output;
      },
    },
    references: {
      replaceOwn: async () => undefined,
      listIncoming: async () => [],
    },
    network: { get: networkGet },
    transform: { processResponse },
    cache: {
      get: key => cache.has(key) ? cache.get(key) : null,
      set: (key, value) => cache.set(key, value),
    },
    tasks: { runRequest: task => task() },
  };
  if (resolveClientTarget) {
    services.request = { resolveClientTarget };
  }
  return {
    host: {
      apiVersion: '1.0.0',
      extensionId,
      services,
      registerAdapter(value) {
        adapter = value;
      },
      unregisterAdapter() {
        adapter = null;
      },
      registerContribution(value) {
        contribution = value;
      },
      unregisterContribution() {
        contribution = null;
      },
      activate() {
        return adapter.activate();
      },
      deactivate() {
        return adapter.deactivate();
      },
    },
    contribution: () => contribution,
    storedValue: () => storedValue,
    cache,
  };
}

export async function withRuntime(options = {}, callback) {
  const fixture = createHost(options);
  extension.activate(fixture.host);
  try {
    const produceBuiltinArtifact = options.produceBuiltinArtifact || (async () => '');
    const routes = registerRoutes(fixture.contribution(), produceBuiltinArtifact);
    return await callback({ fixture, routes });
  } finally {
    extension.deactivate(fixture.host);
  }
}

export async function requestRoute(routes, method, route, request = {}) {
  const handler = routes.get(`${method.toUpperCase()} ${route}`);
  assert.equal(typeof handler, 'function', `${method.toUpperCase()} ${route}`);
  const response = createResponse();
  await handler(request, response);
  return response.result();
}

export async function preview(target, project, ruleSets = [], options = {}) {
  return withRuntime(options, async ({ routes }) => {
    const result = await requestRoute(
      routes,
      'POST',
      `/api/extensions/config-generator/preview/${target}`,
      { body: { project, ruleSets } },
    );
    if (options.allowError) return result;
    assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    assert.equal(result.payload?.status, 'success');
    return result.payload.data;
  });
}

export async function importConfig(target, content, sourceContext) {
  return withRuntime({}, async ({ routes }) => {
    const result = await requestRoute(
      routes,
      'POST',
      `/api/extensions/config-generator/import/${target}`,
      { body: { content, sourceContext } },
    );
    assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    assert.equal(result.payload?.status, 'success');
    return result.payload.data;
  });
}

export { parseYaml };
