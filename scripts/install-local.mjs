import path from 'node:path';
import {
  directoryProjection,
  loadSingleExtension,
  repoRoot,
  verifyPackageDirectory,
} from './lib.mjs';

const args = process.argv.slice(2);
const valueAfter = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const extension = await loadSingleExtension(args);
const host = (valueAfter('--host') || process.env.SUB_STORE_HOST_URL || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const token = valueAfter('--token') || process.env.SUB_STORE_EXTENSION_ADMIN_TOKEN || '';
const packageDirectory = path.resolve(
  repoRoot,
  valueAfter('--package-dir') || path.relative(repoRoot, extension.packageDirectory),
);
const reinstall = args.includes('--reinstall');

const verified = await verifyPackageDirectory(packageDirectory, extension);
const projection = await directoryProjection(packageDirectory, extension.id);
const headers = {
  'content-type': 'application/vnd.substore.extension-directory+json',
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

await request('POST', '/api/admin/extensions/packages/inspect', projection);

if (reinstall) {
  try {
    await request('DELETE', `/api/admin/extensions/${encodeURIComponent(extension.id)}`, { purgeData: false });
  } catch (error) {
    if (error.code !== 'EXTENSION_NOT_INSTALLED') throw error;
  }
}

await request(
  'POST',
  `/api/admin/extensions/${encodeURIComponent(extension.id)}/install-local`,
  projection,
  { 'x-idempotency-key': `local-${verified.packageDigest}` },
);
await request(
  'POST',
  `/api/admin/extensions/${encodeURIComponent(extension.id)}/enable`,
  {},
  { 'x-idempotency-key': `enable-${verified.packageDigest}` },
);

process.stdout.write(
  `Installed local fallback ${extension.id}@${verified.manifest.version}\n` +
  `Host: ${host}\n`,
);
