import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { transformWithEsbuild } from 'vite';

const url = new URL('../frontend/src/extensions/config-generator/domain/subscriptionPresentation.ts', import.meta.url);
const load = async () => {
  const { code } = await transformWithEsbuild(await readFile(url, 'utf8'), url.pathname, { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

test('resolves subscription icons by source type and name, keeping collection names distinct', async () => {
  const { subscriptionPresentation } = await load();
  const subs = [{ name: 'same', displayName: 'Airport', icon: 'https://example.com/airport.png' }];
  const collections = [{ name: 'same', 'display-name': 'Combined', icon: 'https://example.com/combined.png' }];
  assert.deepEqual(subscriptionPresentation({ type: 'subscription', name: 'same' }, subs, collections), {
    label: 'Airport', icon: 'https://example.com/airport.png',
  });
  assert.deepEqual(subscriptionPresentation({ type: 'collection', name: 'same' }, subs, collections), {
    label: 'Combined', icon: 'https://example.com/combined.png',
  });
  subs[0].icon = 'https://example.com/updated.png';
  assert.equal(subscriptionPresentation({ type: 'subscription', name: 'same' }, subs, collections).icon, 'https://example.com/updated.png');
});

test('uses safe placeholders for missing subscriptions and external URLs', async () => {
  const { subscriptionPresentation } = await load();
  assert.deepEqual(subscriptionPresentation({ type: 'subscription', name: 'deleted' }, [], []), { label: 'deleted', icon: '' });
  assert.deepEqual(subscriptionPresentation(undefined, [], []), { label: '', icon: '' });
  assert.deepEqual(subscriptionPresentation({ kind: 'url', url: 'https://example.com/sub' }, [], []), { label: '', icon: '' });
  assert.deepEqual(subscriptionPresentation({ type: 'subscription', name: 'empty' }, [{ name: 'empty', icon: '  ' }], []), { label: 'empty', icon: '' });
});

test('clears the previous icon when switching subscriptions and preserves it when reselecting the same source', async () => {
  const { selectSubscriptionSource } = await load();
  const source = { kind: 'sub-store', type: 'subscription', name: 'first', publicBaseUrl: 'https://example.com' };
  const draft = { name: 'Airport', source, iconUrl: 'https://example.com/first.png' };
  selectSubscriptionSource(draft, { ...source });
  assert.equal(draft.iconUrl, 'https://example.com/first.png');
  selectSubscriptionSource(draft, { ...source, name: 'second' });
  assert.equal(draft.source.name, 'second');
  assert.equal(Object.hasOwn(draft, 'iconUrl'), false);
  draft.iconUrl = 'https://example.com/second.png';
  selectSubscriptionSource(draft, { ...draft.source, type: 'collection' });
  assert.equal(Object.hasOwn(draft, 'iconUrl'), false);
});
