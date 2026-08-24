import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

let formatConfigGeneratorValidationLocation;
let presentConfigGeneratorIssue;

const messages = {
  'configGenerator.health.fields.configuration': '配置项',
  'configGenerator.health.fields.targetOptions': '客户端专属选项',
  'configGenerator.health.fields.member': '第 {number} 个策略成员',
  'configGenerator.health.fields.includedGroup': '第 {number} 个引用策略组',
  'configGenerator.health.fields.subnetRule': '第 {number} 条子网规则',
  'configGenerator.health.fields.ruleSetNamed': '引用规则集「{name}」',
  'configGenerator.health.fields.ruleSet': '引用规则集',
  'configGenerator.health.fields.policy': '引用策略',
  'configGenerator.health.fields.value': '内容',
  'configGenerator.health.fields.name': '名称',
  'configGenerator.health.fields.sourceUrl': '来源 URL',
  'configGenerator.health.locations.withField': '{location} · {field}',
  'configGenerator.health.locations.ruleNamed': '规则「{name}」',
  'configGenerator.health.locations.ruleIndexed': '第 {number} 条规则（{name}）',
  'configGenerator.health.locations.groupNamed': '策略组「{name}」',
  'configGenerator.health.locations.groupIndexed': '第 {number} 个策略组',
  'configGenerator.health.locations.ruleSetNamed': '规则集「{name}」',
  'configGenerator.health.locations.ruleSetIndexed': '第 {number} 个规则集',
  'configGenerator.health.locations.sourceNamed': '节点来源「{name}」',
  'configGenerator.health.locations.sourceIndexed': '第 {number} 个节点来源',
  'configGenerator.health.locations.processNamed': '响应转换器「{name}」',
  'configGenerator.health.locations.processIndexed': '第 {number} 个响应转换器',
  'configGenerator.health.locations.project': '项目设置',
  'configGenerator.health.locations.ruleSets': '规则集列表',
  'configGenerator.health.locations.rules': '规则列表',
  'configGenerator.health.locations.groups': '策略组列表',
  'configGenerator.health.locations.sources': '节点来源列表',
  'configGenerator.health.locations.outputs': '客户端独立配置',
  'configGenerator.health.locations.configuration': '当前配置',
  'configGenerator.health.locations.output': '{target} 独立配置',
  'configGenerator.validation.messages.missingRuleSet': '引用的规则集不存在。',
  'configGenerator.validation.messages.missingPolicyGroup': '引用的策略组不存在。',
  'configGenerator.validation.messages.required': '该字段不能为空。',
  'configGenerator.validation.suggestions.reference': '重新选择现有且已启用的项目。',
  'configGenerator.validation.suggestions.required': '填写有效内容后重新保存。',
  'configGenerator.validation.suggestions.generic': '返回编辑器检查该位置。',
};

const t = (key, params = {}) => {
  let value = messages[key] || key;
  return Object.entries(params).reduce(
    (text, [name, replacement]) => text.replaceAll(`{${name}}`, String(replacement)),
    value,
  );
};

before(async () => {
  const moduleUrl = new URL(
    '../frontend/src/extensions/config-generator/domain/diagnosticPresentation.ts',
    import.meta.url,
  );
  const source = await readFile(moduleUrl, 'utf8');
  const transformed = await transformWithEsbuild(source, fileURLToPath(moduleUrl), {
    format: 'esm',
    loader: 'ts',
    target: 'es2020',
  });
  const executableUrl = `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`;
  ({ formatConfigGeneratorValidationLocation, presentConfigGeneratorIssue } = await import(executableUrl));
});

test('turns indexed RULE-SET paths into a named, actionable location', () => {
  const project = {
    rules: [{ kind: 'remote', name: '广告规则', ruleSet: 'ads', policy: 'REJECT' }],
    groups: [],
    remoteProxySources: [],
  };
  const result = presentConfigGeneratorIssue(
    { path: 'rules[0].ruleSet', message: 'references a missing rule set' },
    { t, project, ruleSets: [] },
  );

  assert.equal(result.location, '规则「广告规则」 · 引用规则集「ads」');
  assert.equal(result.message, '引用的规则集不存在。');
  assert.equal(result.technicalPath, 'rules[0].ruleSet');
});

test('labels policy-group member indexes and preserves a technical fallback', () => {
  const result = presentConfigGeneratorIssue(
    { path: 'groups[0].members[1].value', message: 'references a missing policy group' },
    {
      t,
      project: {
        groups: [{ name: '主策略', members: [] }],
        rules: [],
        remoteProxySources: [],
      },
      ruleSets: [],
    },
  );

  assert.equal(result.location, '策略组「主策略」 · 第 2 个策略成员 · 内容');
  assert.equal(result.message, '引用的策略组不存在。');
  assert.match(result.suggestion, /重新选择/);
});

test('supports rule-set scoped errors from rule-set save operations', () => {
  const location = formatConfigGeneratorValidationLocation(
    'source.url',
    { t, project: null, ruleSets: [] },
    { kind: 'ruleSet', name: '广告规则' },
  );

  assert.equal(location, '规则集「广告规则」 · 来源 URL');
});
