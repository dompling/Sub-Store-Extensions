import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const extension = require('../build/backend/index.cjs');

const extensionId = 'org.substore.config-generator';

function createHost({ failActivation = false } = {}) {
  let storedValue = null;
  let adapter = null;
  let contribution = null;
  const events = [];
  const services = {
    apiVersion: '1.0.0',
    extensionId,
    storage: {
      read: () => storedValue,
      write: value => {
        storedValue = value;
      },
    },
    resources: { listArtifacts: () => [] },
    network: { get: async () => ({ statusCode: 200, body: '' }) },
    transform: { processResponse: async response => response },
    cache: { get: () => null, set: () => undefined },
    tasks: { runRequest: task => task() },
  };
  const host = {
    apiVersion: '1.0.0',
    extensionId,
    services,
    registerAdapter(value) {
      assert.equal(value.extensionId, extensionId);
      adapter = value;
      events.push('register-adapter');
    },
    unregisterAdapter(value) {
      assert.equal(value, adapter);
      events.push('unregister-adapter');
      adapter = null;
    },
    registerContribution(value) {
      assert.equal(value.extensionId, extensionId);
      contribution = value;
      events.push('register-contribution');
    },
    unregisterContribution() {
      events.push('unregister-contribution');
      contribution = null;
    },
    activate() {
      if (failActivation) throw new Error('synthetic Host activation failure');
      events.push('activate');
      return adapter.activate();
    },
    deactivate() {
      events.push('deactivate');
      return adapter.deactivate();
    },
  };
  return {
    host,
    events,
    state: () => ({ adapter, contribution, storedValue }),
  };
}

test('exports the stable executable extension contract', () => {
  assert.deepEqual(Object.keys(extension).sort(), [
    'activate',
    'deactivate',
    'extensionId',
    'implementationAbi',
  ]);
  assert.equal(extension.extensionId, extensionId);
  assert.equal(extension.implementationAbi, 'config-generator@1');
  assert.equal(typeof extension.activate, 'function');
  assert.equal(typeof extension.deactivate, 'function');
});

test('registers, initializes, deactivates, and unregisters through the Host API', () => {
  const fixture = createHost();

  assert.deepEqual(extension.activate(fixture.host), {
    active: true,
    implementationAbi: 'config-generator@1',
  });
  assert.equal(fixture.state().contribution.id, 'config-generator');
  assert.deepEqual(fixture.state().storedValue, {
    version: 1,
    projects: [],
    ruleSets: [],
  });

  assert.deepEqual(extension.deactivate(fixture.host), {
    active: false,
    implementationAbi: 'config-generator@1',
  });
  assert.deepEqual(fixture.events, [
    'register-adapter',
    'register-contribution',
    'activate',
    'deactivate',
    'unregister-contribution',
    'unregister-adapter',
  ]);
  assert.equal(fixture.state().adapter, null);
  assert.equal(fixture.state().contribution, null);
});

test('rolls back registrations when Host activation fails', () => {
  const failed = createHost({ failActivation: true });

  assert.throws(
    () => extension.activate(failed.host),
    /synthetic Host activation failure/,
  );
  assert.deepEqual(failed.events, [
    'register-adapter',
    'register-contribution',
    'unregister-contribution',
    'unregister-adapter',
  ]);
  assert.equal(failed.state().adapter, null);
  assert.equal(failed.state().contribution, null);

  const recovered = createHost();
  extension.activate(recovered.host);
  extension.deactivate(recovered.host);
});

test('rejects an incompatible Host before registering executable code', () => {
  assert.throws(
    () => extension.activate({ apiVersion: '0.9.0', extensionId, services: {} }),
    error => error.code === 'EXTENSION_HOST_API_INCOMPATIBLE',
  );
});
