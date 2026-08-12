import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { loadExtension } from '../../../scripts/lib.mjs';

const require = createRequire(import.meta.url);
const extensionId = 'org.substore.config-generator';
const workspace = await loadExtension(extensionId);
const extension = require(path.join(workspace.buildDirectory, 'backend/index.cjs'));

function createHost({
  failActivation = false,
  initialStore = null,
  processResponse = async response => response,
} = {}) {
  let storedValue = initialStore;
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
    transform: { processResponse },
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

function registerRoutes(contribution, produceBuiltinArtifact = async () => '') {
  const routes = new Map();
  const app = {};
  for (const method of ['get', 'post', 'patch', 'delete']) {
    app[method] = (route, handler) => {
      routes.set(`${method.toUpperCase()} ${route}`, handler);
    };
  }
  contribution.registerRoutes(app, { produceBuiltinArtifact });
  return routes;
}

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

async function withNodeRuntime(options, callback) {
  const fixture = createHost(options);
  extension.activate(fixture.host);
  try {
    return await callback({
      fixture,
      routes: registerRoutes(
        fixture.state().contribution,
        options?.produceBuiltinArtifact,
      ),
    });
  } finally {
    extension.deactivate(fixture.host);
  }
}

async function previewConfig(target, project, ruleSets = []) {
  return withNodeRuntime({}, async ({ routes }) => {
    const handler = routes.get(
      `POST /api/extensions/config-generator/preview/${target}`,
    );
    assert.equal(typeof handler, 'function');
    const response = createResponse();
    await handler({ body: { project, ruleSets } }, response);
    const result = response.result();
    assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    assert.equal(result.payload?.status, 'success');
    return result.payload.data;
  });
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

test('keeps all four target generators available through the Node package routes', async () => {
  const project = {
    name: 'node-package-matrix',
    remoteProxySources: [],
    groups: [
      {
        name: 'Proxy',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      },
    ],
    rules: [{ kind: 'final', policy: 'Proxy' }],
    outputs: { surge: {}, qx: {}, clash: {}, loon: {} },
  };

  const outputs = [];
  for (const target of ['surge', 'qx', 'clash', 'loon']) {
    outputs.push(await previewConfig(target, project));
  }
  for (const output of outputs) {
    assert.equal(typeof output.body, 'string');
    assert.match(output.body, /Proxy/);
  }
});

test('degrades unsupported Clash policy groups and unavailable remote inputs through the Node package', async () => {
  const result = await previewConfig(
    'clash',
    {
      name: 'clash-policy-fallbacks',
      remoteProxySources: [
        {
          name: 'Surge Nodes',
          source: {
            kind: 'url',
            url: 'https://example.com/surge.conf',
            target: 'surge',
          },
        },
      ],
      groups: [
        {
          name: 'Base',
          type: 'select',
          members: [{ kind: 'builtin', value: 'DIRECT' }],
        },
        {
          name: 'Auto',
          type: 'smart',
          members: [],
          remoteProxySource: 'Surge Nodes',
        },
        {
          name: 'Network',
          type: 'subnet',
          members: [],
          targetOptions: {
            surge: {
              subnetDefault: 'Auto',
              subnetRules: [{ expression: 'TYPE:WIFI', policy: 'Base' }],
            },
          },
        },
        {
          name: 'WiFi',
          type: 'ssid',
          members: [
            { kind: 'builtin', value: 'DIRECT' },
            {
              kind: 'conditional',
              value: 'LINK_HOME:Network',
              policy: 'Network',
            },
          ],
        },
        {
          name: 'Proxy',
          type: 'select',
          members: [
            { kind: 'group', value: 'Auto' },
            { kind: 'group', value: 'Network' },
            { kind: 'group', value: 'WiFi' },
          ],
        },
      ],
      rules: [
        { kind: 'remote', ruleSet: 'QX only', policy: 'Proxy' },
        { kind: 'final', policy: 'Proxy' },
      ],
      outputs: { clash: {} },
    },
    [
      {
        name: 'QX only',
        source: {
          kind: 'url',
          url: 'https://example.com/qx.list',
          target: 'qx',
        },
      },
    ],
  );

  assert.match(result.body, /name: Auto\n\s+type: url-test\n\s+proxies:\n\s+- DIRECT/);
  assert.match(result.body, /name: Network\n\s+type: select\n\s+proxies:\n\s+- Auto\n\s+- Base/);
  assert.match(result.body, /name: WiFi\n\s+type: select\n\s+proxies:\n\s+- DIRECT\n\s+- Network/);
  assert.match(result.body, /name: Proxy\n\s+type: select\n\s+proxies:\n\s+- Auto\n\s+- Network\n\s+- WiFi/);
  assert.match(result.body, /rules:\n\s+- MATCH,Proxy/);
  assert.equal(result.body.includes('QX only:'), false);
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('fell back to DIRECT')
    ),
    true,
  );
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('Surge subnet was approximated as Clash select')
    ),
    true,
  );
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('Quantumult X ssid was approximated as Clash select')
    ),
    true,
  );
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('no provider mapping is available for Clash')
    ),
    true,
  );
});

test('degrades unsupported Loon policy groups and unavailable remote inputs through the Node package', async () => {
  const result = await previewConfig(
    'loon',
    {
      name: 'loon-policy-fallbacks',
      remoteProxySources: [
        {
          name: 'Clash Nodes',
          source: {
            kind: 'url',
            url: 'https://example.com/clash.yaml',
            target: 'clash',
          },
        },
      ],
      groups: [
        {
          name: 'Base',
          type: 'select',
          members: [{ kind: 'builtin', value: 'REJECT' }],
        },
        {
          name: 'Auto',
          type: 'smart',
          members: [],
          remoteProxySource: 'Clash Nodes',
        },
        {
          name: 'Network',
          type: 'subnet',
          members: [],
          targetOptions: {
            surge: {
              subnetDefault: 'Auto',
              subnetRules: [{ expression: 'TYPE:WIFI', policy: 'Base' }],
            },
          },
        },
        {
          name: 'Proxy',
          type: 'select',
          members: [
            { kind: 'group', value: 'Auto' },
            { kind: 'group', value: 'Network' },
          ],
        },
      ],
      rules: [
        { kind: 'remote', ruleSet: 'QX only', policy: 'Proxy' },
        { kind: 'final', policy: 'Proxy' },
      ],
      outputs: { loon: {} },
    },
    [
      {
        name: 'QX only',
        source: {
          kind: 'url',
          url: 'https://example.com/qx.list',
          target: 'qx',
        },
      },
    ],
  );

  assert.match(
    result.body,
    /Auto = url-test, DIRECT, url = http:\/\/www\.gstatic\.com\/generate_204/,
  );
  assert.match(result.body, /Network = select, Auto, Base/);
  assert.match(result.body, /Proxy = select, Auto, Network/);
  assert.match(result.body, /FINAL, Proxy/);
  assert.equal(result.body.includes('https://example.com/qx.list'), false);
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('fell back to DIRECT')
    ),
    true,
  );
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('Surge subnet was approximated as Loon select')
    ),
    true,
  );
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('no provider mapping is available for Loon')
    ),
    true,
  );
});

test('ignores stale Surge subnet options on non-subnet groups when detecting cycles', async () => {
  const result = await previewConfig('surge', {
    name: 'stale-non-subnet-options',
    remoteProxySources: [],
    groups: [
      {
        name: 'Main',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
        targetOptions: {
          surge: {
            subnetDefault: 'Main',
            subnetRules: [{ expression: 'TYPE:WIFI', policy: 'Main' }],
          },
        },
      },
    ],
    rules: [{ kind: 'final', policy: 'Main' }],
    outputs: { surge: {} },
  });

  assert.match(result.body, /\[Proxy Group\]\nMain = select, DIRECT/);
});

test('keeps unnamed remote rule identifiers target-local without mutating the project', async () => {
  const project = {
    name: 'unnamed-remote-rule',
    remoteProxySources: [],
    groups: [],
    rules: [
      {
        kind: 'remote',
        ruleSet: 'internal-rule-set-id',
        policy: 'REJECT',
      },
    ],
    outputs: { surge: {}, qx: {}, clash: {}, loon: {} },
  };
  const ruleSets = [
    {
      name: 'internal-rule-set-id',
      source: {
        kind: 'url',
        url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Advertising/Advertising.list',
        target: 'surge',
      },
    },
  ];
  const original = structuredClone({ project, ruleSets });

  const surge = await previewConfig('surge', project, ruleSets);
  const qx = await previewConfig('qx', project, ruleSets);
  const clash = parseYaml((await previewConfig('clash', project, ruleSets)).body);
  const loon = await previewConfig('loon', project, ruleSets);

  assert.match(
    surge.body,
    /RULE-SET, https:\/\/raw\.githubusercontent\.com\/blackmatrix7\/ios_rule_script\/master\/rule\/Surge\/Advertising\/Advertising\.list, REJECT/,
  );
  assert.equal(surge.body.includes('internal-rule-set-id'), false);
  assert.match(
    qx.body,
    /Advertising\.list, force-policy=reject, enabled=true/,
  );
  assert.equal(qx.body.includes('tag='), false);
  assert.equal(qx.body.includes('internal-rule-set-id'), false);
  assert.ok(clash['rule-providers']['internal-rule-set-id']);
  assert.equal(
    clash['rule-providers']['internal-rule-set-id'].url,
    'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Advertising/Advertising.yaml',
  );
  assert.ok(clash.rules.includes('RULE-SET,internal-rule-set-id,REJECT'));
  assert.match(
    loon.body,
    /rule\/Loon\/Advertising\/Advertising\.list, policy=REJECT, enabled=true/,
  );
  assert.equal(loon.body.includes('internal-rule-set-id'), false);
  assert.deepEqual({ project, ruleSets }, original);
});

test('preserves Surge rule order while separating repeated RULE-SET policy blocks', async () => {
  const result = await previewConfig(
    'surge',
    {
      name: 'ordered-rule-set-blocks',
      remoteProxySources: [],
      groups: [
        {
          name: 'Proxy',
          type: 'select',
          members: [{ kind: 'builtin', value: 'DIRECT' }],
        },
      ],
      rules: [
        {
          kind: 'inline',
          type: 'DOMAIN',
          value: 'first.example',
          policy: 'DIRECT',
        },
        { kind: 'remote', ruleSet: 'first', policy: 'Proxy' },
        {
          kind: 'inline',
          type: 'DOMAIN',
          value: 'separator.example',
          policy: 'DIRECT',
        },
        { kind: 'remote', ruleSet: 'second', policy: 'Proxy' },
        { kind: 'final', policy: 'Proxy' },
      ],
      outputs: { surge: {} },
    },
    [
      {
        name: 'first',
        source: {
          kind: 'url',
          url: 'https://example.com/first.list',
          target: 'surge',
        },
      },
      {
        name: 'second',
        source: {
          kind: 'url',
          url: 'https://example.com/second.list',
          target: 'surge',
        },
      },
    ],
  );

  const rules = result.body.slice(result.body.indexOf('[Rule]'));
  const heading = '# ==================== Proxy ====================';
  assert.equal(rules.split(heading).length, 3);
  assert.match(
    rules,
    /DOMAIN, first\.example, DIRECT\n\n# ==================== Proxy ====================\nRULE-SET, https:\/\/example\.com\/first\.list, Proxy\n\nDOMAIN, separator\.example, DIRECT\n\n# ==================== Proxy ====================\nRULE-SET, https:\/\/example\.com\/second\.list, Proxy\n\nFINAL, Proxy/,
  );
});

test('round-trips exact Quantumult X policy mappings through Node import and preview routes', async () => {
  const project = {
    name: 'qx-policy-mapping',
    remoteProxySources: [],
    groups: [
      {
        name: 'Manual',
        type: 'select',
        members: [
          { kind: 'proxy', value: 'Node A' },
          { kind: 'builtin', value: 'DIRECT' },
        ],
      },
      {
        name: 'Available',
        type: 'fallback',
        members: [
          { kind: 'group', value: 'Manual' },
          { kind: 'proxy', value: 'Node B' },
        ],
      },
      {
        name: 'Fast',
        type: 'url-test',
        members: [
          { kind: 'group', value: 'Available' },
          { kind: 'builtin', value: 'DIRECT' },
        ],
        interval: 600,
        tolerance: 50,
      },
    ],
    rules: [{ kind: 'final', policy: 'Fast' }],
    outputs: { qx: { independentConfig: '' } },
  };
  const generated = await previewConfig('qx', project);
  const policySection = generated.body.slice(
    generated.body.indexOf('[policy]'),
    generated.body.indexOf('[filter_local]'),
  );
  assert.equal(
    policySection,
    '[policy]\n' +
      'static=Manual, Node A, DIRECT\n\n' +
      'available=Available, Manual, Node B\n\n' +
      'url-latency-benchmark=Fast, Available, DIRECT, check-interval=600, tolerance=50\n',
  );
  assert.deepEqual(generated.warnings, []);

  const imported = await withNodeRuntime({}, async ({ routes }) => {
    const response = createResponse();
    await routes.get('POST /api/extensions/config-generator/import/qx')(
      { body: { content: `${policySection}[filter_local]\nfinal, Fast\n` } },
      response,
    );
    const result = response.result();
    assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    return result.payload.data;
  });
  assert.deepEqual(
    imported.project.groups.map(({ name, type, members }) => ({
      name,
      type,
      members,
    })),
    project.groups.map(({ name, type, members }) => ({ name, type, members })),
  );

  const roundTrip = await previewConfig(
    'qx',
    { ...imported.project, name: 'qx-policy-round-trip' },
    imported.ruleSets,
  );
  assert.match(
    roundTrip.body,
    /static=Manual, Node A, DIRECT\n\navailable=Available, Manual, Node B\n\nurl-latency-benchmark=Fast, Available, DIRECT, check-interval=600, tolerance=50/,
  );
});

test('imports the common editable policy model from all four client formats', async () => {
  const inputs = {
    surge:
      '[Proxy Group]\nMain = select, DIRECT\n[Rule]\nFINAL, Main\n',
    qx: '[policy]\nstatic=Main, DIRECT\n[filter_local]\nfinal, Main\n',
    clash:
      'proxy-groups:\n  - name: Main\n    type: select\n    proxies:\n      - DIRECT\nrules:\n  - MATCH,Main\n',
    loon:
      '[Proxy Group]\nMain = select, DIRECT\n[Rule]\nFINAL, Main\n',
  };

  await withNodeRuntime({}, async ({ routes }) => {
    for (const [target, content] of Object.entries(inputs)) {
      const response = createResponse();
      await routes.get(`POST /api/extensions/config-generator/import/${target}`)(
        { body: { content } },
        response,
      );
      const result = response.result();
      assert.equal(result.statusCode, 200, `${target}: ${JSON.stringify(result.payload)}`);
      assert.equal(result.payload.status, 'success');
      assert.deepEqual(
        result.payload.data.project.groups[0],
        {
          name: 'Main',
          type: 'select',
          members: [{ kind: 'builtin', value: 'DIRECT' }],
        },
        target,
      );
      assert.deepEqual(
        Object.keys(result.payload.data.project.outputs),
        ['surge', 'qx', 'clash', 'loon'],
        target,
      );
    }
  });
});

test('preserves readable group spacing and documented Surge/QX policy fallbacks', async () => {
  const qx = await previewConfig('qx', {
    name: 'qx-load-balance-fallback',
    remoteProxySources: [],
    groups: [
      {
        name: 'One',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      },
      {
        name: 'Two',
        type: 'select',
        members: [{ kind: 'group', value: 'One' }],
      },
      {
        name: 'Balanced',
        type: 'load-balance',
        members: [
          { kind: 'proxy', value: 'Node A' },
          { kind: 'proxy', value: 'Node B' },
        ],
      },
    ],
    rules: [{ kind: 'final', policy: 'Balanced' }],
    outputs: { qx: { independentConfig: '' } },
  });
  assert.match(qx.body, /static=One, DIRECT\n\nstatic=Two, One/);
  assert.match(qx.body, /round-robin=Balanced, Node A, Node B/);
  assert.ok(
    qx.warnings.some(warning =>
      warning.message.includes(
        'Surge load-balance was approximated as Quantumult X round-robin',
      ),
    ),
  );

  const surge = await previewConfig('surge', {
    name: 'surge-qx-policy-fallbacks',
    remoteProxySources: [],
    groups: [
      {
        name: 'Rotate',
        type: 'round-robin',
        members: [{ kind: 'proxy', value: 'Node A' }],
      },
      {
        name: 'Sticky',
        type: 'dest-hash',
        members: [{ kind: 'proxy', value: 'Node B' }],
      },
      {
        name: 'Main',
        type: 'select',
        members: [
          { kind: 'group', value: 'Rotate' },
          { kind: 'group', value: 'Sticky' },
        ],
      },
    ],
    rules: [{ kind: 'final', policy: 'Main' }],
    outputs: { surge: {} },
  });
  assert.match(surge.body, /Rotate = load-balance, Node A, persistent=0/);
  assert.match(surge.body, /Sticky = load-balance, Node B, persistent=1/);
  assert.match(
    surge.body,
    /Rotate = load-balance, Node A, persistent=0\n\nSticky = load-balance/,
  );
  assert.ok(
    surge.warnings.some(warning =>
      warning.message.includes(
        'Quantumult X round-robin was approximated as Surge load-balance',
      ),
    ),
  );
  assert.ok(
    surge.warnings.some(warning =>
      warning.message.includes(
        'Quantumult X dest-hash was approximated as Surge load-balance',
      ),
    ),
  );
});

test('routes automatic URL sources through the injected Node Host producer', async () => {
  let producerInput;
  const initialStore = {
    version: 1,
    projects: [
      {
        name: 'automatic-source',
        remoteProxySources: [
          {
            name: 'Shared % Nodes',
            source: {
              kind: 'url',
              mode: 'auto',
              url: 'https://origin.example.com/subscription',
              publicBaseUrl: 'https://sub.example.com',
            },
          },
        ],
        groups: [],
        rules: [],
        outputs: { qx: {} },
      },
    ],
    ruleSets: [],
  };

  await withNodeRuntime(
    {
      initialStore,
      produceBuiltinArtifact: async input => {
        producerInput = input;
        return 'converted proxy output';
      },
    },
    async ({ routes }) => {
      const handler = routes.get(
        'GET /download/config-project/:name/proxy-source/:source/:target',
      );
      const response = createResponse();
      await handler(
        {
          params: {
            name: 'automatic-source',
            source: 'Shared % Nodes',
            target: 'QX',
          },
        },
        response,
      );
      assert.deepEqual(response.result(), {
        statusCode: 200,
        payload: 'converted proxy output',
      });
    },
  );

  assert.deepEqual(
    {
      type: producerInput.type,
      url: producerInput.url,
      platform: producerInput.platform,
      noFlow: producerInput.noFlow,
    },
    {
      type: 'subscription',
      url: 'https://origin.example.com/subscription',
      platform: 'QX',
      noFlow: true,
    },
  );
  assert.deepEqual(
    {
      name: producerInput.subscription.name,
      displayName: producerInput.subscription.displayName,
      source: producerInput.subscription.source,
      url: producerInput.subscription.url,
    },
    {
      name: 'config-project:automatic-source:Shared % Nodes',
      displayName: 'Shared % Nodes',
      source: 'remote',
      url: 'https://origin.example.com/subscription',
    },
  );
});

test('filters automatic Clash sources on the server for unsupported provider regex syntax', async () => {
  let producerInput;
  const initialStore = {
    version: 1,
    projects: [
      {
        name: 'server-filtered-source',
        remoteProxySources: [
          {
            name: 'Shared Nodes',
            source: {
              kind: 'url',
              mode: 'auto',
              url: 'https://origin.example.com/subscription',
              publicBaseUrl: 'https://sub.example.com',
            },
          },
        ],
        groups: [
          {
            name: 'Nodes',
            type: 'select',
            members: [],
            remoteProxySource: 'Shared Nodes',
          },
          {
            name: 'Other',
            type: 'fallback',
            members: [],
            includeOtherGroups: ['Nodes'],
            nodeNameRegex: '^((?!JP|Japan|日本).)*$',
          },
          {
            name: 'Unrelated',
            type: 'select',
            members: [{ kind: 'builtin', value: 'DIRECT' }],
            nodeNameRegex: 'US|United States|美国',
          },
        ],
        rules: [{ kind: 'final', policy: 'Other' }],
        outputs: { clash: {} },
      },
    ],
    ruleSets: [],
  };

  await withNodeRuntime(
    {
      initialStore,
      produceBuiltinArtifact: async input => {
        producerInput = input;
        return 'filtered Clash proxy output';
      },
    },
    async ({ routes }) => {
      const handler = routes.get(
        'GET /download/config-project/:name/proxy-source/:source/:target',
      );
      const response = createResponse();
      await handler(
        {
          params: {
            name: 'server-filtered-source',
            source: 'Shared Nodes',
            target: 'Clash',
          },
          query: { group: 'Other' },
        },
        response,
      );
      assert.deepEqual(response.result(), {
        statusCode: 200,
        payload: 'filtered Clash proxy output',
      });

      const rejected = createResponse();
      await handler(
        {
          params: {
            name: 'server-filtered-source',
            source: 'Shared Nodes',
            target: 'Clash',
          },
          query: { group: 'Nodes' },
        },
        rejected,
      );
      assert.equal(rejected.result().statusCode, 400);
      assert.equal(
        rejected.result().payload.error.code,
        'REMOTE_PROXY_SOURCE_FILTER_GROUP_REGEX_MISSING',
      );

      const mismatched = createResponse();
      await handler(
        {
          params: {
            name: 'server-filtered-source',
            source: 'Shared Nodes',
            target: 'Clash',
          },
          query: { group: 'Unrelated' },
        },
        mismatched,
      );
      assert.equal(mismatched.result().statusCode, 400);
      assert.equal(
        mismatched.result().payload.error.code,
        'REMOTE_PROXY_SOURCE_FILTER_GROUP_MISMATCH',
      );
    },
  );

  assert.deepEqual(producerInput.subscription.process, [
    {
      type: 'Regex Filter',
      args: {
        regex: ['^((?!JP|Japan|日本).)*$'],
        keep: true,
      },
    },
  ]);
});

test('still rejects real policy cycles instead of applying compatibility fallbacks', async () => {
  await withNodeRuntime({}, async ({ routes }) => {
    const response = createResponse();
    await routes.get('POST /api/extensions/config-generator/preview/qx')(
      {
        body: {
          project: {
            name: 'mixed-group-cycle',
            remoteProxySources: [],
            groups: [
              {
                name: 'One',
                type: 'select',
                members: [{ kind: 'group', value: 'Two' }],
              },
              {
                name: 'Two',
                type: 'select',
                members: [],
                includeOtherGroups: ['One'],
              },
            ],
            rules: [],
            outputs: { qx: {} },
          },
          ruleSets: [],
        },
      },
      response,
    );
    const result = response.result();
    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.status, 'failed');
    assert.equal(result.payload.error.code, 'CONFIG_GENERATOR_VALIDATION_FAILED');
    assert.ok(
      result.payload.error.details.some(issue =>
        issue.message.includes('group references must be acyclic'),
      ),
    );
  });
});
