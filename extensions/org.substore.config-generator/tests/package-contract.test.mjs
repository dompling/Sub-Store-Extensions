import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  canonicalJson,
  loadExtension,
  readJson,
  repoRoot,
  sha256Hex,
  verifyPackageDirectory,
} from '../../../scripts/lib.mjs';

const extensionId = 'org.substore.config-generator';
const extension = await loadExtension(extensionId);

const resolveModule = async (importer, specifier) => {
  if (!specifier.startsWith('.') && !specifier.startsWith('@/')) return null;
  const base = specifier.startsWith('@/')
    ? path.join(extension.backend.sourceRoot, specifier.slice(2))
    : path.resolve(path.dirname(importer), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.json`, path.join(base, 'index.js')]) {
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next supported source extension.
    }
  }
  throw new Error(`Unresolved backend import ${specifier} from ${path.relative(repoRoot, importer)}`);
};

const collectBackendGraph = async entrypoint => {
  const pending = [entrypoint];
  const visited = new Set();
  const externals = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file) || file.endsWith('.json')) continue;
    visited.add(file);
    const source = await fs.readFile(file, 'utf8');
    const importPattern = /\b(?:import|export)\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of source.matchAll(importPattern)) {
      const resolved = await resolveModule(file, match[1]);
      if (resolved) pending.push(resolved);
      else externals.add(match[1]);
    }
  }
  return { visited, externals };
};

test('keeps source, package, and repository versions on one extension identity', async () => {
  const workspacePackage = await readJson(path.join(extension.workspaceDirectory, 'package.json'));
  const sourceManifest = await readJson(extension.manifestPath);
  const signedManifest = await readJson(path.join(extension.packageDirectory, 'manifest.json'));
  const repository = await readJson(path.join(repoRoot, 'repository/catalog.json'));
  const entry = repository.entries.find(value => value.id === extensionId);

  assert.equal(workspacePackage.version, sourceManifest.version);
  assert.equal(sourceManifest.id, extensionId);
  assert.equal(canonicalJson(sourceManifest), canonicalJson(signedManifest));
  assert.equal(entry.version, sourceManifest.version);
  assert.equal(canonicalJson(entry.manifest), canonicalJson(sourceManifest));
  assert.equal(sourceManifest.entrypoints.backend.path, 'backend/index.cjs');
  assert.equal(sourceManifest.frontend.entrypoint, 'frontend/index.js');
  assert.equal(sourceManifest.frontend.style, 'frontend/style.css');
});

test('declares a Node-only remote execution contract', async () => {
  const manifest = await readJson(extension.manifestPath);

  assert.deepEqual(manifest.host.runtimes, ['node']);
  assert.deepEqual(Object.keys(manifest.variants), ['node']);
  assert.equal(manifest.variants.node.delivery, 'trusted-package');
  assert.equal(manifest.variants.node.containsExecutableCode, true);
  assert.equal('embeddedBasePath' in manifest.frontend, false);
  assert.equal('scriptExecutionLanes' in manifest, false);
  assert.deepEqual(
    manifest.contributes.artifactSources[0].platforms,
    ['Surge', 'QX', 'Clash', 'Loon'],
  );
});

test('keeps every public config-generator route in the extension contribution', async () => {
  const routes = await fs.readFile(
    path.join(
      extension.workspaceDirectory,
      'frontend/src/extensions/config-generator/routes.ts',
    ),
    'utf8',
  );

  for (const route of [
    {
      path: '/extensions/config-generator',
      surface: 'list',
      backPath: '/extensions',
    },
    {
      path: '/extensions/config-generator/edit/:name',
      surface: 'editor',
      backPath: '/extensions/config-generator',
    },
    {
      path: '/extensions/config-generator/import',
      surface: 'import',
      backPath: '/extensions/config-generator',
    },
    {
      path: '/extensions/config-generator/preview/:name',
      surface: 'preview',
      backPath: '/extensions/config-generator',
    },
  ]) {
    assert.match(routes, new RegExp(`path: '${route.path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    assert.match(routes, new RegExp(`extensionSurfaceId: '${route.surface}'`));
    assert.match(routes, new RegExp(`backPath: '${route.backPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  }

  assert.match(routes, /extensionId:\s*CONFIG_GENERATOR_EXTENSION_ID/g);
  assert.match(routes, /needTabBar:\s*false/);
  assert.match(routes, /needNavBack:\s*true/);
});

test('builds the Node entrypoint without unresolved Host-private imports', async () => {
  const entrypoint = extension.backend.entrypoint;
  const graph = await collectBackendGraph(entrypoint);

  assert.deepEqual([...graph.externals].sort(), ['yaml']);
  assert.equal(
    [...graph.visited].every(file => file.startsWith(extension.backend.sourceRoot)),
    true,
  );

  const bundle = await fs.readFile(path.join(extension.buildDirectory, 'backend/index.cjs'), 'utf8');
  assert.equal(bundle.includes("require('@/"), false);
  assert.equal(bundle.includes('../backend-sdk-v1'), false);
  assert.equal(bundle.includes('../registry'), false);
});

test('reproduces every signed executable asset byte-for-byte', async () => {
  const verified = await verifyPackageDirectory(extension.packageDirectory, extension);
  for (const relative of [
    'backend/index.cjs',
    'frontend/index.js',
    'frontend/style.css',
  ]) {
    const built = await fs.readFile(path.join(extension.buildDirectory, relative), 'utf8');
    assert.equal(sha256Hex(built), verified.fileDigests[relative], relative);
  }
});

test('rejects undeclared files in an otherwise signed directory', async () => {
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'substore-extension-test-'));
  const copiedPackage = path.join(temporaryRoot, extensionId);
  try {
    await fs.cp(extension.packageDirectory, copiedPackage, { recursive: true });
    await fs.writeFile(path.join(copiedPackage, 'undeclared.txt'), 'not signed\n', 'utf8');
    await assert.rejects(
      verifyPackageDirectory(copiedPackage, extension),
      /missing, undeclared, or non-regular files/,
    );
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
});
