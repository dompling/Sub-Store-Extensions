import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';
import { diagnostic } from '../diagnostics';

const TYPE_ALIASES = Object.freeze({
    DOMAIN: 'domain',
    HOST: 'domain',
    'DOMAIN-SUFFIX': 'domain-suffix',
    'HOST-SUFFIX': 'domain-suffix',
    'DOMAIN-KEYWORD': 'domain-keyword',
    'HOST-KEYWORD': 'domain-keyword',
    'IP-CIDR': 'ip-cidr',
    'IP-CIDR6': 'ip-cidr6',
    'IP6-CIDR': 'ip-cidr6',
    GEOIP: 'geoip',
    'IP-ASN': 'ip-asn',
    'PROCESS-NAME': 'process-name',
    'PROCESS-PATH': 'process-path',
    'URL-REGEX': 'url-regex',
    'USER-AGENT': 'user-agent',
    'DST-PORT': 'dst-port',
    'DEST-PORT': 'dst-port',
    'SRC-PORT': 'src-port',
    'SRC-IP': 'src-ip-cidr',
    'SRC-IP-CIDR': 'src-ip-cidr',
    PROTOCOL: 'protocol',
    NETWORK: 'network',
    AND: 'logical',
    OR: 'logical',
    NOT: 'logical',
});

const DOMAIN_TYPES = new Set(['domain', 'domain-suffix']);
const CIDR_TYPES = new Set(['ip-cidr', 'ip-cidr6', 'src-ip-cidr']);
const NUMBER_TYPES = new Set(['dst-port', 'src-port', 'ip-asn']);
const SEMANTIC_OPTIONS = new Set(['no-resolve', 'extended-matching']);

function normalizeIpv4Cidr(value) {
    const [address, prefixText] = value.split('/');
    const prefix = Number(prefixText);
    if (isIP(address) !== 4 || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
    const parts = address.split('.').map(Number);
    let number = (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    number &= mask;
    return `${[(number >>> 24) & 255, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join('.')}/${prefix}`;
}

function normalizeCidr(value, expectedVersion) {
    const [address, prefixText, ...rest] = `${value || ''}`.trim().split('/');
    if (rest.length || prefixText === undefined) return null;
    const version = isIP(address);
    const prefix = Number(prefixText);
    if (version !== expectedVersion || !Number.isInteger(prefix)) return null;
    if (version === 4) return normalizeIpv4Cidr(`${address}/${prefix}`);
    if (prefix < 0 || prefix > 128) return null;
    return `${address.toLowerCase()}/${prefix}`;
}

function normalizeDomain(value) {
    const trimmed = `${value || ''}`.trim().replace(/^\+\./, '').replace(/^\./, '');
    if (!trimmed || /[\s/,]/.test(trimmed)) return null;
    const ascii = domainToASCII(trimmed.toLowerCase());
    return ascii && ascii.includes('.') ? ascii : null;
}

function normalizeValue(type, value) {
    if (DOMAIN_TYPES.has(type)) return normalizeDomain(value);
    if (type === 'domain-keyword') return `${value || ''}`.trim().toLowerCase() || null;
    if (type === 'ip-cidr' || type === 'src-ip-cidr') return normalizeCidr(value, 4);
    if (type === 'ip-cidr6') return normalizeCidr(value, 6);
    if (NUMBER_TYPES.has(type)) {
        const number = Number(value);
        if (!Number.isInteger(number) || number < 0 || (type !== 'ip-asn' && number > 65535)) return null;
        return `${number}`;
    }
    if (type === 'geoip') return `${value || ''}`.trim().toUpperCase() || null;
    return `${value || ''}`.trim() || null;
}

export function normalizeParsedRule(parsed) {
    const rawType = `${parsed.rawType || ''}`.trim().toUpperCase();
    const type = TYPE_ALIASES[rawType];
    if (!type) {
        return {
            rule: null,
            diagnostics: [diagnostic({
                severity: 'error',
                code: 'RULE_TYPE_UNSUPPORTED',
                message: `不识别规则类型 ${rawType || '(empty)'}`,
                sourceLine: parsed.source.line,
                path: `sources.${parsed.source.sourceId}`,
                disposition: 'invalid',
            })],
        };
    }
    const value = normalizeValue(type, parsed.value);
    if (!value) {
        return {
            rule: null,
            diagnostics: [diagnostic({
                severity: 'error',
                code: 'RULE_VALUE_INVALID',
                message: `${rawType} 的值无效`,
                sourceLine: parsed.source.line,
                path: `sources.${parsed.source.sourceId}`,
                disposition: 'invalid',
            })],
        };
    }
    const trailing = Array.isArray(parsed.trailing) ? parsed.trailing.filter(Boolean) : [];
    const options = trailing.filter(item => SEMANTIC_OPTIONS.has(item.toLowerCase())).map(item => item.toLowerCase());
    const policy = trailing.find(item => !SEMANTIC_OPTIONS.has(item.toLowerCase()));
    const diagnostics = [];
    if (policy) {
        diagnostics.push(diagnostic({
            severity: 'info',
            code: 'SOURCE_POLICY_IGNORED',
            message: `已忽略来源中的策略绑定 ${policy}`,
            sourceLine: parsed.source.line,
            path: `sources.${parsed.source.sourceId}`,
        }));
    }
    return {
        rule: {
            type,
            value,
            ...(parsed.operands?.length ? { operands: parsed.operands } : {}),
            ...(options.length ? { options: [...new Set(options)].sort() } : {}),
            ...(parsed.comment ? { comment: parsed.comment } : {}),
            source: { ...parsed.source },
        },
        diagnostics,
    };
}

export function normalizedRuleKey(rule) {
    const semanticOptions = (rule.options || []).filter(item => SEMANTIC_OPTIONS.has(item)).sort();
    const value = rule.type === 'process-path' || rule.type === 'url-regex'
        ? rule.value
        : rule.value.toLowerCase();
    return JSON.stringify([rule.type, value, rule.operands || [], semanticOptions]);
}
