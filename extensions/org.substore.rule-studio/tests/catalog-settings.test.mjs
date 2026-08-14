import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, inlineProject, requestRoute } from './helpers/runtime.mjs';

test('migrates schema 1 stores without losing projects and starts with no catalog enabled', async () => {
  const project = {
    ...inlineProject(),
    id: 'existing-project',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    lifecycle: { state: 'active' },
  };
  const runtime = createRuntime({
    initialStore: { schemaVersion: 1, projects: [project] },
  });
  try {
    assert.deepEqual(runtime.storedValue(), {
      schemaVersion: 3,
      projects: [project],
      catalogSettings: { enabledCatalogIds: [], customCatalogs: [] },
    });

    const projects = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/projects');
    assert.equal(projects.statusCode, 200);
    assert.equal(projects.payload.data[0].ref.id, project.id);

    const catalogs = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/source-catalogs');
    assert.equal(catalogs.statusCode, 200);
    assert.equal(catalogs.payload.data[0].enabled, false);
  } finally {
    runtime.close();
  }
});

test('persists enabled catalog ids and rejects unknown catalog settings', async () => {
  const runtime = createRuntime();
  try {
    const updated = await requestRoute(
      runtime,
      'PATCH',
      '/api/extensions/rule-studio/source-catalogs/settings',
      { body: { enabledCatalogIds: ['blackmatrix7-surge', 'blackmatrix7-surge'] } },
    );
    assert.equal(updated.statusCode, 200);
    assert.deepEqual(updated.payload.data, {
      enabledCatalogIds: ['blackmatrix7-surge'],
    });
    assert.deepEqual(runtime.storedValue().catalogSettings, {
      enabledCatalogIds: ['blackmatrix7-surge'],
      customCatalogs: [],
    });

    const catalogs = await requestRoute(runtime, 'GET', '/api/extensions/rule-studio/source-catalogs');
    assert.equal(catalogs.payload.data[0].enabled, true);

    const rejected = await requestRoute(
      runtime,
      'PATCH',
      '/api/extensions/rule-studio/source-catalogs/settings',
      { body: { enabledCatalogIds: ['unknown-catalog'] } },
    );
    assert.equal(rejected.statusCode, 400);
    assert.equal(rejected.payload.error.code, 'RULE_STUDIO_CATALOG_SETTINGS_INVALID');
    assert.deepEqual(runtime.storedValue().catalogSettings, {
      enabledCatalogIds: ['blackmatrix7-surge'],
      customCatalogs: [],
    });
  } finally {
    runtime.close();
  }
});

test('migrates schema 2 catalog settings and supports custom GitHub catalog CRUD', async () => {
  const project = {
    ...inlineProject(),
    id: 'existing-project',
    revision: 1,
    createdAt: 1,
    updatedAt: 1,
    lifecycle: { state: 'active' },
  };
  const runtime = createRuntime({
    initialStore: {
      schemaVersion: 2,
      projects: [project],
      catalogSettings: { enabledCatalogIds: ['blackmatrix7-surge'] },
    },
    networkGet: async () => ({
      statusCode: 200,
      headers: {},
      body: JSON.stringify({
        truncated: false,
        tree: [{ type: 'blob', path: 'Rules.list', size: 128 }],
      }),
    }),
  });
  try {
    assert.deepEqual(runtime.storedValue(), {
      schemaVersion: 3,
      projects: [project],
      catalogSettings: {
        enabledCatalogIds: ['blackmatrix7-surge'],
        customCatalogs: [],
      },
    });

    const created = await requestRoute(
      runtime,
      'POST',
      '/api/extensions/rule-studio/source-catalogs',
      {
        body: {
          url: 'https://github.com/example/rules/tree/main',
          name: 'Example Rules',
          format: 'surge',
        },
      },
    );
    assert.equal(created.statusCode, 201);
    assert.match(created.payload.data.id, /^custom-/);
    assert.equal(created.payload.data.custom, true);
    assert.equal(created.payload.data.repository.owner, 'example');
    assert.equal(created.payload.data.repository.name, 'rules');
    assert.equal(created.payload.data.repository.ref, 'main');
    assert.equal(created.payload.data.rootPath, '');

    const customId = created.payload.data.id;
    const enabled = await requestRoute(
      runtime,
      'PATCH',
      '/api/extensions/rule-studio/source-catalogs/settings',
      { body: { enabledCatalogIds: ['blackmatrix7-surge', customId] } },
    );
    assert.equal(enabled.statusCode, 200);

    const items = await requestRoute(
      runtime,
      'GET',
      '/api/extensions/rule-studio/source-catalogs/:id/items',
      { params: { id: customId } },
    );
    assert.equal(items.statusCode, 200);
    assert.equal(items.payload.data.items.length, 1);
    assert.equal(
      items.payload.data.items[0].url,
      'https://raw.githubusercontent.com/example/rules/main/Rules.list',
    );

    const updated = await requestRoute(
      runtime,
      'PATCH',
      '/api/extensions/rule-studio/source-catalogs/:id',
      {
        params: { id: customId },
        body: {
          url: 'https://github.com/example/rules/tree/main',
          name: 'Renamed Rules',
          format: 'auto',
        },
      },
    );
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.payload.data.id, customId);
    assert.equal(updated.payload.data.name, 'Renamed Rules');

    const removed = await requestRoute(
      runtime,
      'DELETE',
      '/api/extensions/rule-studio/source-catalogs/:id',
      { params: { id: customId } },
    );
    assert.equal(removed.statusCode, 200);
    assert.equal(removed.payload.data.id, customId);
    assert.deepEqual(runtime.storedValue(), {
      schemaVersion: 3,
      projects: [project],
      catalogSettings: {
        enabledCatalogIds: ['blackmatrix7-surge'],
        customCatalogs: [],
      },
    });
  } finally {
    runtime.close();
  }
});
