import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRuntime, inlineProject, requestRoute } from './helpers/runtime.mjs';

test('serves stable rule-set links for Surge, Quantumult X, Clash and Loon', async () => {
  const runtime = createRuntime();
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject(),
    });
    const id = created.payload.data.id;
    const cases = [
      { target: 'Surge', mediaType: 'text/plain', pattern: /DOMAIN,example\.com/ },
      { target: 'QX', mediaType: 'text/plain', pattern: /HOST,example\.com/ },
      { target: 'Clash', mediaType: 'text/yaml', pattern: /payload:/ },
      { target: 'Loon', mediaType: 'text/plain', pattern: /DOMAIN-SUFFIX,example\.org/ },
    ];

    for (const entry of cases) {
      const result = await requestRoute(runtime, 'GET', '/download/rule-set/:id', {
        params: { id },
        query: { target: entry.target },
      });
      assert.equal(result.statusCode, 200, entry.target);
      assert.equal(result.mediaType, entry.mediaType, entry.target);
      assert.match(result.payload, entry.pattern, entry.target);
    }

    const defaultResult = await requestRoute(runtime, 'GET', '/download/rule-set/:id', {
      params: { id },
    });
    assert.equal(defaultResult.statusCode, 200);
    assert.equal(defaultResult.mediaType, 'text/plain');
    assert.match(defaultResult.payload, /DOMAIN,example\.com/);

    const representationResult = await requestRoute(
      runtime,
      'GET',
      '/download/rule-set/:id/:representation',
      {
        params: { id, representation: 'clash-classical-text' },
      },
    );
    assert.equal(representationResult.statusCode, 200);
    assert.equal(representationResult.mediaType, 'text/plain');
  } finally {
    runtime.close();
  }
});

test('maps the Host detected client to a supported rule-set representation', async () => {
  const resolveClientTarget = request => {
    if (request.query?.platform) return { value: request.query.platform, source: 'platform-query' };
    if (request.query?.target) return { value: request.query.target, source: 'target-query' };
    const userAgent = `${request.headers?.['user-agent'] || ''}`;
    if (userAgent.includes('Quantumult')) return { value: 'QX', source: 'user-agent' };
    if (userAgent.includes('Loon')) return { value: 'Loon', source: 'user-agent' };
    if (userAgent.includes('Clash-Verge')) return { value: 'ClashMeta', source: 'user-agent' };
    if (userAgent.includes('Surge Mac')) return { value: 'SurgeMac', source: 'user-agent' };
    return { value: 'V2Ray', source: 'default' };
  };
  const runtime = createRuntime({ resolveClientTarget });
  try {
    const created = await requestRoute(runtime, 'POST', '/api/extensions/rule-studio/projects', {
      body: inlineProject(),
    });
    const id = created.payload.data.id;
    const cases = [
      { userAgent: 'Quantumult%20X/1.4.0', mediaType: 'text/plain', pattern: /HOST,example\.com/ },
      { userAgent: 'Loon/852', mediaType: 'text/plain', pattern: /DOMAIN-SUFFIX,example\.org/ },
      { userAgent: 'Clash-Verge/v2.4.2', mediaType: 'text/yaml', pattern: /payload:/ },
      { userAgent: 'Surge Mac/5.12.0', mediaType: 'text/plain', pattern: /DOMAIN,example\.com/ },
      { userAgent: 'Mozilla/5.0', mediaType: 'text/plain', pattern: /DOMAIN,example\.com/ },
    ];

    for (const entry of cases) {
      const result = await requestRoute(runtime, 'GET', '/download/rule-set/:id', {
        params: { id },
        headers: { 'user-agent': entry.userAgent },
      });
      assert.equal(result.statusCode, 200, entry.userAgent);
      assert.equal(result.mediaType, entry.mediaType, entry.userAgent);
      assert.match(result.payload, entry.pattern, entry.userAgent);
    }

    const explicitResult = await requestRoute(runtime, 'GET', '/download/rule-set/:id', {
      params: { id },
      query: { platform: 'Loon', target: 'Surge' },
      headers: { 'user-agent': 'Clash-Verge/v2.4.2' },
    });
    assert.equal(explicitResult.statusCode, 200);
    assert.match(explicitResult.payload, /DOMAIN-SUFFIX,example\.org/);
  } finally {
    runtime.close();
  }
});
