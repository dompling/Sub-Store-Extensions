import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  directoryProjection,
  loadSingleExtension,
  repoRoot,
  verifyPackageDirectory,
} from './lib.mjs';

const valueAfter = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

export const localHostOptions = (args, environment = process.env) => ({
  host: (valueAfter(args, '--host') || environment.SUB_STORE_HOST_URL || 'http://127.0.0.1:3000')
    .replace(/\/+$/, ''),
  token: valueAfter(args, '--token') || environment.SUB_STORE_EXTENSION_ADMIN_TOKEN || '',
});

export const installLocalExtension = async ({
  extension,
  packageDirectory = extension.packageDirectory,
  host = 'http://127.0.0.1:3000',
  token = '',
  reinstall = false,
  fetchImplementation = globalThis.fetch,
}) => {
  const normalizedHost = host.replace(/\/+$/, '');
  const verified = await verifyPackageDirectory(packageDirectory, extension);
  const projection = await directoryProjection(packageDirectory, extension.id);
  const headers = {
    'content-type': 'application/vnd.substore.extension-directory+json',
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };

  const request = async (method, pathname, body, extraHeaders = {}) => {
    const response = await fetchImplementation(`${normalizedHost}${pathname}`, {
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
      await request(
        'DELETE',
        `/api/admin/extensions/${encodeURIComponent(extension.id)}`,
        { purgeData: false },
      );
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

  return { host: normalizedHost, verified };
};

export const runLocalInstall = async (
  args = process.argv.slice(2),
  environment = process.env,
) => {
  const extension = await loadSingleExtension(args);
  const { host, token } = localHostOptions(args, environment);
  const packageDirectory = path.resolve(
    repoRoot,
    valueAfter(args, '--package-dir') || path.relative(repoRoot, extension.packageDirectory),
  );
  const result = await installLocalExtension({
    extension,
    packageDirectory,
    host,
    token,
    reinstall: args.includes('--reinstall'),
  });

  process.stdout.write(
    `Installed local fallback ${extension.id}@${result.verified.manifest.version}\n` +
    `Host: ${result.host}\n`,
  );
  return result;
};

const isMain = process.argv[1]
  && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isMain) {
  runLocalInstall().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
