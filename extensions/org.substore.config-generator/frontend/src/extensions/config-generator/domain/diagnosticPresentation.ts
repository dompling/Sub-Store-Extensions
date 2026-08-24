type ConfigGeneratorTranslator = (
  key: string,
  params?: Record<string, unknown>,
) => unknown;

type ValidationIssueScope = {
  kind?: string;
  name?: string;
};

type ValidationIssue = {
  path?: string;
  line?: number;
  message?: string;
  reason?: string;
  code?: string;
  scope?: ValidationIssueScope;
};

type PresentationContext = {
  t: ConfigGeneratorTranslator;
  project?: ConfigProject | null;
  ruleSets?: RemoteRuleSet[];
};

export type PresentedConfigGeneratorIssue = {
  location: string;
  message: string;
  suggestion: string;
  technicalPath: string;
  technicalMessage: string;
};

const targetNames: Record<string, string> = {
  surge: 'Surge',
  qx: 'Quantumult X',
  clash: 'Clash',
  loon: 'Loon',
};

const fieldKeys: Record<string, string> = {
  name: 'name',
  displayName: 'displayName',
  remark: 'remark',
  kind: 'kind',
  type: 'type',
  value: 'value',
  text: 'comment',
  policy: 'policy',
  ruleSet: 'ruleSet',
  members: 'members',
  includeAllProxies: 'includeAllProxies',
  includeOtherGroups: 'includeOtherGroups',
  nodeNameRegex: 'nodeNameRegex',
  remoteProxySource: 'remoteProxySource',
  testUrl: 'testUrl',
  interval: 'interval',
  tolerance: 'tolerance',
  timeout: 'timeout',
  policyUpdateInterval: 'policyUpdateInterval',
  iconUrl: 'iconUrl',
  disabled: 'disabled',
  hidden: 'hidden',
  noAlert: 'noAlert',
  evaluateBeforeUse: 'evaluateBeforeUse',
  persistent: 'persistent',
  aliveChecking: 'aliveChecking',
  resourceTagRegex: 'resourceTagRegex',
  noResolve: 'noResolve',
  dnsFailed: 'dnsFailed',
  independentConfig: 'independentConfig',
  publicBaseUrl: 'publicBaseUrl',
  'delivery.publicBaseUrl': 'publicBaseUrl',
  source: 'source',
  'source.kind': 'sourceType',
  'source.mode': 'sourceMode',
  'source.url': 'sourceUrl',
  'source.target': 'sourceTarget',
  'source.ref': 'resourceReference',
  'source.value': 'sourceValue',
  'source.expectedContract': 'expectedContract',
  enabled: 'enabled',
  updateInterval: 'updateInterval',
  targetOptions: 'targetOptions',
  outputs: 'outputs',
  args: 'transformerArgs',
  id: 'transformerId',
  optParser: 'optParser',
  behavior: 'behavior',
  format: 'format',
  algorithm: 'algorithm',
  subnetDefault: 'subnetDefault',
  expression: 'expression',
};

const translated = (
  t: ConfigGeneratorTranslator,
  key: string,
  params?: Record<string, unknown>,
) => String(t(key, params));

const targetLabel = (target?: string) => targetNames[target || ''] || String(target || '');

export const formatConfigGeneratorFieldLabel = (
  field: string,
  t: ConfigGeneratorTranslator,
  resolveTargetLabel: (target?: ConfigGeneratorTarget) => string = target => targetLabel(target),
): string => {
  if (!field) return '';
  const targetOption = /^targetOptions\.(surge|qx|clash|loon)(?:\.(.*))?$/.exec(field);
  if (targetOption) {
    const target = targetOption[1] as ConfigGeneratorTarget;
    const nested = targetOption[2]
      ? formatConfigGeneratorFieldLabel(targetOption[2], t, resolveTargetLabel)
      : translated(t, 'configGenerator.health.fields.targetOptions');
    return translated(t, 'configGenerator.health.locations.withField', {
      location: resolveTargetLabel(target),
      field: nested,
    });
  }
  const member = /^members\[(\d+)](?:\.(.*))?$/.exec(field);
  if (member) {
    const location = translated(t, 'configGenerator.health.fields.member', {
      number: Number(member[1]) + 1,
    });
    return member[2]
      ? translated(t, 'configGenerator.health.locations.withField', {
        location,
        field: formatConfigGeneratorFieldLabel(member[2], t, resolveTargetLabel),
      })
      : location;
  }
  const includedGroup = /^includeOtherGroups\[(\d+)](?:\.(.*))?$/.exec(field);
  if (includedGroup) {
    const location = translated(t, 'configGenerator.health.fields.includedGroup', {
      number: Number(includedGroup[1]) + 1,
    });
    return includedGroup[2]
      ? translated(t, 'configGenerator.health.locations.withField', {
        location,
        field: formatConfigGeneratorFieldLabel(includedGroup[2], t, resolveTargetLabel),
      })
      : location;
  }
  const subnetRule = /^subnetRules\[(\d+)](?:\.(.*))?$/.exec(field);
  if (subnetRule) {
    const location = translated(t, 'configGenerator.health.fields.subnetRule', {
      number: Number(subnetRule[1]) + 1,
    });
    return subnetRule[2]
      ? translated(t, 'configGenerator.health.locations.withField', {
        location,
        field: formatConfigGeneratorFieldLabel(subnetRule[2], t, resolveTargetLabel),
      })
      : location;
  }
  const directKey = fieldKeys[field];
  if (directKey) return translated(t, `configGenerator.health.fields.${directKey}`);
  const finalSegment = field.split('.').pop() || '';
  const fallbackKey = fieldKeys[finalSegment];
  return translated(
    t,
    fallbackKey
      ? `configGenerator.health.fields.${fallbackKey}`
      : 'configGenerator.health.fields.configuration',
  );
};

const normalizedName = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const ruleFallbackName = (rule?: RuleBinding) => {
  if (!rule) return '';
  if (rule.kind === 'remote') return 'RULE-SET';
  if (rule.kind === 'inline') return rule.type || 'RULE';
  if (rule.kind === 'final') return 'FINAL';
  if (rule.kind === 'comment') return '#';
  return '';
};

const entityAndField = (
  path: string,
  context: PresentationContext,
  scope?: ValidationIssueScope,
) => {
  const { t, project, ruleSets = [] } = context;
  if (scope?.kind === 'ruleSet') {
    return {
      entity: scope.name
        ? translated(t, 'configGenerator.health.locations.ruleSetNamed', { name: scope.name })
        : translated(t, 'configGenerator.health.locations.ruleSets'),
      field: path,
    };
  }

  const indexed = /^(rules|groups|ruleSets|remoteProxySources|process)\[(\d+)](?:\.(.*))?$/.exec(path);
  if (indexed) {
    const collection = indexed[1];
    const index = Number(indexed[2]);
    const field = indexed[3] || '';
    if (collection === 'rules') {
      const rule = project?.rules?.[index];
      const explicitName = normalizedName(rule?.kind === 'remote' ? rule.name : undefined);
      return {
        entity: explicitName
          ? translated(t, 'configGenerator.health.locations.ruleNamed', { name: explicitName })
          : translated(t, 'configGenerator.health.locations.ruleIndexed', {
            number: index + 1,
            name: ruleFallbackName(rule) || translated(t, 'configGenerator.health.fields.configuration'),
          }),
        field: field === 'ruleSet' && rule?.kind === 'remote' && rule.ruleSet
          ? translated(t, 'configGenerator.health.fields.ruleSetNamed', { name: rule.ruleSet })
          : field,
        fieldIsLabel: field === 'ruleSet' && rule?.kind === 'remote' && Boolean(rule.ruleSet),
      };
    }
    if (collection === 'groups') {
      const name = normalizedName(project?.groups?.[index]?.name);
      return {
        entity: name
          ? translated(t, 'configGenerator.health.locations.groupNamed', { name })
          : translated(t, 'configGenerator.health.locations.groupIndexed', { number: index + 1 }),
        field,
      };
    }
    if (collection === 'ruleSets') {
      const name = normalizedName(ruleSets[index]?.name);
      return {
        entity: name
          ? translated(t, 'configGenerator.health.locations.ruleSetNamed', { name })
          : translated(t, 'configGenerator.health.locations.ruleSetIndexed', { number: index + 1 }),
        field,
      };
    }
    if (collection === 'remoteProxySources') {
      const name = normalizedName(project?.remoteProxySources?.[index]?.name);
      return {
        entity: name
          ? translated(t, 'configGenerator.health.locations.sourceNamed', { name })
          : translated(t, 'configGenerator.health.locations.sourceIndexed', { number: index + 1 }),
        field,
      };
    }
    const process = project?.process?.[index];
    const name = normalizedName(process?.customName) || normalizedName(process?.type);
    return {
      entity: name
        ? translated(t, 'configGenerator.health.locations.processNamed', { name })
        : translated(t, 'configGenerator.health.locations.processIndexed', { number: index + 1 }),
      field,
    };
  }

  const output = /^outputs\.(surge|qx|clash|loon)(?:\.(.*))?$/.exec(path);
  if (output) {
    return {
      entity: translated(t, 'configGenerator.health.locations.output', {
        target: targetLabel(output[1]),
      }),
      field: output[2] || '',
    };
  }

  const collectionLocations: Record<string, string> = {
    rules: 'rules',
    groups: 'groups',
    ruleSets: 'ruleSets',
    remoteProxySources: 'sources',
    outputs: 'outputs',
  };
  if (collectionLocations[path]) {
    return {
      entity: translated(
        t,
        `configGenerator.health.locations.${collectionLocations[path]}`,
      ),
      field: '',
    };
  }

  return {
    entity: translated(t, 'configGenerator.health.locations.project'),
    field: path,
  };
};

export const formatConfigGeneratorValidationLocation = (
  path: string,
  context: PresentationContext,
  scope?: ValidationIssueScope,
) => {
  const { entity, field, fieldIsLabel } = entityAndField(path, context, scope);
  const fieldLabel = fieldIsLabel
    ? field
    : formatConfigGeneratorFieldLabel(field, context.t);
  return fieldLabel
    ? translated(context.t, 'configGenerator.health.locations.withField', {
      location: entity,
      field: fieldLabel,
    })
    : entity;
};

const localizedTarget = (value: string) => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'quantumult x' || normalized === 'qx') return 'Quantumult X';
  if (normalized === 'surge') return 'Surge';
  if (normalized === 'clash') return 'Clash';
  if (normalized === 'loon') return 'Loon';
  return value;
};

const localizedValidationMessage = (rawMessage: string, t: ConfigGeneratorTranslator) => {
  const exactMessages: Record<string, [string, string]> = {
    'must be a non-empty string': ['required', 'required'],
    'must be unique': ['duplicate', 'unique'],
    'must be an absolute HTTP(S) URL': ['absoluteHttpUrl', 'url'],
    'must be an absolute HTTP(S) URL for automatic conversion': ['absoluteHttpUrl', 'url'],
    'must be an absolute URL': ['absoluteUrl', 'url'],
    'is unsupported': ['unsupported', 'supportedValue'],
    'must be a boolean': ['boolean', 'supportedValue'],
    'must be a positive integer': ['positiveInteger', 'supportedValue'],
    'must be a non-negative integer': ['nonNegativeInteger', 'supportedValue'],
    'must be a non-zero integer': ['nonZeroInteger', 'supportedValue'],
    'must be a string': ['string', 'supportedValue'],
    'must be an array': ['array', 'supportedValue'],
    'must be an object': ['object', 'supportedValue'],
    'references a missing policy group': ['missingPolicyGroup', 'reference'],
    'references a missing rule set': ['missingRuleSet', 'reference'],
    'references a missing remote proxy source': ['missingRemoteSource', 'reference'],
    'group references must be acyclic': ['groupCycle', 'cycle'],
    'only blank rules may follow FINAL': ['afterFinal', 'ruleOrder'],
    'must not contain commas or line breaks': ['ruleNameCharacters', 'supportedValue'],
    'cannot be combined with remoteProxySource': ['incompatibleCombination', 'compatibility'],
    'conditional policy references are only supported by ssid groups': ['conditionalOnly', 'compatibility'],
    'must contain a condition and policy separated by a colon': ['conditionPolicyFormat', 'supportedValue'],
    'must end with the referenced policy': ['policyEnding', 'reference'],
  };
  const exact = exactMessages[rawMessage];
  if (exact) {
    return {
      message: translated(t, `configGenerator.validation.messages.${exact[0]}`),
      suggestion: translated(t, `configGenerator.validation.suggestions.${exact[1]}`),
    };
  }

  let match = /^references policy group (.+), which is disabled for (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.policyGroupDisabled', {
        name: match[1],
        target: localizedTarget(match[2]),
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.reference'),
    };
  }
  match = /^references policy group (.+), whose (.+) type is unsupported by (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.policyGroupUnsupported', {
        name: match[1],
        type: match[2],
        target: localizedTarget(match[3]),
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.compatibility'),
    };
  }
  match = /^references rule set (.+), which is disabled for (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.ruleSetDisabled', {
        name: match[1],
        target: localizedTarget(match[2]),
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.reference'),
    };
  }
  match = /^rule set (.+) cannot be emitted for (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.ruleSetUnsupported', {
        name: match[1],
        target: localizedTarget(match[2]),
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.compatibility'),
    };
  }
  match = /^references a remote proxy source that is disabled for (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.remoteSourceDisabled', {
        target: localizedTarget(match[1]),
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.reference'),
    };
  }
  match = /^references a remote proxy source that is not compatible with (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.remoteSourceIncompatible', {
        target: localizedTarget(match[1]),
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.compatibility'),
    };
  }
  match = /^must contain .+ output$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.outputsRequired'),
      suggestion: translated(t, 'configGenerator.validation.suggestions.output'),
    };
  }
  match = /^must be (.+)$/.exec(rawMessage);
  if (match) {
    return {
      message: translated(t, 'configGenerator.validation.messages.allowedValue', {
        value: match[1],
      }),
      suggestion: translated(t, 'configGenerator.validation.suggestions.supportedValue'),
    };
  }
  if (/not compatible|does not support|cannot be represented|select explicit target ownership/i.test(rawMessage)) {
    return {
      message: translated(t, 'configGenerator.validation.messages.targetCompatibility'),
      suggestion: translated(t, 'configGenerator.validation.suggestions.compatibility'),
    };
  }
  return {
    message: rawMessage,
    suggestion: translated(t, 'configGenerator.validation.suggestions.generic'),
  };
};

const issueFrom = (value: unknown): ValidationIssue => {
  if (typeof value === 'string') return { message: value };
  if (!value || typeof value !== 'object') return { message: String(value ?? '') };
  return value as ValidationIssue;
};

export const presentConfigGeneratorIssue = (
  value: unknown,
  context: PresentationContext,
): PresentedConfigGeneratorIssue | null => {
  const issue = issueFrom(value);
  const rawMessage = normalizedName(issue.message)
    || normalizedName(issue.reason)
    || normalizedName(issue.code);
  if (!rawMessage) return null;
  const path = normalizedName(issue.path);
  const technicalPath = path && issue.line
    ? `${path}:${issue.line}`
    : path || (issue.line ? `:${issue.line}` : '');
  const localized = localizedValidationMessage(rawMessage, context.t);
  return {
    location: path || issue.scope
      ? formatConfigGeneratorValidationLocation(path, context, issue.scope)
      : '',
    message: localized.message,
    suggestion: localized.suggestion,
    technicalPath,
    technicalMessage: rawMessage,
  };
};
