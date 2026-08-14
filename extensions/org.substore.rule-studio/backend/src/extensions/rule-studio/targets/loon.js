import {
    CANONICAL_TYPE,
    exact,
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
    'url-regex',
    'user-agent',
    'dst-port',
    'src-port',
    'src-ip-cidr',
]);

function project(rule) {
    if (EXACT_TYPES.has(rule.type)) {
        return exact(rule, lineWithOptions(CANONICAL_TYPE[rule.type], rule));
    }
    return filtered(rule, 'LOON_RULE_UNSUPPORTED', `Loon 远程规则不支持 ${rule.type}`);
}

export function serializeLoonRuleList(rules) {
    return serializeProjectedRules(rules, project, { commentPrefix: '#' });
}
