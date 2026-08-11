import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import { importConfig, parseYaml, preview } from './helpers/backend-runtime.mjs';

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const sourceRoot = path.resolve(testDirectory, '../backend/src');
const coreBuild = await build({
  entryPoints: [path.join(testDirectory, 'fixtures/core-regression-entry.js')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  plugins: [{
    name: 'test-source-alias',
    setup(esbuild) {
      esbuild.onResolve({ filter: /^@\// }, args => {
        const base = path.join(sourceRoot, args.path.slice(2));
        const resolved = [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]
          .find(candidate => existsSync(candidate));
        return resolved ? { path: resolved } : null;
      });
    },
  }],
});
const core = await import(
  `data:text/javascript;base64,${Buffer.from(coreBuild.outputFiles[0].contents).toString('base64')}`
);

function projectFor(target, overrides = {}) {
  return {
    name: `${target}-regression`,
    remoteProxySources: [],
    groups: [],
    rules: [],
    outputs: { [target]: target === 'qx' ? { independentConfig: '' } : {} },
    ...overrides,
  };
}

test('parses and replaces managed sections while preserving preamble and unmanaged sections', () => {
  const ast = core.parseProfileSections(
    '\uFEFF; preamble\r\n[General]\r\nfoo=bar\r\n[Rule]\r\nold\r\n',
  );
  const output = core.serializeProfileSections(
    core.replaceManagedSections(ast, {
      'proxy group': ['Main = select, DIRECT'],
      rule: ['FINAL, DIRECT'],
    }),
  );
  assert.equal(
    output,
    '\uFEFF; preamble\r\n[General]\r\nfoo=bar\r\n[Proxy Group]\r\nMain = select, DIRECT\r\n[Rule]\r\nFINAL, DIRECT\r\n',
  );
});

test('quotes and round-trips Surge CSV values', () => {
  const line = core.serializeSurgeCsv(['PROCESS-NAME', 'My App, (beta)', 'Main']);
  assert.equal(line, 'PROCESS-NAME, "My App, (beta)", Main');
  assert.deepEqual(core.parseSurgeCsv(line), ['PROCESS-NAME', 'My App, (beta)', 'Main']);
});

test('keeps Surge-only PROCESS-NAME rules in independent config without annotating inline rules', async () => {
  const result = await preview('surge', projectFor('surge', {
    name: 'surge-process-name',
    groups: [{ name: 'YouTube', type: 'select', members: [] }],
    rules: [
      { kind: 'inline', type: 'DOMAIN', value: 'youtube.com', policy: 'YouTube' },
      { kind: 'inline', type: 'PROCESS-NAME', value: 'YouTube', policy: 'YouTube' },
      { kind: 'inline', type: 'DOMAIN', value: 'ads.example.com', policy: 'REJECT' },
    ],
    outputs: {
      surge: {
        independentConfig: '[General]\n\n[Rule]\nPROCESS-NAME, Legacy, YouTube\n\n[MITM]\n',
      },
    },
  }));
  const rules = result.body.slice(result.body.indexOf('[Rule]'));
  assert.match(rules, /PROCESS-NAME, Legacy, YouTube/);
  assert.ok(rules.indexOf('PROCESS-NAME, YouTube, YouTube') < rules.indexOf('DOMAIN, youtube.com, YouTube'));
  assert.match(rules, /DOMAIN, youtube\.com, YouTube\nDOMAIN, ads\.example\.com, REJECT/);
  assert.equal(rules.includes('# ==================== YouTube ===================='), false);
});

test('preserves Surge comment and blank rules while ending RULE-SET blocks', async () => {
  const result = await preview(
    'surge',
    projectFor('surge', {
      name: 'surge-rule-comments',
      groups: [{ name: 'Proxy', type: 'select', members: [] }],
      rules: [
        { kind: 'remote', ruleSet: 'first', policy: 'Proxy' },
        { kind: 'comment', text: 'manual divider' },
        { kind: 'remote', ruleSet: 'second', policy: 'Proxy' },
        { kind: 'blank' },
        { kind: 'inline', type: 'DOMAIN', value: 'after.example', policy: 'DIRECT' },
        { kind: 'blank' },
        { kind: 'final', policy: 'Proxy' },
      ],
    }),
    [
      { name: 'first', source: { kind: 'url', url: 'https://example.com/first.list', target: 'surge' } },
      { name: 'second', source: { kind: 'url', url: 'https://example.com/second.list', target: 'surge' } },
    ],
  );
  const rules = result.body.slice(result.body.indexOf('[Rule]'));
  const heading = '# ==================== Proxy ====================';
  assert.equal(rules.split(heading).length, 3);
  assert.match(
    rules,
    /RULE-SET, https:\/\/example\.com\/first\.list, Proxy\n\n# manual divider\n# ==================== Proxy ====================\nRULE-SET, https:\/\/example\.com\/second\.list, Proxy\n\nDOMAIN, after\.example, DIRECT\n\nFINAL, Proxy/,
  );
});

test('does not choose a Quantumult X remote-source interval by group order', async () => {
  const project = projectFor('qx', {
    name: 'qx-source-intervals',
    remoteProxySources: [{
      name: 'nodes',
      source: {
        kind: 'sub-store',
        type: 'collection',
        name: 'all',
        publicBaseUrl: 'https://sub.example.com',
      },
    }],
    groups: [
      {
        name: 'First',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
        remoteProxySource: 'nodes',
        policyUpdateInterval: 7200,
      },
      {
        name: 'Second',
        type: 'select',
        members: [{ kind: 'builtin', value: 'REJECT' }],
        remoteProxySource: 'nodes',
        policyUpdateInterval: 3600,
      },
    ],
    rules: [{ kind: 'final', policy: 'First' }],
  });
  const inferred = await preview('qx', project);
  assert.match(inferred.body, /tag=nodes, update-interval=3600/);
  assert.ok(inferred.warnings.some(warning =>
    warning.path === 'remoteProxySources.nodes.targetOptions.qx.updateInterval'
      && warning.message.includes('smallest value 3600 was used')));

  project.remoteProxySources[0].targetOptions = { qx: { updateInterval: 1800 } };
  const explicit = await preview('qx', project);
  assert.match(explicit.body, /tag=nodes, update-interval=1800/);
  assert.equal(explicit.warnings.some(warning =>
    warning.path === 'remoteProxySources.nodes.targetOptions.qx.updateInterval'), false);
});

test('uses the shared rule name for Quantumult X resources while Surge ignores it', async () => {
  const project = {
    name: 'named-remote-rule',
    remoteProxySources: [],
    groups: [],
    rules: [{ kind: 'remote', name: 'Advertising', ruleSet: 'internal-id', policy: 'REJECT' }],
    outputs: { surge: {}, qx: {} },
  };
  const ruleSets = [{
    name: 'internal-id',
    source: { kind: 'url', url: 'https://rules.example.com/ads.list' },
  }];
  const qx = await preview('qx', project, ruleSets);
  const surge = await preview('surge', project, ruleSets);
  assert.match(qx.body, /tag=Advertising, force-policy=reject/);
  assert.equal(qx.body.includes('tag=internal-id'), false);
  assert.match(surge.body, /RULE-SET, https:\/\/rules\.example\.com\/ads\.list, REJECT/);
  assert.equal(surge.body.includes('Advertising'), false);
});

test('approximates includeOtherGroups as deduplicated nested Quantumult X policy members', async () => {
  const result = await preview('qx', projectFor('qx', {
    name: 'qx-include-groups',
    remoteProxySources: [{
      name: 'nodes',
      source: {
        kind: 'sub-store',
        type: 'collection',
        name: 'all',
        publicBaseUrl: 'https://sub.example.com',
      },
    }],
    groups: [
      { name: 'Child', type: 'select', members: [{ kind: 'proxy', value: 'Node A' }] },
      {
        name: 'Main',
        type: 'select',
        members: [
          { kind: 'group', value: 'Child' },
          { kind: 'builtin', value: 'DIRECT' },
        ],
        includeOtherGroups: ['Child'],
        remoteProxySource: 'nodes',
      },
    ],
    rules: [{ kind: 'final', policy: 'Main' }],
  }));
  assert.match(result.body, /static=Main, Child, DIRECT, resource-tag-regex=\^nodes\$/);
  assert.equal(result.body.includes('static=Main, Child, DIRECT, Child'), false);
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Main.includeOtherGroups'
      && warning.message.includes('appended as nested policy members')));
});

test('omits includeOtherGroups from QX automatic groups and rejects an empty projection', async () => {
  const project = projectFor('qx', {
    name: 'qx-auto-include-groups',
    groups: [
      {
        name: 'Child',
        type: 'select',
        members: [{ kind: 'proxy', value: 'Node A' }],
        disabled: true,
      },
      {
        name: 'Auto',
        type: 'url-test',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
        includeOtherGroups: ['Child'],
      },
    ],
    rules: [{ kind: 'final', policy: 'Auto' }],
  });
  const generated = await preview('qx', project);
  assert.match(generated.body, /url-latency-benchmark=Auto, DIRECT/);
  assert.equal(generated.body.includes('DIRECT, Child'), false);
  assert.ok(generated.warnings.some(warning =>
    warning.path === 'groups.Auto.includeOtherGroups'
      && warning.message.includes('includeOtherGroups was omitted')));

  project.groups[1].members = [];
  const rejected = await preview('qx', project, [], { allowError: true });
  assert.equal(rejected.statusCode, 400);
  assert.deepEqual(rejected.payload.error.details.find(issue =>
    issue.path === 'groups.Auto.members'), {
    path: 'groups.Auto.members',
    message: 'Quantumult X url-latency-benchmark has no usable policy members after target projection',
  });
});

test('round-trips Quantumult X native policy groups, alive-checking, and shared icons', async () => {
  const imported = await importConfig(
    'qx',
    '[policy]\n'
      + 'round-robin=Round, Node A, Node B, img-url=https://example.com/round.png\n'
      + 'dest-hash=Hash, Round, Node C\n'
      + 'ssid=Network, DIRECT, LINK_22E171:Round\n'
      + 'url-latency-benchmark=Fast, Hash, DIRECT, check-interval=600, tolerance=50, alive-checking=true\n'
      + '[filter_local]\nfinal, Fast\n',
  );
  assert.deepEqual(imported.project.groups.map(group => group.type), [
    'round-robin',
    'dest-hash',
    'ssid',
    'url-test',
  ]);
  assert.equal(imported.project.groups[0].iconUrl, 'https://example.com/round.png');
  assert.deepEqual(imported.project.groups[2].members[1], {
    kind: 'conditional',
    value: 'LINK_22E171:Round',
    policy: 'Round',
  });
  assert.equal(imported.project.groups[3].targetOptions.qx.aliveChecking, true);

  const generated = await preview('qx', {
    ...imported.project,
    name: 'qx-native-round-trip',
  }, imported.ruleSets);
  assert.match(generated.body, /round-robin=Round, Node A, Node B, img-url=https:\/\/example\.com\/round\.png/);
  assert.match(generated.body, /ssid=Network, DIRECT, LINK_22E171:Round/);
  assert.match(generated.body, /tolerance=50, alive-checking=true/);
  assert.deepEqual(generated.warnings, []);
});

test('round-trips Quantumult X tolerance zero and disabled remote auto sync', async () => {
  const imported = await importConfig(
    'qx',
    '[server_remote]\n'
      + 'https://example.com/sample.conf, tag=Sample-01, update-interval=-1\n'
      + '[policy]\n'
      + 'url-latency-benchmark=Benchmark, resource-tag-regex=^Sample-01$, check-interval=600, alive-checking=false, tolerance=0\n'
      + '[filter_local]\nfinal, Benchmark\n',
  );
  assert.equal(imported.project.remoteProxySources[0].targetOptions.qx.updateInterval, -1);
  assert.equal(imported.project.groups[0].tolerance, 0);
  const generated = await preview('qx', {
    ...imported.project,
    name: 'qx-numeric-boundaries',
  }, imported.ruleSets);
  assert.match(generated.body, /tag=Sample-01, update-interval=-1/);
  assert.match(generated.body, /tolerance=0, alive-checking=false/);
});

test('validates policy groups referenced by QX ssid conditions', async () => {
  const imported = await importConfig(
    'qx',
    '[policy]\nstatic=Round, DIRECT\nssid=Network, DIRECT, LINK_22E171:Round\n'
      + '[filter_local]\nfinal, Network\n',
  );
  imported.project.name = 'qx-ssid-reference';
  imported.project.groups.find(group => group.name === 'Round').disabled = true;
  const result = await preview('qx', imported.project, imported.ruleSets, { allowError: true });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.payload.error.details.find(issue =>
    issue.path === 'groups[1].members[1].policy'), {
    path: 'groups[1].members[1].policy',
    message: 'references policy group Round, which is disabled for Quantumult X',
  });
});

test('keeps QX remote sources required by an unbound resource tag regex', async () => {
  const imported = await importConfig(
    'qx',
    '[server_remote]\nhttps://example.com/hk.conf, tag=HK\nhttps://example.com/tw.conf, tag=TW\n'
      + '[policy]\nstatic=Proxy, DIRECT, resource-tag-regex=^(HK|TW)$\n'
      + '[filter_local]\nfinal, Proxy\n',
  );
  const generated = await preview('qx', {
    ...imported.project,
    name: 'qx-unbound-resource-regex',
  }, imported.ruleSets);
  assert.match(generated.body, /https:\/\/example\.com\/hk\.conf, tag=HK/);
  assert.match(generated.body, /https:\/\/example\.com\/tw\.conf, tag=TW/);
  assert.match(generated.body, /resource-tag-regex=\^\(HK\|TW\)\$/);
});

test('maps include-all proxies through QX server tag regex without producing an empty group', async () => {
  const result = await preview('qx', projectFor('qx', {
    name: 'qx-include-all',
    remoteProxySources: [{
      name: 'all-nodes',
      source: {
        kind: 'sub-store',
        type: 'collection',
        name: 'all',
        publicBaseUrl: 'https://sub.example.com',
      },
    }],
    groups: [{
      name: 'Proxy',
      type: 'select',
      members: [],
      includeAllProxies: true,
      remoteProxySource: 'all-nodes',
    }],
    rules: [{ kind: 'final', policy: 'Proxy' }],
  }));
  assert.match(result.body, /tag=all-nodes/);
  assert.match(result.body, /static=Proxy, resource-tag-regex=\^all-nodes\$/);
});

test('rebinds escaped exact QX resource tags to a neutral Sub-Store source', async () => {
  const imported = await importConfig(
    'qx',
    '[server_remote]\nhttps://sub.example.com/download/collection/all/QX, tag=HK.Nodes\n'
      + '[policy]\nstatic=Proxy, resource-tag-regex=^HK\\.Nodes$\n'
      + '[filter_local]\nfinal, Proxy\n',
    {
      remoteProxySources: [{
        name: 'native',
        source: {
          kind: 'sub-store',
          type: 'collection',
          name: 'all',
          publicBaseUrl: 'https://sub.example.com',
        },
      }],
    },
  );
  assert.equal(imported.project.groups[0].remoteProxySource, 'HK.Nodes');
  const generated = await preview('surge', {
    ...imported.project,
    name: 'escaped-qx-tag',
  }, imported.ruleSets);
  assert.match(generated.body, /policy-path=https:\/\/sub\.example\.com\/download\/collection\/all\/Surge/);
});

test('rejects a required raw QX resource regex group when Surge has no candidates', async () => {
  const imported = await importConfig(
    'qx',
    '[server_remote]\nhttps://example.com/hk.conf, tag=HK\nhttps://example.com/tw.conf, tag=TW\n'
      + '[policy]\nstatic=Proxy, DIRECT, resource-tag-regex=^(HK|TW)$\n'
      + '[filter_local]\nfinal, Proxy\n',
  );
  const result = await preview('surge', {
    ...imported.project,
    name: 'qx-regex-no-surge-candidates',
  }, imported.ruleSets, { allowError: true });
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.payload.error.details.find(issue =>
    issue.path === 'groups[0].targetOptions.qx.resourceTagRegex'), {
    path: 'groups[0].targetOptions.qx.resourceTagRegex',
    message: 'uses a Quantumult X resource-tag-regex that cannot be represented by Surge; bind a Surge-compatible remote proxy source or remove the raw expression',
  });
});

test('warns when an unused raw QX resource regex is omitted from Surge', async () => {
  const imported = await importConfig(
    'qx',
    '[policy]\nstatic=Proxy, DIRECT, resource-tag-regex=^(HK|TW)$\n'
      + '[filter_local]\nfinal, direct\n',
  );
  const generated = await preview('surge', {
    ...imported.project,
    name: 'unused-qx-regex',
  }, imported.ruleSets);
  assert.ok(generated.warnings.some(warning =>
    warning.path === 'groups.Proxy.targetOptions.qx.resourceTagRegex'
      && warning.message.includes('raw Quantumult X resource-tag-regex')));
});

test('omits a target-less URL shared by both legacy target bindings while retaining static members', async () => {
  const project = {
    name: 'ambiguous-legacy-url',
    remoteProxySources: [{
      name: 'legacy-nodes',
      source: { kind: 'url', url: 'https://example.com/shared.conf' },
    }],
    groups: [{
      name: 'Main',
      type: 'select',
      members: [{ kind: 'builtin', value: 'DIRECT' }],
      targetOptions: {
        surge: { remoteProxySource: 'legacy-nodes' },
        qx: { remoteProxySource: 'legacy-nodes' },
      },
    }],
    rules: [{ kind: 'final', policy: 'Main' }],
    outputs: { surge: {}, qx: {} },
  };
  for (const target of ['surge', 'qx']) {
    const generated = await preview(target, project);
    assert.match(generated.body, /DIRECT/);
    assert.equal(generated.body.includes('https://example.com/shared.conf'), false);
    assert.ok(generated.warnings.some(warning =>
      warning.message.includes('bound by both legacy Surge and Quantumult X fields')));
  }
});

test('does not pass a Clash-owned proxy URL to Quantumult X opt-parser', async () => {
  const result = await preview('qx', projectFor('qx', {
    name: 'qx-clash-owned-source',
    remoteProxySources: [{
      name: 'clash-nodes',
      source: { kind: 'url', url: 'https://example.com/clash.yaml', target: 'clash' },
    }],
    groups: [{
      name: 'Main',
      type: 'select',
      members: [{ kind: 'builtin', value: 'DIRECT' }],
      remoteProxySource: 'clash-nodes',
    }],
    rules: [{ kind: 'final', policy: 'Main' }],
  }));
  assert.equal(result.body.includes('https://example.com/clash.yaml'), false);
  assert.equal(result.body.includes('opt-parser=true'), false);
  assert.match(result.body, /static=Main, DIRECT/);
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Main.remoteProxySource'
      && warning.message.includes('only bound to Clash')));
});

test('keeps a truly unclassified shared URL as an explicit Quantumult X parser fallback', async () => {
  const result = await preview('qx', projectFor('qx', {
    name: 'qx-unclassified-source',
    remoteProxySources: [{
      name: 'unknown-nodes',
      source: { kind: 'url', url: 'https://example.com/nodes.conf' },
    }],
    groups: [{
      name: 'Main',
      type: 'select',
      members: [{ kind: 'builtin', value: 'DIRECT' }],
      remoteProxySource: 'unknown-nodes',
    }],
    rules: [{ kind: 'final', policy: 'Main' }],
  }));
  assert.match(result.body, /https:\/\/example\.com\/nodes\.conf, tag=unknown-nodes, opt-parser=true/);
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Main.remoteProxySource'
      && warning.message.includes('unclassified HTTP(S) proxy source')));
});

test('imports target-owned proxy URLs into the shared group binding', async () => {
  const surge = await importConfig(
    'surge',
    '[Proxy Group]\nRemote = select, policy-path=https://example.com/surge.conf\n[Rule]\nFINAL, Remote\n',
  );
  assert.equal(surge.project.groups[0].remoteProxySource, 'remote-1');
  assert.deepEqual(surge.project.remoteProxySources[0].source, {
    kind: 'url',
    url: 'https://example.com/surge.conf',
    mode: 'passthrough',
    target: 'surge',
  });

  const qx = await importConfig(
    'qx',
    '[server_remote]\nhttps://example.com/qx.conf, tag=Remote\n'
      + '[policy]\nstatic=Proxy, resource-tag-regex=^Remote$\n'
      + '[filter_local]\nfinal, Proxy\n',
  );
  assert.equal(qx.project.groups[0].remoteProxySource, 'Remote');
  assert.deepEqual(qx.project.remoteProxySources[0].source, {
    kind: 'url',
    url: 'https://example.com/qx.conf',
    mode: 'passthrough',
    target: 'qx',
  });
});

test('emits only QX options supported by the selected policy type and warns for omitted shared rules', async () => {
  const result = await preview('qx', projectFor('qx', {
    name: 'qx-option-filtering',
    groups: [
      {
        name: 'Manual',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
        interval: 300,
        tolerance: 25,
        targetOptions: { qx: { aliveChecking: true } },
      },
      {
        name: 'Fast',
        type: 'url-test',
        members: [{ kind: 'group', value: 'Manual' }],
        interval: 600,
        tolerance: 50,
        targetOptions: { qx: { aliveChecking: false } },
      },
    ],
    rules: [
      { kind: 'inline', type: 'PROCESS-NAME', value: 'Example', policy: 'Manual' },
      { kind: 'final', policy: 'Fast' },
    ],
  }));
  assert.match(result.body, /static=Manual, DIRECT/);
  assert.equal(/static=Manual[^\n]*(check-interval|tolerance|alive-checking)/.test(result.body), false);
  assert.match(result.body, /url-latency-benchmark=Fast, Manual, check-interval=600, tolerance=50, alive-checking=false/);
  assert.equal(result.body.includes('process-name'), false);
  assert.ok(result.warnings.some(warning => warning.path === 'rules.PROCESS-NAME'));
});

test('round-trips the Quantumult X FILTER_LAN inserted resource fallback', async () => {
  const generated = await preview(
    'qx',
    projectFor('qx', {
      name: 'qx-filter-lan',
      rules: [
        { kind: 'remote', ruleSet: 'lan', policy: 'DIRECT' },
        { kind: 'final', policy: 'DIRECT' },
      ],
    }),
    [{ name: 'lan', source: { kind: 'builtin', value: 'LAN' } }],
  );
  assert.match(generated.body, /FILTER_LAN, tag=lan, force-policy=direct/);
  const imported = await importConfig('qx', generated.body);
  assert.deepEqual(imported.ruleSets[0].source, { kind: 'builtin', value: 'LAN' });
  assert.equal(imported.project.rules[0].ruleSet, imported.ruleSets[0].name);
});

test('does not provider-rewrite a blackmatrix7 URL whose ref is named rule and uses the QX parser fallback', () => {
  const resolution = core.resolveRuleSetUrl({
    name: 'branch-named-rule',
    source: {
      kind: 'url',
      url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/rule/custom/Advertising.list',
      target: 'surge',
    },
  }, 'qx');
  assert.equal(
    resolution.url,
    'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/rule/custom/Advertising.list',
  );
  assert.equal(resolution.provider, undefined);
  assert.equal(resolution.forceOptParser, true);
});

test('projects process paths and RULE-SET no-resolve with documented Clash syntax', async () => {
  const result = await preview(
    'clash',
    projectFor('clash', {
      name: 'clash-documented-rules',
      groups: [
        {
          name: 'Main',
          type: 'select',
          members: [{ kind: 'builtin', value: 'DIRECT' }],
        },
      ],
      rules: [
        {
          kind: 'inline',
          type: 'PROCESS-NAME',
          value: '/Applications/TestFlight.app/Contents/MacOS/TestFlight',
          policy: 'Main',
        },
        {
          kind: 'inline',
          type: 'PROCESS-NAME',
          value: String.raw`C:\Program Files\Example\example.exe`,
          policy: 'Main',
        },
        {
          kind: 'inline',
          type: 'PROCESS-NAME',
          value: 'nc',
          policy: 'Main',
        },
        {
          kind: 'remote',
          name: 'Documented',
          ruleSet: 'documented-provider',
          policy: 'Main',
          noResolve: true,
        },
        { kind: 'final', policy: 'Main' },
      ],
    }),
    [
      {
        name: 'documented-provider',
        source: {
          kind: 'url',
          url: 'https://example.com/documented.yaml',
          target: 'clash',
        },
      },
    ],
  );
  const clash = parseYaml(result.body);

  assert.ok(clash.rules.includes(
    'PROCESS-PATH,/Applications/TestFlight.app/Contents/MacOS/TestFlight,Main',
  ));
  assert.ok(clash.rules.includes(
    String.raw`PROCESS-PATH,C:\Program Files\Example\example.exe,Main`,
  ));
  assert.ok(clash.rules.includes('PROCESS-NAME,nc,Main'));
  assert.ok(clash.rules.includes('RULE-SET,Documented,Main,no-resolve'));
  assert.equal(
    result.warnings.some(warning =>
      warning.message.includes('RULE-SET rules do not support')
    ),
    false,
  );
});

test('converts documented Clash rules from a cached Surge rule-list fallback', async () => {
  const result = await preview(
    'clash',
    projectFor('clash', {
      name: 'clash-surge-list-projection',
      groups: [
        {
          name: 'Main',
          type: 'select',
          members: [{ kind: 'builtin', value: 'DIRECT' }],
        },
      ],
      rules: [
        { kind: 'remote', ruleSet: 'custom-surge-list', policy: 'Main' },
        { kind: 'final', policy: 'Main' },
      ],
    }),
    [
      {
        name: 'custom-surge-list',
        source: {
          kind: 'url',
          url: 'https://example.com/custom.list',
          target: 'surge',
        },
      },
    ],
    {
      networkGet: async () => ({
        statusCode: 200,
        body: [
          'SRC-IP-CIDR,192.168.1.0/24',
          'DST-PORT,443',
          'SRC-PORT,12345',
          'PROCESS-NAME,/bin/sh',
        ].join('\n'),
      }),
    },
  );
  const clash = parseYaml(result.body);

  assert.ok(clash.rules.includes('SRC-IP-CIDR,192.168.1.0/24,Main'));
  assert.ok(clash.rules.includes('DST-PORT,443,Main'));
  assert.ok(clash.rules.includes('SRC-PORT,12345,Main'));
  assert.ok(clash.rules.includes('PROCESS-PATH,/bin/sh,Main'));
});

test('round-trips documented Clash PROCESS-PATH rules through the shared project', async () => {
  const imported = await importConfig(
    'clash',
    [
      'mode: rule',
      'proxy-groups:',
      '  - name: Main',
      '    type: select',
      '    proxies:',
      '      - DIRECT',
      'rules:',
      '  - PROCESS-PATH,/Applications/TestFlight.app/Contents/MacOS/TestFlight,Main',
      '  - MATCH,Main',
    ].join('\n'),
  );
  imported.project.name = 'clash-process-path-round-trip';

  assert.deepEqual(imported.project.rules[0], {
    kind: 'inline',
    type: 'PROCESS-NAME',
    value: '/Applications/TestFlight.app/Contents/MacOS/TestFlight',
    policy: 'Main',
  });

  const generated = parseYaml((await preview(
    'clash',
    imported.project,
    imported.ruleSets,
  )).body);
  assert.ok(generated.rules.includes(
    'PROCESS-PATH,/Applications/TestFlight.app/Contents/MacOS/TestFlight,Main',
  ));
});

test('flattens provider-only included groups while combining direct and inherited Clash sources', async () => {
  const result = await preview('clash', projectFor('clash', {
    name: 'clash-provider-group-flattening',
    remoteProxySources: [
      {
        name: 'Inherited Nodes',
        source: {
          kind: 'url',
          url: 'https://example.com/inherited.yaml',
          mode: 'passthrough',
          target: 'clash',
        },
      },
      {
        name: 'Direct Nodes',
        source: {
          kind: 'url',
          url: 'https://example.com/direct.yaml',
          mode: 'passthrough',
          target: 'clash',
        },
      },
    ],
    groups: [
      {
        name: 'Nodes',
        type: 'select',
        members: [],
        remoteProxySource: 'Inherited Nodes',
      },
      {
        name: 'Japan',
        type: 'fallback',
        members: [],
        includeOtherGroups: ['Nodes'],
        nodeNameRegex: 'JP|Japan|日本',
      },
      {
        name: 'Mixed',
        type: 'select',
        members: [],
        includeOtherGroups: ['Nodes'],
        remoteProxySource: 'Direct Nodes',
        nodeNameRegex: 'JP|Japan|日本',
      },
      {
        name: 'Other',
        type: 'fallback',
        members: [],
        includeOtherGroups: ['Nodes'],
        nodeNameRegex: '^((?!JP|Japan|日本).)*$',
      },
    ],
    rules: [{ kind: 'final', policy: 'Mixed' }],
  }));
  const clash = parseYaml(result.body);
  const group = name => clash['proxy-groups'].find(item => item.name === name);

  assert.equal(group('Japan').proxies?.includes('Nodes') || false, false);
  assert.equal(group('Japan').use.length, 1);
  assert.equal(group('Mixed').proxies?.includes('Nodes') || false, false);
  assert.equal(group('Mixed').use.length, 2);
  group('Japan').use.forEach(providerName => {
    assert.equal(
      clash['proxy-providers'][providerName].filter,
      'JP|Japan|日本',
    );
  });
  assert.equal(group('Other').use.length, 1);
  group('Other').use.forEach(providerName => {
    assert.equal(clash['proxy-providers'][providerName].filter, undefined);
  });
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Other.nodeNameRegex'
      && warning.message.includes('Go regular expression')
  ));
});
