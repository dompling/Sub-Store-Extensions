import {
  loadSingleExtension,
  readRepositoryConfig,
  resolveRepositorySourceUrl,
} from './lib.mjs';

const [command, ...args] = process.argv.slice(2);
const valueAfter = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const host = (valueAfter('--host') || process.env.SUB_STORE_HOST_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const token = valueAfter('--token') || process.env.SUB_STORE_EXTENSION_ADMIN_TOKEN || '';
const headers = {
  'content-type': 'application/json',
  ...(token ? { authorization: `Bearer ${token}` } : {}),
};

const request = async (method, pathname, body, extraHeaders = {}) => {
  const response = await fetch(`${host}${pathname}`, {
    method,
    headers: { ...headers, ...extraHeaders },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.status === 'failed') {
    const details = payload.error || payload;
    const error = new Error(
      `${method} ${pathname} failed (${response.status}): ${details.message || details.code || 'unknown error'}`,
    );
    error.code = details.code;
    error.statusCode = response.status;
    error.details = details.details;
    throw error;
  }
  return payload.data;
};

const sourceUrl = config => resolveRepositorySourceUrl(config, {
  explicitUrl: valueAfter('--url'),
  environmentUrl: process.env.SUB_STORE_EXTENSION_SOURCE_URL,
});

const findSource = async url => {
  const sources = await request('GET', '/api/extensions/sources');
  return sources.find(source => source.url === url) || null;
};

if (command === 'source:add') {
  const config = await readRepositoryConfig();
  const url = sourceUrl(config);
  const source = await request(
    'POST',
    '/api/admin/extensions/sources',
    { url, name: valueAfter('--name') || config.name },
    { 'x-idempotency-key': `source-${config.id}-${url}` },
  );
  process.stdout.write(`Added collection source ${source.name}\n${source.url}\n${source.entryCount} extensions\n`);
} else if (command === 'source:refresh') {
  const config = await readRepositoryConfig();
  const url = sourceUrl(config);
  const source = await findSource(url);
  if (!source) throw new Error(`Collection source is not installed: ${url}`);
  const refreshed = await request(
    'POST',
    `/api/admin/extensions/sources/${encodeURIComponent(source.id)}/refresh`,
    {},
    { 'x-idempotency-key': `refresh-${source.id}-${Date.now()}` },
  );
  process.stdout.write(`Refreshed ${refreshed.name}: ${refreshed.entryCount} extensions\n`);
} else if (command === 'install') {
  const extension = await loadSingleExtension(args);
  const reinstall = args.includes('--reinstall');
  if (reinstall) {
    try {
      await request('DELETE', `/api/admin/extensions/${encodeURIComponent(extension.id)}`, { purgeData: false });
    } catch (error) {
      if (error.code !== 'EXTENSION_NOT_INSTALLED') throw error;
    }
  }
  const installed = await request(
    'POST',
    `/api/admin/extensions/${encodeURIComponent(extension.id)}/install`,
    {},
    { 'x-idempotency-key': `source-install-${extension.id}-${extension.manifest.version}` },
  );
  await request(
    'POST',
    `/api/admin/extensions/${encodeURIComponent(extension.id)}/enable`,
    {},
    { 'x-idempotency-key': `source-enable-${extension.id}-${extension.manifest.version}` },
  );
  process.stdout.write(`Installed from collection source ${extension.id}@${installed.record?.version || extension.manifest.version}\n`);
} else {
  throw new Error(`Unknown Host management command: ${command || '(missing)'}`);
}
