import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, inlineProject, requestRoute } from './helpers/runtime.mjs';

test('creates stable IDs, enforces revision CAS, archives and restores without deleting content', async () => {
  const runtime = createRuntime();
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', { body: inlineProject() });
    assert.equal(created.statusCode, 201);
    const project = created.payload.data;
    assert.match(project.id, /^[0-9a-f-]{36}$/i);

    const updated = await requestRoute(runtime, 'PATCH', '/api/extensions/rule-studio/project/:id', {
      params: { id: project.id },
      body: { ...project, name: 'Renamed', revision: project.revision },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.payload.data.id, project.id);
    assert.equal(updated.payload.data.revision, 2);

    const conflict = await requestRoute(runtime, 'PATCH', '/api/extensions/rule-studio/project/:id', {
      params: { id: project.id },
      body: { ...project, name: 'Stale', revision: 1 },
    });
    assert.equal(conflict.statusCode, 409);
    assert.equal(conflict.payload.error.code, 'RESOURCE_REVISION_CONFLICT');

    const archived = await requestRoute(runtime, 'DELETE', '/api/extensions/rule-studio/project/:id', { params: { id: project.id } });
    assert.equal(archived.payload.data.project.lifecycle.state, 'archived');
    assert.equal(archived.payload.data.project.sources.length, 1);

    const normalList = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/projects');
    assert.equal(normalList.payload.data.length, 0);
    const archivedList = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/projects', { query: { archived: 'true' } });
    assert.equal(archivedList.payload.data[0].lifecycle.state, 'archived');

    const providerResult = await runtime.contribution().artifactSources[0].produce({
      ref: archivedList.payload.data[0].ref,
      representation: 'surge-rule-list',
      freshnessPolicy: 'allow-stale',
    });
    assert.equal(providerResult.schema, 'substore.resource-output@1');
    assert.equal(providerResult.ref.id, project.id);
    assert.equal(providerResult.representation, 'surge-rule-list');
    assert.match(providerResult.body, /DOMAIN,example\.com/);

    const restored = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/project/:id/restore', { params: { id: project.id } });
    assert.equal(restored.payload.data.lifecycle.state, 'active');
    assert.equal(restored.payload.data.id, project.id);
  } finally {
    runtime.close();
  }
});

test('fails closed when restoring an archived project would create an active name collision', async () => {
  const runtime = createRuntime();
  try {
    const first = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject({ name: 'Shared name' }),
    });
    await requestRoute(runtime, 'DELETE', '/api/extensions/rule-studio/project/:id', {
      params: { id: first.payload.data.id },
    });
    const second = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject({ name: 'Shared name' }),
    });
    assert.equal(second.statusCode, 201);

    const restored = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/project/:id/restore', {
      params: { id: first.payload.data.id },
    });
    assert.equal(restored.statusCode, 409);
    assert.equal(restored.payload.error.code, 'RULE_STUDIO_PROJECT_NAME_EXISTS');

    const archived = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/project/:id', {
      params: { id: first.payload.data.id },
    });
    assert.equal(archived.payload.data.lifecycle.state, 'archived');
  } finally {
    runtime.close();
  }
});

test('permanently deletes an unreferenced project from the store', async () => {
  const runtime = createRuntime();
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject(),
    });
    const project = created.payload.data;

    const deleted = await requestRoute(runtime, 'DELETE', '/api/extensions/rule-studio/project/:id/permanent', {
      params: { id: project.id },
    });
    assert.equal(deleted.statusCode, 200);
    assert.deepEqual(deleted.payload.data, { id: project.id });

    const activeList = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/projects');
    const archivedList = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/projects', {
      query: { archived: 'true' },
    });
    const details = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/project/:id', {
      params: { id: project.id },
    });
    assert.deepEqual(activeList.payload.data, []);
    assert.deepEqual(archivedList.payload.data, []);
    assert.equal(details.statusCode, 404);
  } finally {
    runtime.close();
  }
});

test('rejects permanent deletion when another project references the rule set', async () => {
  const runtime = createRuntime({
    referencesListIncoming: async () => [{ owner: { providerId: 'config-generator', name: 'Main' } }],
  });
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject(),
    });
    const project = created.payload.data;

    const deleted = await requestRoute(runtime, 'DELETE', '/api/extensions/rule-studio/project/:id/permanent', {
      params: { id: project.id },
    });
    assert.equal(deleted.statusCode, 409);
    assert.equal(deleted.payload.error.code, 'RULE_STUDIO_PROJECT_IN_USE');
    assert.equal(runtime.storedValue().projects.length, 1);
  } finally {
    runtime.close();
  }
});

test('persists an optional project icon and exposes it through resource metadata', async () => {
  const runtime = createRuntime();
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject({ iconUrl: '  https://example.com/rules.png  ' }),
    });
    assert.equal(created.statusCode, 201);
    assert.equal(created.payload.data.iconUrl, 'https://example.com/rules.png');

    const descriptor = runtime.contribution().artifactSources[0].get(created.payload.data.id);
    assert.equal(descriptor.metadata.iconUrl, 'https://example.com/rules.png');

    const updated = await requestRoute(runtime, 'PATCH', '/api/extensions/rule-studio/project/:id', {
      params: { id: created.payload.data.id },
      body: {
        ...created.payload.data,
        iconUrl: '',
        revision: created.payload.data.revision,
      },
    });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.payload.data.iconUrl, undefined);
    assert.equal(
      runtime.contribution().artifactSources[0].get(created.payload.data.id).metadata.iconUrl,
      undefined,
    );
  } finally {
    runtime.close();
  }
});

test('registers one canonical provider ABI with thin config-hosting adapters', async () => {
  const runtime = createRuntime();
  try {
    const source = runtime.contribution().artifactSources[0];
    assert.equal(source.id, 'org.substore.rule-studio.rule-sets');
    assert.equal(source.type, 'rule-set');
    assert.equal(source.contract, 'substore.rule-set@1');
    assert.ok(source.representations.includes('clash-domain-yaml'));
    for (const method of ['list', 'get', 'produce', 'findSourceConfig', 'collectDependencies', 'produceForSync']) {
      assert.equal(typeof source[method], 'function', method);
    }
    assert.equal(source.listResources, undefined);
    assert.equal(source.getResource, undefined);
    assert.equal(source.produceResource, undefined);

    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', { body: inlineProject() });
    const project = created.payload.data;
    const [descriptor] = source.list();
    assert.equal(descriptor.schema, 'substore.resource-descriptor@1');
    assert.equal(descriptor.ref.id, project.id);
    assert.equal(descriptor.ref.providerId, 'org.substore.rule-studio');
    assert.equal(descriptor.ref.providerContributionId, 'org.substore.rule-studio.rule-sets');
    assert.ok(descriptor.contracts.includes('substore.rule-set@1'));
    assert.ok(descriptor.representations.includes('surge-rule-list'));
    assert.equal(descriptor.lifecycle.state, 'active');
    assert.equal(descriptor.availability.status, 'available');
    assert.deepEqual(source.get({ ref: descriptor.ref }), descriptor);
    assert.deepEqual(source.get(project.id), descriptor);
    assert.equal(source.findSourceConfig({ id: project.id }).id, project.id);
    assert.equal(source.findSourceConfig(project.name).id, project.id);
    assert.throws(
      () => source.get({ id: 'missing' }),
      error => error.code === 'RESOURCE_NOT_FOUND' && error.statusCode === 404,
    );

    const output = await source.produce({
      id: project.id,
      representation: 'surge-rule-list',
      target: 'Surge',
      freshnessPolicy: 'allow-stale',
      produceBuiltinArtifact: async () => { throw new Error('must not be called'); },
    });
    assert.equal(output.schema, 'substore.resource-output@1');
    assert.equal(output.ref.id, project.id);
    assert.equal(output.representation, 'surge-rule-list');
    assert.match(output.body, /DOMAIN,example\.com/);

    const syncOutput = await source.produceForSync({
      ref: descriptor.ref,
      representation: 'surge-rule-list',
      freshnessPolicy: 'allow-stale',
    });
    assert.equal(syncOutput.body, output.body);
    assert.equal(syncOutput.sourceRevision, output.sourceRevision);
    assert.deepEqual(syncOutput.diagnostics, output.diagnostics);
    assert.doesNotThrow(() => syncOutput.assertFresh());
  } finally {
    runtime.close();
  }
});

test('reference index failures do not block project details or archival', async () => {
  const runtime = createRuntime({
    referencesListIncoming: async () => {
      throw Object.assign(new Error('reference index corrupted'), {
        code: 'REFERENCE_INDEX_CORRUPTED',
      });
    },
  });
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', { body: inlineProject() });
    const project = created.payload.data;

    const details = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/project/:id', {
      params: { id: project.id },
    });
    assert.equal(details.statusCode, 200);
    assert.deepEqual(details.payload.data.incoming, {
      available: false,
      count: 0,
      owners: [],
    });

    const archived = await requestRoute(runtime, 'DELETE', '/api/extensions/rule-studio/project/:id', {
      params: { id: project.id },
    });
    assert.equal(archived.statusCode, 200);
    assert.equal(archived.payload.data.project.lifecycle.state, 'archived');
    assert.deepEqual(archived.payload.data.incoming, {
      available: false,
      count: 0,
      owners: [],
    });
  } finally {
    runtime.close();
  }
});
