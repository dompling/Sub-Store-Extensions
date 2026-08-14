import {
    CANONICAL_TYPE,
    exact,
    fallback,
    filtered,
    lineWithOptions,
    serializeProjectedRules,
} from './common';

const EXACT_TYPES = new Set([
    'domain',
    'domain-suffix',
    'domain-keyword',
    'ip-cidr',
    'ip-cidr6',
    'geoip',
    'ip-asn',
    'process-name',
    'process-path',
    'url-regex',
    'user-agent',
    'dst-port',
    'src-port',
    'src-ip-cidr',
    'protocol',
    'network',
]);

function project(rule) {
    if (EXACT_TYPES.has(rule.type)) {
        return exact(rule, lineWithOptions(CANONICAL_TYPE[rule.type], rule));
    }
    if (rule.type === 'logical' && rule.source.raw) {
        return fallback(rule, rule.source.raw, 'SURGE_LOGICAL_RULE_PRESERVED', '逻辑规则按来源文本保留，请确认 Surge 版本支持');
    }
    return filtered(rule, 'SURGE_RULE_UNSUPPORTED', `Surge 规则集不支持 ${rule.type}`);
}

export function serializeSurgeRuleList(rules) {
    return serializeProjectedRules(rules, project, { commentPrefix: '#' });
}
