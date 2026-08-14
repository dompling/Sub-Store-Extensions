import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { test } from 'node:test';
import { analyzeNodes } from '../backend/src/extensions/subscription-doctor/analyzer/analyze.js';
import { exactFingerprint } from '../backend/src/extensions/subscription-doctor/analyzer/fingerprint.js';
import { compatibilityForNode } from '../backend/src/extensions/subscription-doctor/compatibility/registry.js';

const ss = (overrides = {}) => ({
  type: 'ss',
  name: 'Hong Kong',
  server: 'hk.example.com',
  port: 443,
  cipher: 'aes-128-gcm',
  password: 'secret',
  ...overrides,
});

test('analyzes normal nodes, protocol distribution and the four target matrix', () => {
  const report = analyzeNodes([
    ss(),
    {
      type: 'vmess',
      name: 'Tokyo',
      server: 'jp.example.com',
      port: 443,
      uuid: '11111111-1111-4111-8111-111111111111',
      network: 'ws',
    },
  ], { now: () => 123 });

  assert.equal(report.checkedAt, 123);
  assert.deepEqual(report.counts, {
    total: 2,
    invalid: 0,
    duplicate: 0,
    duplicateName: 0,
  });
  assert.deepEqual(report.protocols, { ss: 1, vmess: 1 });
  for (const target of ['surge', 'qx', 'clash', 'loon']) {
    assert.equal(report.targets[target].exact, 2);
  }
  assert.equal(report.status, 'healthy');
});

test('reports missing fields and invalid hosts and ports using safe paths', () => {
  const report = analyzeNodes([
    { type: 'vmess', name: '', server: '', port: 0 },
    ss({ server: 'https://bad.example.com/path?token=SECRET', port: 70000 }),
  ]);

  assert.equal(report.counts.invalid, 2);
  assert.equal(report.status, 'error');
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /bad\.example\.com|SECRET/);
  assert.match(serialized, /NODE_SERVER_MISSING/);
  assert.match(serialized, /NODE_SERVER_INVALID/);
  assert.match(serialized, /NODE_PORT_INVALID/);
  assert.match(serialized, /nodes\[\*\]\.server/);
});

test('counts exact duplicates and duplicate names separately', () => {
  const exact = ss({ name: 'First' });
  const sameConnection = ss({ name: 'Second' });
  const sameNameDifferentConnection = ss({ name: 'First', server: 'other.example.com' });
  const report = analyzeNodes([exact, sameConnection, sameNameDifferentConnection]);

  assert.equal(report.counts.duplicate, 1);
  assert.equal(report.counts.duplicateName, 1);
  assert.equal(
    report.diagnostics.some(item => item.code === 'NODE_EXACT_DUPLICATE'),
    true,
  );
  assert.equal(
    report.diagnostics.some(item => item.code === 'NODE_NAME_DUPLICATE'),
    true,
  );
  assert.equal(
    report.diagnostics.find(item => item.code === 'NODE_EXACT_DUPLICATE').count,
    report.counts.duplicate,
  );
  assert.equal(
    report.diagnostics.find(item => item.code === 'NODE_NAME_DUPLICATE').count,
    report.counts.duplicateName,
  );
});

test('uses credentials in the in-memory fingerprint without exposing them', () => {
  const first = ss({ password: 'PASSWORD_456' });
  const second = ss({ password: 'DIFFERENT_PASSWORD' });
  assert.notEqual(exactFingerprint(first), exactFingerprint(second));

  const report = analyzeNodes([first, second]);
  assert.equal(report.counts.duplicate, 0);
  assert.doesNotMatch(JSON.stringify(report), /PASSWORD_456|DIFFERENT_PASSWORD/);
});

test('keeps unknown protocols unknown and exposes exact/fallback/filtered cases', () => {
  assert.deepEqual(compatibilityForNode({ type: 'future-protocol' }).matrix, {
    surge: 'unknown',
    qx: 'unknown',
    clash: 'unknown',
    loon: 'unknown',
  });
  assert.deepEqual(compatibilityForNode({ type: 'wireguard' }).matrix, {
    surge: 'fallback',
    qx: 'filtered',
    clash: 'exact',
    loon: 'exact',
  });
  assert.equal(compatibilityForNode({ type: 'ssr' }).matrix.surge, 'filtered');
});

test('summarizes endpoint, security and media-label signals without exposing node details', () => {
  const report = analyzeNodes([
    {
      type: 'http',
      name: 'HK Netflix',
      server: '192.168.10.2',
      port: 8080,
    },
    ss({
      name: 'HK 备用',
      server: 'shared.example.com',
      port: 443,
      cipher: 'rc4-md5',
      password: 'first-secret',
      'skip-cert-verify': true,
    }),
    ss({
      name: 'JP Disney+',
      server: 'shared.example.com',
      port: 443,
      password: 'second-secret',
    }),
    {
      type: 'vmess',
      name: 'US YouTube',
      server: '203.0.113.8',
      port: 443,
      uuid: '11111111-1111-4111-8111-111111111111',
      tls: true,
    },
  ]);

  assert.deepEqual(report.quality, {
    unknownProtocol: 0,
    tlsVerificationDisabled: 1,
    tlsServerNameMissing: 1,
    privateEndpoint: 1,
    sharedEndpoint: 1,
    plaintextProxy: 1,
    legacyCipher: 1,
  });
  assert.deepEqual(report.profile, {
    uniqueServers: 3,
    uniqueEndpoints: 3,
    regionTagged: 4,
    mediaTagged: 3,
    regions: { hk: 2, jp: 1, us: 1 },
    media: { disney: 1, netflix: 1, youtube: 1 },
  });
  assert.deepEqual(report.networkChecks, {
    state: 'unsupported',
    runner: 'none',
    tested: 0,
    skipped: 4,
    reachable: 0,
    failed: 0,
    reasonCode: 'NODE_PROXY_RUNNER_UNAVAILABLE',
    features: {
      connectivity: 'unsupported',
      streaming: 'unsupported',
      egress: 'unsupported',
    },
  });
  assert.equal(report.status, 'warning');
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /shared\.example\.com|192\.168\.10\.2|203\.0\.113\.8|first-secret|second-secret/);
});

test('analyzes 10,000 nodes within the locked performance and report-size budgets', () => {
  const nodes = Array.from({ length: 10_000 }, (_, index) => ss({
    name: `node-${index}`,
    server: `node-${index}.example.com`,
    port: 1000 + (index % 50_000),
    password: `credential-${index}`,
  }));
  analyzeNodes(nodes);
  const durations = [];
  let report;
  for (let iteration = 0; iteration < 3; iteration += 1) {
    const startedAt = performance.now();
    report = analyzeNodes(nodes);
    durations.push(performance.now() - startedAt);
  }
  durations.sort((left, right) => left - right);
  assert.ok(durations[1] < 3_000, `median was ${durations[1].toFixed(1)} ms`);
  assert.ok(Buffer.byteLength(JSON.stringify(report), 'utf8') < 1024 * 1024);
  assert.equal(report.counts.total, 10_000);
});
