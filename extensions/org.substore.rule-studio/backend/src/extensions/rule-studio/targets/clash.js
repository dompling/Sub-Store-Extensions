import { stringify as stringifyYaml } from 'yaml';
import { diagnostic } from '../diagnostics';
import { RuleStudioError } from '../errors';
import { CANONICAL_TYPE } from './common';

const CLASSICAL_TYPES = new Set([
    'domain',
    'domain-suffix',
    'domain-keyword',
    'ip-cidr',
    'ip-cidr6',
    'geoip',
    'ip-asn',
    'process-name',
    'process-path',
    'network',
    'dst-port',
    'src-port',
    'src-ip-cidr',
]);
const DOMAIN_TYPES = new Set(['domain', 'domain-suffix', 'domain-keyword']);
const IPCIDR_TYPES = new Set(['ip-cidr', 'ip-cidr6']);

function classicalLine(rule) {
    const type = CANONICAL_TYPE[rule.type];
    if (!type) return null;
    const options = rule.options?.includes('no-resolve') ? ',no-resolve' : '';
    return `${type},${rule.value}${options}`;
}

function filteredDiagnostic(rule) {
    return diagnostic({
        severity: 'warning',
        code: 'CLASH_RULE_UNSUPPORTED',
        message: `Clash rule-provider 不支持 ${rule.type}`,
        sourceLine: rule.source.line,
        path: `sources.${rule.source.sourceId}`,
        disposition: 'filtered',
    });
}

function classicalPayload(rules) {
    const payload = [];
    const diagnostics = [];
    const stats = { exact: 0, fallback: 0, filtered: 0, invalid: 0 };
    for (const rule of rules) {
        if (!CLASSICAL_TYPES.has(rule.type)) {
            stats.filtered += 1;
            diagnostics.push(filteredDiagnostic(rule));
            continue;
        }
        stats.exact += 1;
        payload.push(classicalLine(rule));
    }
    return { payload, diagnostics, stats };
}

export function serializeClashClassical(rules, format = 'yaml') {
    const result = classicalPayload(rules);
    return {
        ...result,
        body: format === 'text'
            ? `${result.payload.join('\n')}\n`
            : stringifyYaml({ payload: result.payload }, { lineWidth: 0 }),
    };
}

export function serializeClashDomain(rules) {
    if (!rules.length || rules.some(rule => !DOMAIN_TYPES.has(rule.type))) {
        throw new RuleStudioError(
            'RESOURCE_REPRESENTATION_UNSUPPORTED',
            'Clash domain provider 只能包含域名类规则',
            undefined,
            400,
        );
    }
    const payload = rules.map(rule => {
        if (rule.type === 'domain') return rule.value;
        if (rule.type === 'domain-suffix') return `+.${rule.value}`;
        return `*${rule.value}*`;
    });
    const fallbackCount = rules.filter(rule => rule.type === 'domain-keyword').length;
    return {
        body: stringifyYaml({ payload }, { lineWidth: 0 }),
        payload,
        stats: {
            exact: rules.length - fallbackCount,
            fallback: fallbackCount,
            filtered: 0,
            invalid: 0,
        },
        diagnostics: rules
            .filter(rule => rule.type === 'domain-keyword')
            .map(rule => diagnostic({
                severity: 'warning',
                code: 'CLASH_DOMAIN_KEYWORD_FALLBACK',
                message: 'DOMAIN-KEYWORD 已转换为 Clash domain 通配表达式',
                sourceLine: rule.source.line,
                path: `sources.${rule.source.sourceId}`,
                disposition: 'fallback',
            })),
    };
}

export function serializeClashIpcidr(rules) {
    if (!rules.length || rules.some(rule => !IPCIDR_TYPES.has(rule.type))) {
        throw new RuleStudioError(
            'RESOURCE_REPRESENTATION_UNSUPPORTED',
            'Clash ipcidr provider 只能包含 IPv4/IPv6 CIDR 规则',
            undefined,
            400,
        );
    }
    const payload = rules.map(rule => rule.value);
    return {
        body: stringifyYaml({ payload }, { lineWidth: 0 }),
        payload,
        stats: { exact: rules.length, fallback: 0, filtered: 0, invalid: 0 },
        diagnostics: [],
    };
}
