import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDigestContentPackage } from './content-package.mjs';
import {
  assert,
  pathExists,
  repoRoot,
  writeJson,
} from './lib.mjs';

const extensionIdPattern = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z0-9][a-z0-9.-]*$/;
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const reservedSegments = new Set([
  'runtime',
  'catalog',
  'installed',
  'tasks',
  'artifact-sources',
  'output-targets',
]);

const jsonText = value => `${JSON.stringify(value, null, 2)}\n`;

export const buildContentExtensionScaffold = ({
  id,
  name,
  description = `${name} 内容扩展`,
  version = '0.1.0',
  publisherId = id?.split('.').slice(0, -1).join('.'),
  publisherName = publisherId,
  createdAt = new Date().toISOString(),
}) => {
  assert(extensionIdPattern.test(id || ''), 'Extension id must use reverse-domain notation');
  assert(!id.split('.').some(segment => reservedSegments.has(segment)), 'Extension id contains a reserved segment');
  assert(name?.trim(), 'Extension name is required');
  assert(description?.trim(), 'Extension description is required');
  assert(versionPattern.test(version), 'Extension version must be semver-like');
  assert(publisherId?.trim() && publisherName?.trim(), 'Publisher id and name are required');
  const timestamp = new Date(createdAt);
  assert(Number.isFinite(timestamp.getTime()), 'createdAt must be a valid ISO date');
  const stableCreatedAt = timestamp.toISOString();
  const variant = {
    delivery: 'content',
    implementationId: `${id}@1/node`,
    implementationAbi: 'content@1',
    containsExecutableCode: false,
  };
  const manifest = {
    schemaVersion: 1,
    id,
    kind: 'content',
    distribution: 'store',
    name: name.trim(),
    description: description.trim(),
    version,
    publisher: {
      id: publisherId.trim(),
      name: publisherName.trim(),
    },
    host: {
      apiVersion: '1.0.0',
      backend: '>=2.36.31',
      runtimes: ['node'],
    },
    variants: { node: variant },
    permissions: [],
    contributes: {},
    scriptExecutionLanes: {},
  };
  const content = {
    schemaVersion: 1,
    id,
    name: name.trim(),
    description: description.trim(),
    version,
    author: {
      id: publisherId.trim(),
      name: publisherName.trim(),
    },
  };
  const contentText = jsonText(content);
  const packageValue = createDigestContentPackage({
    manifest,
    files: { 'content/extension.json': contentText },
    selectedVariant: 'node',
    source: 'community-repository',
    createdAt: stableCreatedAt,
    keyId: `community-${id}`,
  });
  const extensionConfig = {
    schemaVersion: 1,
    id,
    manifest: 'manifest.json',
    packageDirectory: `packages/${id}`,
    signature: {
      algorithm: 'sha256-digest',
      keyId: `community-${id}`,
    },
    package: {
      variant: 'node',
      source: 'community-repository',
      createdAt: stableCreatedAt,
    },
    contentFiles: [
      {
        source: 'content/extension.json',
        package: 'content/extension.json',
      },
    ],
    repository: {
      distribution: 'community',
      author: manifest.publisher,
    },
  };
  const workspacePackage = {
    name: id,
    version,
    private: true,
    description: description.trim(),
    type: 'module',
  };
  const readme = `# ${name.trim()}\n\n${description.trim()}\n\n该目录是集合仓库中的一个独立 content 扩展。源码位于 \`content/\`，生成后的完整性包位于根目录 \`packages/${id}/\`。\n\n常用命令：\n\n\`\`\`bash\ncorepack pnpm package -- --extension ${id}\ncorepack pnpm repository\ncorepack pnpm verify\n\`\`\`\n\ncontent 扩展不能执行前端或后端 JavaScript。若需要可执行能力，必须为该扩展单独设计 Host SDK 权限、签名密钥和官方授权。\n`;
  return {
    manifest,
    extensionConfig,
    workspacePackage,
    contentText,
    packageValue,
    readme,
  };
};

export const createContentExtension = async ({ rootDirectory = repoRoot, ...options }) => {
  const scaffold = buildContentExtensionScaffold(options);
  const extensionDirectory = path.join(rootDirectory, 'extensions', scaffold.manifest.id);
  const packageDirectory = path.join(rootDirectory, 'packages', scaffold.manifest.id);
  assert(!(await pathExists(extensionDirectory)), `Extension workspace already exists: ${scaffold.manifest.id}`);
  assert(!(await pathExists(packageDirectory)), `Extension package already exists: ${scaffold.manifest.id}`);

  await fs.mkdir(path.join(extensionDirectory, 'content'), { recursive: true });
  await fs.mkdir(path.join(packageDirectory, 'content'), { recursive: true });
  await writeJson(path.join(extensionDirectory, 'extension.config.json'), scaffold.extensionConfig);
  await writeJson(path.join(extensionDirectory, 'manifest.json'), scaffold.manifest);
  await writeJson(path.join(extensionDirectory, 'package.json'), scaffold.workspacePackage);
  await fs.writeFile(path.join(extensionDirectory, 'README.md'), scaffold.readme, 'utf8');
  await fs.writeFile(path.join(extensionDirectory, 'content', 'extension.json'), scaffold.contentText, 'utf8');
  await writeJson(path.join(packageDirectory, 'manifest.json'), scaffold.packageValue.manifest);
  await writeJson(path.join(packageDirectory, 'receipt.json'), scaffold.packageValue.receipt);
  await writeJson(path.join(packageDirectory, 'package.json'), scaffold.packageValue.metadata);
  await fs.writeFile(path.join(packageDirectory, 'content', 'extension.json'), scaffold.contentText, 'utf8');
  return { extensionDirectory, packageDirectory, scaffold };
};

const valueAfter = (args, name) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const usage = `Create a content-only extension inside this multi-extension repository.\n\nUsage:\n  corepack pnpm extension:create -- \\\n    --id com.example.my-extension \\\n    --name "My Extension" \\\n    --publisher-id com.example \\\n    --publisher-name "Example"\n`;

const main = async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    process.stdout.write(usage);
    return;
  }
  const id = valueAfter(args, '--id');
  const name = valueAfter(args, '--name');
  const result = await createContentExtension({
    id,
    name,
    description: valueAfter(args, '--description') || undefined,
    version: valueAfter(args, '--version') || undefined,
    publisherId: valueAfter(args, '--publisher-id') || undefined,
    publisherName: valueAfter(args, '--publisher-name') || undefined,
  });
  process.stdout.write(`Created ${result.scaffold.manifest.id}\n`);
  process.stdout.write(`${path.relative(repoRoot, result.extensionDirectory)}\n`);
  process.stdout.write(`${path.relative(repoRoot, result.packageDirectory)}\n`);
  process.stdout.write('Run corepack pnpm install, then corepack pnpm check.\n');
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
}
