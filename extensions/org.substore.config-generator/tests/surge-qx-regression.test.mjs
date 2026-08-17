import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { build } from 'esbuild';
import {
  importConfig,
  parseYaml,
  preview,
  requestRoute,
  withRuntime,
} from './helpers/backend-runtime.mjs';

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

function profileSectionNames(content) {
  return core.parseProfileSections(content).sections.map(section => section.title);
}

const COMPLETE_EMPTY_PROFILES = {
  surge: {
    target: 'Surge',
    legacyConfig: '[General]\n\n[Rule]\n\n[MITM]\n',
    sections: [
      '[General]',
      '[Proxy]',
      '[Proxy Group]',
      '[Rule]',
      '[Host]',
      '[MITM]',
    ],
  },
  qx: {
    target: 'QX',
    legacyConfig: '[general]\n\n[dns]\n\n[mitm]\n',
    sections: [
      '[general]',
      '[rewrite_local]',
      '[rewrite_remote]',
      '[dns]',
      '[policy]',
      '[server_local]',
      '[server_remote]',
      '[filter_local]',
      '[filter_remote]',
      '[mitm]',
    ],
  },
  loon: {
    target: 'Loon',
    legacyConfig: '[General]\n\n[Proxy]\n\n[Proxy Group]\n\n[Rule]\n',
    sections: [
      '[General]',
      '[Proxy]',
      '[Remote Proxy]',
      '[Remote Filter]',
      '[Proxy Group]',
      '[Rule]',
      '[Remote Rule]',
      '[Rewrite]',
      '[Remote Rewrite]',
      '[Host]',
      '[Script]',
      '[Remote Script]',
      '[Plugin]',
      '[MITM]',
    ],
  },
};

test('completes independent INI sections in defaults, previews, and downloads', async () => {
  for (const [target, expected] of Object.entries(COMPLETE_EMPTY_PROFILES)) {
    const defaultPreview = await preview(
      target,
      projectFor(target, {
        name: `${target}-default-empty-sections`,
        outputs: { [target]: {} },
      }),
    );
    assert.deepEqual(
      profileSectionNames(defaultPreview.body),
      expected.sections,
      `${target} backend default`,
    );

    const legacyPreview = await preview(
      target,
      projectFor(target, {
        name: `${target}-legacy-empty-sections`,
        outputs: {
          [target]: { independentConfig: expected.legacyConfig },
        },
      }),
    );
    assert.deepEqual(
      profileSectionNames(legacyPreview.body),
      expected.sections,
      `${target} legacy project`,
    );

    const independentConfig = `${expected.sections.join('\n\n')}\n`;
    const project = projectFor(target, {
      name: `${target}-empty-sections`,
      outputs: { [target]: { independentConfig } },
    });
    const generatedPreview = await preview(target, project);
    assert.deepEqual(
      profileSectionNames(generatedPreview.body),
      expected.sections,
      `${target} preview`,
    );

    await withRuntime({
      initialStore: {
        version: 1,
        projects: [project],
        ruleSets: [],
      },
    }, async ({ routes }) => {
      const downloaded = await requestRoute(
        routes,
        'GET',
        '/download/config-project/:name/:target',
        {
          params: {
            name: project.name,
            target: expected.target,
          },
        },
      );
      assert.equal(downloaded.statusCode, 200, target);
      assert.deepEqual(
        profileSectionNames(downloaded.payload),
        expected.sections,
        `${target} download`,
      );

      const downloadedByQuery = await requestRoute(
        routes,
        'GET',
        '/download/config-project/:name',
        {
          params: { name: project.name },
          query: { target: expected.target },
        },
      );
      assert.equal(downloadedByQuery.statusCode, 200, `${target} query download`);
      assert.deepEqual(
        profileSectionNames(downloadedByQuery.payload),
        expected.sections,
        `${target} query download`,
      );
    });
  }
});

test('completes independent Clash keys in previews and downloads', async () => {
  const project = projectFor('clash', {
    name: 'clash-complete-independent-config',
    outputs: {
      clash: { independentConfig: 'port: 7890\n' },
    },
  });
  const assertCompleteProfile = (content, label) => {
    const document = parseYaml(content);
    assert.equal(document.mode, 'rule', `${label} mode`);
    assert.equal(document.port, 7890, `${label} preserved setting`);
    assert.deepEqual(document.proxies, [], `${label} proxies`);
    assert.deepEqual(document['proxy-providers'], {}, `${label} proxy-providers`);
    assert.deepEqual(document['proxy-groups'], [], `${label} proxy-groups`);
    assert.deepEqual(document['rule-providers'], {}, `${label} rule-providers`);
    assert.deepEqual(document.rules, ['MATCH,DIRECT'], `${label} rules`);
  };

  const generatedPreview = await preview('clash', project);
  assertCompleteProfile(generatedPreview.body, 'preview');

  const overriddenMode = await preview('clash', projectFor('clash', {
    name: 'clash-preserved-mode',
    outputs: {
      clash: { independentConfig: 'mode: global\n' },
    },
  }));
  assert.equal(parseYaml(overriddenMode.body).mode, 'global');

  await withRuntime({
    initialStore: {
      version: 1,
      projects: [project],
      ruleSets: [],
    },
  }, async ({ routes }) => {
    const downloaded = await requestRoute(
      routes,
      'GET',
      '/download/config-project/:name/:target',
      {
        params: {
          name: project.name,
          target: 'Clash',
        },
      },
    );
    assert.equal(downloaded.statusCode, 200);
    assertCompleteProfile(downloaded.payload, 'download');

    const downloadedByQuery = await requestRoute(
      routes,
      'GET',
      '/download/config-project/:name',
      {
        params: { name: project.name },
        query: { target: 'Clash' },
      },
    );
    assert.equal(downloadedByQuery.statusCode, 200);
    assertCompleteProfile(downloadedByQuery.payload, 'query download');
  });
});

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

test('round-trips shared policy group icons through Mihomo-compatible Clash YAML', async () => {
  const generated = await preview('clash', projectFor('clash', {
    name: 'clash-group-icon',
    groups: [
      {
        name: 'Proxy',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
        iconUrl: 'https://example.com/proxy.png',
      },
    ],
    rules: [{ kind: 'final', policy: 'Proxy' }],
  }));
  const generatedDocument = parseYaml(generated.body);
  assert.equal(
    generatedDocument['proxy-groups'][0].icon,
    'https://example.com/proxy.png',
    generated.body,
  );
  assert.doesNotMatch(
    generated.warnings.map(item => item.message).join('\n'),
    /icon was omitted/i,
  );

  const imported = await importConfig('clash', generated.body);
  assert.equal(imported.project.groups[0].iconUrl, 'https://example.com/proxy.png');
});

test('warns only for enabled Surge-only boolean options in Clash and Loon projections', async () => {
  for (const target of ['clash', 'loon']) {
    const baseGroup = {
      name: 'Proxy',
      type: 'select',
      members: [{ kind: 'builtin', value: 'DIRECT' }],
    };
    const withoutOptions = await preview(target, projectFor(target, {
      name: `${target}-without-surge-options`,
      groups: [baseGroup],
      rules: [{ kind: 'final', policy: 'Proxy' }],
    }));
    const disabledOptions = await preview(target, projectFor(target, {
      name: `${target}-disabled-surge-options`,
      groups: [{
        ...baseGroup,
        targetOptions: {
          surge: {
            hidden: false,
            noAlert: false,
            evaluateBeforeUse: false,
            persistent: false,
          },
        },
      }],
      rules: [{ kind: 'final', policy: 'Proxy' }],
    }));

    assert.equal(disabledOptions.body, withoutOptions.body, target);
    assert.equal(
      disabledOptions.warnings.some(warning =>
        warning.path.includes('targetOptions.surge')),
      false,
      target,
    );

    const enabledOptions = await preview(target, projectFor(target, {
      name: `${target}-enabled-surge-options`,
      groups: [{
        ...baseGroup,
        targetOptions: {
          surge: {
            hidden: true,
            noAlert: true,
            evaluateBeforeUse: true,
            persistent: true,
          },
        },
      }],
      rules: [{ kind: 'final', policy: 'Proxy' }],
    }));
    assert.deepEqual(
      enabledOptions.warnings
        .filter(warning => warning.path.includes('targetOptions.surge'))
        .map(warning => warning.path.split('.').at(-1))
        .sort(),
      ['evaluateBeforeUse', 'hidden', 'noAlert', 'persistent'],
      target,
    );
  }
});

test('preserves disabled QX remote sync while degrading undocumented regex benchmarks', async () => {
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
  assert.match(generated.body, /available=Benchmark, resource-tag-regex=\^Sample-01\$/);
  assert.equal(/available=Benchmark[^\n]*(check-interval|tolerance|alive-checking)/.test(generated.body), false);
  assert.ok(generated.warnings.some(warning =>
    warning.path === 'groups.Benchmark.type'
      && warning.message.includes('only documents resource-tag-regex and server-tag-regex')));
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
  assert.match(generated.body, /FILTER_LAN, force-policy=direct/);
  assert.equal(generated.body.includes('tag=lan'), false);
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

test('maps Blackmatrix7 aggregate Surge filenames to existing Clash classical files', () => {
  const privacy = core.resolveRuleSetUrl({
    name: 'privacy',
    source: {
      kind: 'url',
      url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Privacy/Privacy_All.list',
      target: 'surge',
    },
  }, 'clash');
  assert.equal(
    privacy.url,
    'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Privacy/Privacy_Classical.yaml',
  );

  const noResolve = core.resolveRuleSetUrl({
    name: 'aggregate-no-resolve',
    source: {
      kind: 'url',
      url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Surge/Example/Example_All_No_Resolve.list',
      target: 'surge',
    },
  }, 'clash');
  assert.equal(
    noResolve.url,
    'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Clash/Example/Example_Classical_No_Resolve.yaml',
  );
});

test('serves cached Clash rule providers without undocumented rule types', async () => {
  await withRuntime({
    initialStore: {
      projects: [{
        name: 'cached-project',
        remoteProxySources: [],
        groups: [],
        rules: [],
        outputs: { clash: {} },
      }],
      ruleSets: [{
        name: 'cached-rules',
        source: {
          kind: 'url',
          url: 'https://example.com/rules.yaml',
          target: 'clash',
        },
      }],
    },
    networkGet: async ({ url }) => {
      assert.equal(url, 'https://example.com/rules.yaml');
      return {
        statusCode: 200,
        body: [
          'payload:',
          '  - DOMAIN-SUFFIX,example.com',
          '  - IP-CIDR,1.2.3.0/24,no-resolve',
          '  - IP-ASN,13335',
          '  - AND,((DOMAIN,example.com),(NETWORK,TCP))',
        ].join('\n'),
      };
    },
  }, async ({ routes }) => {
    const response = await requestRoute(
      routes,
      'GET',
      '/download/config-project/:name/rule-set/:ruleSet/:target',
      {
        params: {
          name: 'cached-project',
          ruleSet: 'cached-rules',
          target: 'Clash',
        },
      },
    );
    assert.equal(response.statusCode, 200);
    assert.deepEqual(parseYaml(response.payload).payload, [
      'DOMAIN-SUFFIX,example.com',
      'IP-CIDR,1.2.3.0/24,no-resolve',
    ]);
  });
});

test('routes Clash rule providers through a reachable Sub-Store cache URL', async () => {
  const result = await preview(
    'clash',
    projectFor('clash', {
      name: 'cached-provider-project',
      remoteProxySources: [{
        name: 'conversion-base',
        enabled: false,
        source: {
          kind: 'url',
          url: 'https://example.com/nodes.yaml',
          mode: 'auto',
          publicBaseUrl: 'http://127.0.0.1:3000',
        },
      }],
      groups: [{
        name: 'Main',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      }],
      rules: [
        { kind: 'remote', name: 'Cached', ruleSet: 'cached-rules', policy: 'Main' },
        { kind: 'final', policy: 'Main' },
      ],
    }),
    [{
      name: 'cached-rules',
      source: {
        kind: 'url',
        url: 'https://example.com/rules.yaml',
        target: 'clash',
      },
    }],
  );
  const clash = parseYaml(result.body);
  assert.equal(
    clash['rule-providers'].Cached.url,
    'http://127.0.0.1:3000/download/config-project/cached-provider-project/rule-set/cached-rules/Clash',
  );
  assert.equal(clash['rule-providers'].Cached.format, 'yaml');
  assert.ok(result.warnings.some(warning =>
    warning.path === 'outputs.clash.publicBaseUrl'
      && warning.message.includes('same host')));
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

test('warns when Clash cannot preserve Surge FINAL dns-failed semantics', async () => {
  const result = await preview(
    'clash',
    projectFor('clash', {
      name: 'clash-final-dns-failed',
      groups: [
        {
          name: 'Main',
          type: 'select',
          members: [{ kind: 'builtin', value: 'DIRECT' }],
        },
      ],
      rules: [{ kind: 'final', policy: 'Main', dnsFailed: true }],
    }),
  );
  const clash = parseYaml(result.body);

  assert.deepEqual(clash.rules, ['MATCH,Main']);
  assert.ok(result.warnings.some(warning =>
    warning.path === 'rules[0].dnsFailed'
      && warning.message.includes('no equivalent')));
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
          mode: 'auto',
          publicBaseUrl: 'https://sub.example.com',
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
    assert.equal(
      new URL(clash['proxy-providers'][providerName].url).searchParams.get('group'),
      null,
    );
  });
  assert.equal(group('Other').use.length, 1);
  group('Other').use.forEach(providerName => {
    assert.equal(clash['proxy-providers'][providerName].filter, undefined);
    assert.equal(
      new URL(clash['proxy-providers'][providerName].url).searchParams.get('group'),
      'Other',
    );
  });
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Other.nodeNameRegex'
      && warning.message.includes('Go regular expression')
  ));
});

test('flattens provider-only included groups into documented Loon node filters', async () => {
  const result = await preview('loon', projectFor('loon', {
    name: 'loon-remote-filter-flattening',
    remoteProxySources: [{
      name: 'Inherited Nodes',
      source: {
        kind: 'url',
        url: 'https://example.com/nodes.list',
        mode: 'passthrough',
        target: 'loon',
      },
    }],
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
        name: 'Other',
        type: 'fallback',
        members: [],
        includeOtherGroups: ['Nodes'],
        nodeNameRegex: '^((?!JP|Japan|日本).)*$',
      },
    ],
    rules: [{ kind: 'final', policy: 'Japan' }],
  }));
  const remoteFilters = result.body.slice(
    result.body.indexOf('[Remote Filter]'),
    result.body.indexOf('[Proxy Group]'),
  );
  const groups = result.body.slice(
    result.body.indexOf('[Proxy Group]'),
    result.body.indexOf('[Rule]'),
  );

  assert.match(
    remoteFilters,
    /NameRegex, Inherited Nodes, FilterKey = JP\|Japan\|日本/,
  );
  assert.match(
    remoteFilters,
    /NameRegex, Inherited Nodes, FilterKey = \^\(\(\?!JP\|Japan\|日本\)\.\)\*\$/,
  );
  assert.match(groups, /Japan = fallback, Inherited Nodes-Japan,/);
  assert.match(groups, /Other = fallback, Inherited Nodes-Other,/);
  assert.equal(/Japan = fallback, Nodes,/.test(groups), false);
  assert.equal(/Other = fallback, Nodes,/.test(groups), false);
  assert.equal(result.warnings.some(warning =>
    ['groups.Japan.includeOtherGroups', 'groups.Japan.nodeNameRegex',
      'groups.Other.includeOtherGroups', 'groups.Other.nodeNameRegex']
      .includes(warning.path)), false);
});

test('scopes inherited Quantumult X node filters to provider-only remote sources', async () => {
  const result = await preview('qx', projectFor('qx', {
    name: 'qx-remote-source-flattening',
    remoteProxySources: [{
      name: 'Inherited Nodes',
      source: {
        kind: 'url',
        url: 'https://example.com/nodes.conf',
        mode: 'passthrough',
        target: 'qx',
      },
    }],
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
        name: 'Auto',
        type: 'url-test',
        members: [],
        includeOtherGroups: ['Nodes'],
        nodeNameRegex: 'JP|Japan|日本',
      },
      {
        name: 'Hash',
        type: 'dest-hash',
        members: [],
        remoteProxySource: 'Inherited Nodes',
        nodeNameRegex: 'JP|Japan|日本',
      },
    ],
    rules: [{ kind: 'final', policy: 'Japan' }],
  }));

  assert.match(
    result.body,
    /available=Japan, resource-tag-regex=\^Inherited Nodes\$, server-tag-regex=JP\|Japan\|日本/,
  );
  assert.match(
    result.body,
    /available=Auto, resource-tag-regex=\^Inherited Nodes\$, server-tag-regex=JP\|Japan\|日本/,
  );
  assert.equal(/available=Japan, Nodes/.test(result.body), false);
  assert.match(
    result.body,
    /round-robin=Hash, resource-tag-regex=\^Inherited Nodes\$, server-tag-regex=JP\|Japan\|日本/,
  );
  assert.equal(/available=Auto, Nodes/.test(result.body), false);
  assert.equal(result.warnings.some(warning =>
    ['groups.Japan.includeOtherGroups', 'groups.Auto.includeOtherGroups']
      .includes(warning.path)), false);
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Auto.type'
      && warning.message.includes('fell back to available')));
  assert.ok(result.warnings.some(warning =>
    warning.path === 'groups.Hash.type'
      && warning.message.includes('fell back to round-robin')));
});

test('merges a complete independent Clash document and keeps one final MATCH', async () => {
  const result = await preview(
    'clash',
    projectFor('clash', {
      name: 'clash-complete-document-merge',
      embeddedSource: { type: 'collection', name: 'generated' },
      groups: [{
        name: 'Main',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      }],
      rules: [{
        kind: 'remote',
        name: 'GeneratedRules',
        ruleSet: 'generated-rules',
        policy: 'Main',
      }],
      outputs: {
        clash: {
          independentConfig: [
            'port: 7890',
            'dns:',
            '  enable: true',
            'tun:',
            '  enable: true',
            'proxies:',
            '  - name: Manual',
            '    type: http',
            '    server: manual.example.com',
            '    port: 443',
            '  - name: Collision',
            '    type: http',
            '    server: old.example.com',
            '    port: 80',
            'proxy-providers:',
            '  LocalNodes:',
            '    type: file',
            '    path: ./providers/local.yaml',
            'proxy-groups:',
            '  - name: Main',
            '    type: select',
            '    lazy: true',
            '    proxies:',
            '      - Manual',
            '  - name: Manual Group',
            '    type: select',
            '    proxies:',
            '      - Manual',
            'rule-providers:',
            '  ManualRules:',
            '    type: file',
            '    behavior: domain',
            '    path: ./rules/manual.yaml',
            'rules:',
            '  - SCRIPT,shortcuts.example,Main',
            '  - MATCH,DIRECT',
          ].join('\n'),
        },
      },
    }),
    [{
      name: 'generated-rules',
      source: {
        kind: 'url',
        url: 'https://example.com/generated.txt',
        target: 'clash',
      },
      targetOptions: {
        clash: { behavior: 'ipcidr', format: 'text' },
      },
    }],
    {
      produceBuiltinArtifact: async () => [
        {
          name: 'Collision',
          type: 'ss',
          server: 'new.example.com',
          port: 443,
          cipher: 'aes-128-gcm',
          password: 'secret',
        },
        {
          name: 'Generated',
          type: 'http',
          server: 'generated.example.com',
          port: 443,
        },
      ],
    },
  );
  const clash = parseYaml(result.body);
  const proxy = name => clash.proxies.find(item => item.name === name);
  const group = name => clash['proxy-groups'].find(item => item.name === name);

  assert.equal(clash.port, 7890);
  assert.equal(clash.dns.enable, true);
  assert.equal(clash.tun.enable, true);
  assert.deepEqual(clash.proxies.map(item => item.name), [
    'Manual',
    'Collision',
    'Generated',
  ]);
  assert.equal(proxy('Collision').server, 'new.example.com');
  assert.equal(group('Main').lazy, true);
  assert.deepEqual(group('Main').proxies, ['DIRECT']);
  assert.ok(group('Manual Group'));
  assert.equal(clash['proxy-providers'].LocalNodes.type, 'file');
  assert.equal(clash['rule-providers'].ManualRules.type, 'file');
  assert.equal(clash['rule-providers'].GeneratedRules.behavior, 'ipcidr');
  assert.equal(clash['rule-providers'].GeneratedRules.format, 'text');
  assert.match(clash['rule-providers'].GeneratedRules.path, /\.txt$/);
  assert.ok(clash.rules.includes('SCRIPT,shortcuts.example,Main'));
  assert.ok(clash.rules.includes('RULE-SET,GeneratedRules,Main'));
  assert.deepEqual(clash.rules.filter(rule => rule.startsWith('MATCH,')), [
    'MATCH,Main',
  ]);
  assert.equal(clash.rules.at(-1), 'MATCH,Main');
  assert.ok(result.warnings.some(warning =>
    warning.path === 'outputs.clash.independentConfig.proxies.Collision'
      && warning.message.includes('replaced')));
});

test('round-trips documented Clash rule-provider behavior and format', async () => {
  const imported = await importConfig('clash', [
    'mode: rule',
    'proxy-groups:',
    '  - name: Main',
    '    type: select',
    '    proxies:',
    '      - DIRECT',
    'rule-providers:',
    '  DomainText:',
    '    type: http',
    '    behavior: domain',
    '    format: text',
    '    url: https://example.com/domain.txt',
    '    path: ./rules/domain.txt',
    '    interval: 3600',
    'rules:',
    '  - RULE-SET,DomainText,Main',
    '  - MATCH,Main',
  ].join('\n'));

  assert.deepEqual(imported.ruleSets[0].targetOptions?.clash, {
    behavior: 'domain',
    format: 'text',
  });
  const clash = parseYaml((await preview(
    'clash',
    { ...imported.project, name: 'clash-provider-round-trip' },
    imported.ruleSets,
  )).body);
  assert.equal(clash['rule-providers'].DomainText.behavior, 'domain');
  assert.equal(clash['rule-providers'].DomainText.format, 'text');
  assert.match(clash['rule-providers'].DomainText.path, /\.txt$/);
});

test('routes Quantumult X and Loon rule remarks to their matching sections', async () => {
  const rules = [
    { kind: 'comment', text: 'Local heading' },
    { kind: 'inline', type: 'DOMAIN', value: 'local.example', policy: 'Main' },
    { kind: 'blank' },
    { kind: 'comment', text: 'Remote heading' },
    { kind: 'remote', name: 'Named Rule', ruleSet: 'named', policy: 'Main' },
    { kind: 'blank' },
    { kind: 'comment', text: 'Unnamed remote heading' },
    { kind: 'remote', ruleSet: 'unnamed-internal-id', policy: 'Main' },
    { kind: 'blank' },
    { kind: 'final', policy: 'Main' },
  ];
  const groups = [{
    name: 'Main',
    type: 'select',
    members: [{ kind: 'builtin', value: 'DIRECT' }],
    remark: 'Main remark',
  }];
  const qx = await preview(
    'qx',
    projectFor('qx', { name: 'qx-rule-remarks', groups, rules }),
    [
      { name: 'named', source: { kind: 'url', url: 'https://example.com/named.list', target: 'qx' } },
      { name: 'unnamed-internal-id', source: { kind: 'url', url: 'https://example.com/unnamed.list', target: 'qx' } },
    ],
  );
  const qxPolicy = qx.body.slice(
    qx.body.indexOf('[policy]'),
    qx.body.indexOf('[filter_local]'),
  );
  const qxLocal = qx.body.slice(
    qx.body.indexOf('[filter_local]'),
    qx.body.indexOf('[filter_remote]'),
  );
  const qxRemote = qx.body.slice(qx.body.indexOf('[filter_remote]'));
  assert.match(qxPolicy, /# Main remark\nstatic=Main/);
  assert.match(qxLocal, /# Local heading\nhost, local\.example, Main/);
  assert.equal(qxLocal.includes('# Remote heading'), false);
  assert.match(qxRemote, /# Remote heading/);
  assert.match(qxRemote, /# Named Rule/);
  assert.match(qxRemote, /tag=Named Rule/);
  assert.match(qxRemote, /# Unnamed remote heading/);
  assert.equal(qxRemote.includes('tag=unnamed-internal-id'), false);

  const loon = await preview(
    'loon',
    projectFor('loon', { name: 'loon-rule-remarks', groups, rules }),
    [
      { name: 'named', source: { kind: 'url', url: 'https://example.com/named.list', target: 'loon' } },
      { name: 'unnamed-internal-id', source: { kind: 'url', url: 'https://example.com/unnamed.list', target: 'loon' } },
    ],
  );
  const loonLocal = loon.body.slice(
    loon.body.indexOf('[Rule]'),
    loon.body.indexOf('[Remote Rule]'),
  );
  const loonRemote = loon.body.slice(loon.body.indexOf('[Remote Rule]'));
  assert.match(loonLocal, /# Local heading\nDOMAIN, local\.example, Main/);
  assert.equal(loonLocal.includes('# Remote heading'), false);
  assert.match(loonRemote, /# Remote heading/);
  assert.equal(loonRemote.includes('# rule-name:'), false);
  assert.match(
    loonRemote,
    /https:\/\/example\.com\/named\.list, policy=Main, tag=Named Rule, enabled=true/,
  );
  assert.match(loonRemote, /# Unnamed remote heading/);
  assert.match(
    loonRemote,
    /https:\/\/example\.com\/unnamed\.list, policy=Main, enabled=true/,
  );
  assert.equal(loonRemote.includes('tag=unnamed-internal-id'), false);
  assert.equal(loonRemote.includes('# unnamed-internal-id'), false);
});

test('uses the explicit RULE-SET name as the Loon Remote Rule tag', async () => {
  const generated = await preview(
    'loon',
    projectFor('loon', {
      name: 'loon-zhihu-ads-tag',
      rules: [
        {
          kind: 'remote',
          name: 'ZhihuAds',
          ruleSet: 'zhihu-ads-internal-id',
          policy: 'REJECT',
        },
      ],
    }),
    [
      {
        name: 'zhihu-ads-internal-id',
        source: {
          kind: 'url',
          url: 'https://raw.githubusercontent.com/blackmatrix7/ios_rule_script/master/rule/Loon/ZhihuAds/ZhihuAds.list',
          target: 'loon',
        },
      },
    ],
  );

  assert.match(
    generated.body,
    /https:\/\/raw\.githubusercontent\.com\/blackmatrix7\/ios_rule_script\/master\/rule\/Loon\/ZhihuAds\/ZhihuAds\.list, policy=REJECT, tag=ZhihuAds, enabled=true/,
  );
  assert.equal(generated.body.includes('tag=zhihu-ads-internal-id'), false);

  const imported = await importConfig('loon', generated.body);
  const remote = imported.project.rules.find(rule => rule.kind === 'remote');
  assert.equal(remote?.name, 'ZhihuAds');
  assert.equal(remote?.policy, 'REJECT');
});

test('round-trips remote category headings without retaining generated policy headings', async () => {
  const category = '==================== Remote Category ====================';
  const secondCategory = '==================== Second Category ====================';
  const policyHeading = '==================== Main ====================';
  const project = projectFor('qx', {
    name: 'remote-category-round-trip',
    groups: [
      {
        name: 'Main',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      },
      {
        name: 'Other',
        type: 'select',
        members: [{ kind: 'builtin', value: 'DIRECT' }],
      },
    ],
    rules: [
      { kind: 'blank' },
      { kind: 'comment', text: category },
      { kind: 'remote', name: 'Named Rule', ruleSet: 'remote', policy: 'Main' },
      { kind: 'blank' },
      { kind: 'comment', text: secondCategory },
      { kind: 'remote', name: 'Second Rule', ruleSet: 'second-remote', policy: 'Other' },
      { kind: 'final', policy: 'Main' },
      { kind: 'blank' },
    ],
  });

  for (const target of ['qx', 'loon']) {
    const generated = await preview(
      target,
      { ...project, outputs: { [target]: {} } },
      [{
        name: 'remote',
        source: {
          kind: 'url',
          url: 'https://example.com/remote.list',
          target,
        },
      }, {
        name: 'second-remote',
        source: {
          kind: 'url',
          url: 'https://example.com/second-remote.list',
          target,
        },
      }],
    );
    const imported = await importConfig(target, generated.body);

    assert.equal(
      imported.project.rules.filter(rule =>
        rule.kind === 'comment' && rule.text === category).length,
      1,
      target,
    );
    assert.equal(
      imported.project.rules.some(rule =>
        rule.kind === 'comment' && rule.text === policyHeading),
      false,
      target,
    );

    const regenerated = await preview(
      target,
      { ...imported.project, name: `${target}-category-round-trip` },
      imported.ruleSets,
    );
    assert.equal(regenerated.body.split(`# ${category}`).length - 1, 1, target);
    assert.equal(
      regenerated.body.split(`# ${policyHeading}`).length - 1,
      1,
      target,
    );
    const remoteSectionName = target === 'qx' ? 'filter_remote' : 'remote rule';
    const generatedRemote = core.parseProfileSections(generated.body).sections
      .find(section => section.name === remoteSectionName)?.body;
    const regeneratedRemote = core.parseProfileSections(regenerated.body).sections
      .find(section => section.name === remoteSectionName)?.body;
    assert.deepEqual(regeneratedRemote, generatedRemote, target);
  }
});

test('round-trips QX comments, group remarks, and optional remote tags', async () => {
  const imported = await importConfig('qx', [
    '[policy]',
    '; Main remark',
    'static=Main, direct',
    '// default = Main',
    '',
    '[filter_local]',
    '// Local note',
    'host, local.example, Main',
    'final, Main',
    '',
    '[filter_remote]',
    '; Remote note',
    'https://example.com/remote.list, force-policy=Main, enabled=true',
  ].join('\n'));

  assert.equal(imported.project.groups[0].remark, 'Main remark');
  assert.equal(imported.warnings.some(warning =>
    warning.message.includes('Unsupported')
      && /comment|semi|slash|default/i.test(warning.message)), false);
  assert.ok(imported.project.rules.some(rule =>
    rule.kind === 'comment' && rule.text === 'Local note'));
  assert.ok(imported.project.rules.some(rule =>
    rule.kind === 'comment' && rule.text === 'Remote note'));
  const remote = imported.project.rules.find(rule => rule.kind === 'remote');
  assert.equal(remote.name, undefined);

  const generated = await preview(
    'qx',
    { ...imported.project, name: 'qx-comment-round-trip' },
    imported.ruleSets,
  );
  assert.match(generated.body, /# Main remark\nstatic=Main/);
  assert.match(generated.body, /# Local note\nhost, local\.example, Main/);
  assert.match(generated.body, /# Remote note/);
  assert.equal(generated.body.includes('tag=remote'), false);
});

test('keeps imported Loon remote rules before FINAL without inventing names', async () => {
  const imported = await importConfig('loon', [
    '[Proxy Group]',
    'Main = select, DIRECT',
    '',
    '[Rule]',
    'FINAL, Main',
    '',
    '[Remote Rule]',
    '# Remote category',
    'https://example.com/remote.list, policy=Main, enabled=true',
  ].join('\n'));
  const finalIndex = imported.project.rules.findIndex(rule => rule.kind === 'final');
  const remoteIndex = imported.project.rules.findIndex(rule => rule.kind === 'remote');
  assert.ok(remoteIndex >= 0 && remoteIndex < finalIndex);
  assert.equal(imported.project.rules[remoteIndex].name, undefined);

  const generated = await preview(
    'loon',
    { ...imported.project, name: 'loon-final-round-trip' },
    imported.ruleSets,
  );
  const local = generated.body.slice(
    generated.body.indexOf('[Rule]'),
    generated.body.indexOf('[Remote Rule]'),
  );
  const remote = generated.body.slice(generated.body.indexOf('[Remote Rule]'));
  assert.match(local, /FINAL, Main/);
  assert.equal(local.includes('# Remote category'), false);
  assert.match(remote, /# Remote category/);
  assert.equal(remote.includes('# remote'), false);
});

test('keeps empty Loon proxy-section spacing across import and regeneration', async () => {
  const imported = await importConfig('loon', [
    '[General]',
    '',
    '[Proxy]',
    '',
    '[Remote Proxy]',
    'Nodes = https://example.com/nodes.list',
    '[Proxy Group]',
    'Main = select, Nodes',
    '[Rule]',
    'FINAL, Main',
  ].join('\n'));
  const generated = await preview(
    'loon',
    { ...imported.project, name: 'loon-empty-proxy-spacing' },
    imported.ruleSets,
  );

  assert.match(generated.body, /\[Proxy\]\n\n\[Remote Proxy\]/);
});

test('round-trips the officially documented Quantumult X IP-ASN filter', async () => {
  const imported = await importConfig('qx', [
    '[policy]',
    'static=Main, direct',
    '',
    '[filter_local]',
    'ip-asn, 6185, Main',
    'final, Main',
  ].join('\n'));

  assert.deepEqual(
    imported.project.rules.find(rule => rule.kind === 'inline'),
    {
      kind: 'inline',
      type: 'IP-ASN',
      value: '6185',
      policy: 'Main',
    },
  );

  const generated = await preview(
    'qx',
    { ...imported.project, name: 'qx-ip-asn-round-trip' },
    imported.ruleSets,
  );
  assert.match(generated.body, /ip-asn, 6185, Main/);
  assert.equal(
    generated.warnings.some(warning => warning.message.includes('IP-ASN')),
    false,
  );
});

test('keeps Loon IP-ASN no-resolve and imports the documented positional remote policy', async () => {
  const imported = await importConfig('loon', [
    '[Proxy Group]',
    'Main = select, DIRECT',
    '',
    '[Rule]',
    'IP-ASN,4134,Main,no-resolve',
    'FINAL,Main',
    '',
    '[Remote Rule]',
    'https://example.com/remote.list, Main',
  ].join('\n'));

  const ipAsn = imported.project.rules.find(rule =>
    rule.kind === 'inline' && rule.type === 'IP-ASN');
  const remote = imported.project.rules.find(rule => rule.kind === 'remote');
  assert.equal(ipAsn?.noResolve, true);
  assert.equal(remote?.policy, 'Main');

  const generated = await preview(
    'loon',
    { ...imported.project, name: 'loon-documented-rule-round-trip' },
    imported.ruleSets,
  );
  assert.match(generated.body, /IP-ASN, 4134, Main, no-resolve/);
  assert.match(
    generated.body,
    /https:\/\/example\.com\/remote\.list, policy=Main, enabled=true/,
  );
  assert.equal(
    generated.warnings.some(warning => warning.path === 'rules[0].noResolve'),
    false,
  );
});

test('keeps legacy Loon ssid groups importable while warning about the current manual boundary', async () => {
  const imported = await importConfig('loon', [
    '[Proxy Group]',
    'Main = select, DIRECT',
    'Network = ssid, default = Main, cellular = DIRECT, "Home WiFi" = Main',
    '',
    '[Rule]',
    'FINAL,Network',
  ].join('\n'));

  const network = imported.project.groups.find(group => group.name === 'Network');
  assert.equal(network?.type, 'ssid');

  const generated = await preview(
    'loon',
    { ...imported.project, name: 'loon-legacy-ssid-round-trip' },
    imported.ruleSets,
  );
  assert.match(generated.body, /Network = ssid,/);
  assert.ok(generated.warnings.some(warning =>
    warning.path === 'groups.Network.type'
      && warning.message.includes('legacy official example')
      && warning.message.includes('current Loon policy-group manual')));
});
