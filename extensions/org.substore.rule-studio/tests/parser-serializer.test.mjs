import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parse as parseYaml } from 'yaml';
import { createRuntime, inlineProject, requestRoute } from './helpers/runtime.mjs';

async function preview(representation, project = inlineProject()) {
  const runtime = createRuntime();
  try {
    const result = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/preview', {
      body: { project: { ...project, id: 'draft', revision: 1, lifecycle: { state: 'active' } }, representation },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.payload));
    return result.payload.data;
  } finally {
    runtime.close();
  }
}

test('normalizes source policies, domains and IPv4 CIDR without mutating source input', async () => {
  const project = inlineProject();
  const copy = structuredClone(project);
  const result = await preview('normalized-json', project);
  const normalized = JSON.parse(result.body);

  assert.deepEqual(project, copy);
  assert.equal(normalized.rules[0].value, 'example.com');
  assert.equal(normalized.rules[2].value, '192.168.1.0/24');
  assert.ok(result.diagnostics.some(item => item.code === 'SOURCE_POLICY_IGNORED'));
});

test('serializes Surge, QX, Loon and Clash classical outputs with diagnostics', async () => {
  const surge = await preview('surge-rule-list');
  assert.match(surge.body, /DOMAIN,example\.com/);
  assert.match(surge.body, /IP-CIDR,192\.168\.1\.0\/24,no-resolve/);

  const qx = await preview('qx-filter');
  assert.match(qx.body, /HOST,example\.com/);
  assert.match(qx.body, /PROCESS-NAME,Example/);

  const qxFiltered = await preview('qx-filter', inlineProject({
    sources: [{ id: 'unsupported', kind: 'inline', enabled: true, format: 'surge', content: 'NETWORK,TCP\nDOMAIN,example.com' }],
  }));
  assert.ok(qxFiltered.diagnostics.some(item => item.code === 'QX_RULE_UNSUPPORTED'));

  const loon = await preview('loon-rule-list');
  assert.match(loon.body, /DOMAIN-SUFFIX,example\.org/);

  const clash = await preview('clash-classical-yaml');
  assert.deepEqual(parseYaml(clash.body).payload, [
    'DOMAIN,example.com',
    'DOMAIN-SUFFIX,example.org',
    'IP-CIDR,192.168.1.0/24,no-resolve',
    'PROCESS-NAME,Example',
  ]);
});

test('combines parse and serializer dispositions without double-counting diagnostics', async () => {
  const result = await preview('qx-filter', inlineProject({
    sources: [{
      id: 'mixed',
      kind: 'inline',
      enabled: true,
      format: 'surge',
      content: [
        'DOMAIN,example.com',
        'NETWORK,TCP',
        'UNKNOWN,value',
      ].join('\n'),
    }],
  }));

  assert.match(result.body, /HOST,example\.com/);
  assert.ok(result.diagnostics.some(item => item.code === 'QX_RULE_UNSUPPORTED'));
  assert.ok(result.diagnostics.some(item => item.code === 'RULE_TYPE_UNSUPPORTED'));
  assert.deepEqual(
    {
      exact: result.stats.exact,
      fallback: result.stats.fallback,
      filtered: result.stats.filtered,
      invalid: result.stats.invalid,
    },
    { exact: 1, fallback: 0, filtered: 1, invalid: 1 },
  );
});

test('supports Clash domain and ipcidr providers only for compatible content', async () => {
  const domain = await preview('clash-domain-yaml', inlineProject({
    sources: [{ id: 'd', kind: 'inline', enabled: true, format: 'clash-domain-yaml', content: 'payload:\n  - +.example.com\n  - exact.example.org\n' }],
  }));
  assert.deepEqual(parseYaml(domain.body).payload, ['+.example.com', 'exact.example.org']);

  const ip = await preview('clash-ipcidr-yaml', inlineProject({
    sources: [{ id: 'i', kind: 'inline', enabled: true, format: 'clash-ipcidr-yaml', content: 'payload:\n  - 10.1.2.3/8\n  - 2001:db8::/32\n' }],
  }));
  assert.deepEqual(parseYaml(ip.body).payload, ['10.0.0.0/8', '2001:db8::/32']);

  const runtime = createRuntime();
  try {
    const result = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/preview', {
      body: { project: { ...inlineProject(), id: 'draft', revision: 1, lifecycle: { state: 'active' } }, representation: 'clash-domain-yaml' },
    });
    assert.equal(result.statusCode, 400);
    assert.equal(result.payload.error.code, 'RESOURCE_REPRESENTATION_UNSUPPORTED');
  } finally {
    runtime.close();
  }
});

test('rejects HTML error documents instead of accepting them as text rules', async () => {
  const runtime = createRuntime();
  try {
    const result = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/preview', {
      body: { project: { ...inlineProject({ sources: [{ id: 'bad', kind: 'inline', enabled: true, format: 'auto', content: '<html>404</html>' }] }), id: 'draft', revision: 1, lifecycle: { state: 'active' } }, representation: 'surge-rule-list' },
    });
    assert.equal(result.statusCode, 422);
    assert.equal(result.payload.error.code, 'RESOURCE_CONTENT_INVALID');
  } finally {
    runtime.close();
  }
});
