import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const extensionsDirectory = path.join(repoRoot, 'extensions');
export const packagesDirectory = path.join(repoRoot, 'packages');
export const buildRoot = path.join(repoRoot, 'build');
export const distPackagesDirectory = path.join(repoRoot, 'dist', 'packages');
export const repositoryDirectory = path.join(repoRoot, 'repository');
export const repositoryConfigPath = path.join(repoRoot, 'repository.config.json');

const packageMetadataFiles = ['manifest.json', 'package.json', 'receipt.json'];
const extensionConfigName = 'extension.config.json';

export const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

export const canonicalize = value => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
};

export const canonicalJson = value => JSON.stringify(canonicalize(value));
export const sha256Hex = value => createHash('sha256').update(value).digest('hex');
export const readJson = async file => JSON.parse(await fs.readFile(file, 'utf8'));

export const writeJson = async (file, value) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
};

export const pathExists = async file => {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
};

export const copyDirectory = async (source, destination) => {
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.cp(source, destination, { recursive: true });
};

export const listRegularFiles = async (directory, current = directory) => {
  const names = [];
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(current, entry.name);
    if (entry.isDirectory()) {
      names.push(...await listRegularFiles(directory, absolute));
      continue;
    }
    assert(entry.isFile(), `Directory contains a non-regular file: ${absolute}`);
    names.push(path.relative(directory, absolute).split(path.sep).join('/'));
  }
  return names;
};

const resolveInside = (base, value, label) => {
  const resolved = path.resolve(base, value);
  assert(
    resolved === base || resolved.startsWith(`${base}${path.sep}`),
    `${label} escapes its allowed directory: ${value}`,
  );
  return resolved;
};

export const discoverExtensionIds = async () => {
  const entries = await fs.readdir(extensionsDirectory, { withFileTypes: true });
  const ids = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory()) continue;
    const configPath = path.join(extensionsDirectory, entry.name, extensionConfigName);
    if (await pathExists(configPath)) ids.push(entry.name);
  }
  assert(ids.length > 0, `No extensions found beneath ${extensionsDirectory}`);
  return ids;
};

const extensionCache = new Map();

export const loadExtension = async extensionId => {
  if (extensionCache.has(extensionId)) return extensionCache.get(extensionId);
  const workspaceDirectory = path.join(extensionsDirectory, extensionId);
  const configPath = path.join(workspaceDirectory, extensionConfigName);
  assert(await pathExists(configPath), `Unknown extension: ${extensionId}`);
  const config = await readJson(configPath);
  assert(config.schemaVersion === 1, `Unsupported extension config schema: ${extensionId}`);
  assert(config.id === extensionId, `Extension folder and config id differ: ${extensionId}`);

  const packageDirectory = resolveInside(
    repoRoot,
    config.packageDirectory || `packages/${extensionId}`,
    `${extensionId} packageDirectory`,
  );
  assert(
    packageDirectory === path.join(packagesDirectory, extensionId),
    `${extensionId} packageDirectory must be packages/${extensionId}`,
  );
  const manifestPath = resolveInside(
    workspaceDirectory,
    config.manifest,
    `${extensionId} manifest`,
  );
  const buildDirectory = path.join(buildRoot, extensionId);
  const distPackageDirectory = path.join(distPackagesDirectory, extensionId);
  const backend = config.backend
    ? {
        sourceRoot: resolveInside(workspaceDirectory, config.backend.sourceRoot, `${extensionId} backend sourceRoot`),
        entrypoint: resolveInside(workspaceDirectory, config.backend.entrypoint, `${extensionId} backend entrypoint`),
        output: config.backend.output,
      }
    : null;
  const frontend = config.frontend
    ? {
        config: resolveInside(workspaceDirectory, config.frontend.config, `${extensionId} frontend config`),
        tsconfig: resolveInside(workspaceDirectory, config.frontend.tsconfig, `${extensionId} frontend tsconfig`),
        outputs: [...(config.frontend.outputs || [])],
      }
    : null;
  const manifest = await readJson(manifestPath);
  assert(manifest.id === extensionId, `Source manifest id differs for ${extensionId}`);
  const contentFiles = (config.contentFiles || []).map((file, index) => {
    assert(file?.source && file?.package, `${extensionId} contentFiles[${index}] is incomplete`);
    const packagePath = `${file.package}`.split(path.sep).join('/');
    assert(
      packagePath &&
        !packagePath.startsWith('/') &&
        !packagePath.includes('\\') &&
        !/[\u0000-\u001f\u007f]/.test(packagePath) &&
        packagePath.split('/').every(segment => segment && segment !== '.' && segment !== '..'),
      `${extensionId} contentFiles[${index}] has an unsafe package path`,
    );
    return {
      source: resolveInside(workspaceDirectory, file.source, `${extensionId} content source`),
      package: packagePath,
    };
  });
  assert(
    new Set(contentFiles.map(file => file.package.normalize('NFC').toLowerCase())).size === contentFiles.length,
    `${extensionId} declares duplicate content package paths`,
  );

  const extension = {
    id: extensionId,
    config,
    configPath,
    workspaceDirectory,
    packageDirectory,
    manifestPath,
    manifest,
    buildDirectory,
    distPackageDirectory,
    backend,
    frontend,
    testsDirectory: path.join(workspaceDirectory, 'tests'),
    artifacts: [...(config.artifacts || [])],
    contentFiles,
  };
  extensionCache.set(extensionId, extension);
  return extension;
};

export const loadAllExtensions = async () => Promise.all(
  (await discoverExtensionIds()).map(loadExtension),
);

export const requestedExtensionIds = argv => {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--extension') {
      assert(argv[index + 1], '--extension requires an id');
      values.push(argv[index + 1]);
      index += 1;
    } else if (value.startsWith('--extension=')) {
      values.push(value.slice('--extension='.length));
    }
  }
  return [...new Set(values.filter(Boolean))];
};

export const loadSelectedExtensions = async (argv = process.argv.slice(2)) => {
  const requested = requestedExtensionIds(argv);
  const ids = requested.length ? requested : await discoverExtensionIds();
  return Promise.all(ids.map(loadExtension));
};

export const loadSingleExtension = async (argv = process.argv.slice(2)) => {
  const selected = await loadSelectedExtensions(argv);
  assert(
    selected.length === 1,
    `Select exactly one extension with --extension. Available: ${(await discoverExtensionIds()).join(', ')}`,
  );
  return selected[0];
};

export const readRepositoryConfig = async () => {
  const config = await readJson(repositoryConfigPath);
  assert(config.schemaVersion === 1, 'Unsupported repository config schema');
  assert(config.id && config.name, 'Repository config requires id and name');
  assert(config.publisher?.id && config.publisher?.name, 'Repository config requires publisher');
  if (config.catalogUrl) {
    const catalogUrl = new URL(config.catalogUrl);
    assert(catalogUrl.protocol === 'https:', 'Repository catalogUrl must use HTTPS');
  }
  return config;
};

export const resolveRepositorySourceUrl = (
  config,
  { explicitUrl, environmentUrl } = {},
) => {
  const value = explicitUrl
    || environmentUrl
    || config?.catalogUrl
    || 'http://127.0.0.1:8765/catalog.json';
  const url = new URL(value);
  assert(url.protocol === 'https:' || url.protocol === 'http:', 'Collection source URL must use HTTP(S)');
  return url.toString();
};

export const readPackage = async packageDirectory => {
  const manifest = await readJson(path.join(packageDirectory, 'manifest.json'));
  const receipt = await readJson(path.join(packageDirectory, 'receipt.json'));
  const metadata = await readJson(path.join(packageDirectory, 'package.json'));
  const declaredFiles = Object.keys(metadata.fileDigests || {}).sort();
  const actualFiles = await listRegularFiles(packageDirectory);
  const expectedFiles = [...packageMetadataFiles, ...declaredFiles].sort();
  assert(
    canonicalJson(actualFiles) === canonicalJson(expectedFiles),
    'Package contains missing, undeclared, or non-regular files',
  );
  const files = Object.fromEntries(
    await Promise.all(
      declaredFiles.map(async name => [
        name,
        await fs.readFile(path.join(packageDirectory, name), 'utf8'),
      ]),
    ),
  );
  return { manifest, receipt, metadata, files };
};

export const packageProjection = ({ manifest, metadata, files }) => ({
  schemaVersion: metadata.schemaVersion,
  manifest,
  selectedVariant: metadata.selectedVariant,
  variant: metadata.variant,
  containsExecutableCode: metadata.containsExecutableCode === true,
  containsInstallHook: metadata.containsInstallHook === true,
  files,
  fileDigests: metadata.fileDigests,
});

export const packagePayload = packageValue => ({
  ...packageProjection(packageValue),
  packageDigest: packageValue.metadata.packageDigest,
  receipt: packageValue.receipt,
});

export const verifyPackageDirectory = async (packageDirectory, extension) => {
  const value = await readPackage(packageDirectory);
  const selectedExtension = extension || await loadExtension(value.manifest.id);
  assert(value.manifest.id === selectedExtension.id, `Unexpected extension id: ${value.manifest.id}`);
  assert(value.receipt.extensionId === selectedExtension.id, 'Receipt extension id does not match');
  assert(value.metadata.containsInstallHook === false, 'Install hooks are forbidden');

  const actualFileDigests = Object.fromEntries(
    Object.entries(value.files).map(([name, content]) => [name, sha256Hex(content)]),
  );
  assert(
    canonicalJson(actualFileDigests) === canonicalJson(value.metadata.fileDigests),
    'Package file digests do not match package.json',
  );

  const calculatedPackageDigest = sha256Hex(canonicalJson(packageProjection(value)));
  assert(calculatedPackageDigest === value.metadata.packageDigest, 'Package digest is stale');
  assert(value.receipt.packageDigest === calculatedPackageDigest, 'Receipt package digest is stale');

  const manifestDigest = sha256Hex(canonicalJson(value.manifest));
  assert(value.receipt.manifestDigest === manifestDigest, 'Receipt manifest digest is stale');
  const { receiptDigest, ...receiptBody } = value.receipt;
  assert(sha256Hex(canonicalJson(receiptBody)) === receiptDigest, 'Receipt digest is stale');

  for (const asset of Object.values(value.manifest.frontend?.assets || {})) {
    assert(asset?.path && asset?.digest, 'Frontend asset metadata is incomplete');
    assert(actualFileDigests[asset.path] === asset.digest, `Frontend asset digest is stale: ${asset.path}`);
  }

  const payload = packagePayload(value);
  const payloadDigest = sha256Hex(canonicalJson(payload));
  const signature = value.metadata.signature;
  const expectedAlgorithm = selectedExtension.config.signature?.algorithm;
  assert(payloadDigest === value.metadata.payloadDigest, 'Package payload digest is stale');
  assert(signature?.digest === payloadDigest, 'Package integrity digest is stale');
  assert(signature?.algorithm === expectedAlgorithm, 'Unexpected package integrity algorithm');
  assert(expectedAlgorithm === 'sha256-digest', `Unsupported integrity algorithm: ${expectedAlgorithm}`);
  assert(signature.value === payloadDigest, 'Package integrity value is stale');

  return {
    ...value,
    extension: selectedExtension,
    payload,
    manifestDigest,
    packageDigest: calculatedPackageDigest,
    payloadDigest,
    fileDigests: actualFileDigests,
  };
};

export const directoryProjection = async (packageDirectory, extensionId) => {
  const files = {};
  const visit = async (directory, prefix = '') => {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(absolute, relative);
      else if (entry.isFile()) files[relative] = await fs.readFile(absolute, 'utf8');
      else throw new Error(`Unsupported package entry: ${relative}`);
    }
  };
  await visit(packageDirectory);
  return {
    schemaVersion: 1,
    format: 'substore-extension-directory-v1',
    rootName: extensionId,
    files,
  };
};
