import { diagnostic } from '../diagnostics';

export const CANONICAL_TYPE = Object.freeze({
    domain: 'DOMAIN',
    'domain-suffix': 'DOMAIN-SUFFIX',
    'domain-keyword': 'DOMAIN-KEYWORD',
    'ip-cidr': 'IP-CIDR',
    'ip-cidr6': 'IP-CIDR6',
    geoip: 'GEOIP',
    'ip-asn': 'IP-ASN',
    'process-name': 'PROCESS-NAME',
    'process-path': 'PROCESS-PATH',
    'url-regex': 'URL-REGEX',
    'user-agent': 'USER-AGENT',
    'dst-port': 'DEST-PORT',
    'src-port': 'SRC-PORT',
    'src-ip-cidr': 'SRC-IP',
    protocol: 'PROTOCOL',
    network: 'NETWORK',
    logical: 'LOGICAL',
});

export function exact(rule, line, extraDiagnostics = []) {
    return {
        disposition: 'exact',
        line,
        diagnostics: extraDiagnostics,
        rule,
    };
}

export function fallback(rule, line, code, message) {
    return {
        disposition: 'fallback',
        line,
        diagnostics: [diagnostic({
            severity: 'warning',
            code,
            message,
            sourceLine: rule.source.line,
            path: `sources.${rule.source.sourceId}`,
            disposition: 'fallback',
        })],
        rule,
    };
}

export function filtered(rule, code, message) {
    return {
        disposition: 'filtered',
        line: null,
        diagnostics: [diagnostic({
            severity: 'warning',
            code,
            message,
            sourceLine: rule.source.line,
            path: `sources.${rule.source.sourceId}`,
            disposition: 'filtered',
        })],
        rule,
    };
}

export function lineWithOptions(type, rule) {
    const parts = [type, rule.value];
    if (rule.options?.includes('no-resolve')) parts.push('no-resolve');
    return parts.join(',');
}

export function commentLines(rule, prefix = '#') {
    return rule.comment ? [`${prefix} ${rule.comment}`] : [];
}

export function serializeProjectedRules(rules, projector, { commentPrefix = '#' } = {}) {
    const lines = [];
    const diagnostics = [];
    const stats = { exact: 0, fallback: 0, filtered: 0, invalid: 0 };
    for (const rule of rules) {
        const result = projector(rule);
        stats[result.disposition] += 1;
        diagnostics.push(...result.diagnostics);
        if (!result.line) continue;
        lines.push(...commentLines(rule, commentPrefix), result.line);
    }
    return { lines, diagnostics, stats };
}
