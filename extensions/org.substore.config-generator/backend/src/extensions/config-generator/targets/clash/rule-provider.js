import YAML from '@/utils/yaml';

const CLASSICAL_RULE_TYPES = new Set([
    'DOMAIN',
    'DOMAIN-SUFFIX',
    'DOMAIN-KEYWORD',
    'GEOIP',
    'IP-CIDR',
    'IP-CIDR6',
    'SRC-IP-CIDR',
    'SRC-PORT',
    'DST-PORT',
    'PROCESS-NAME',
    'PROCESS-PATH',
    'IPSET',
]);

function textPayload(content) {
    return `${content || ''}`
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(
            (line) =>
                line &&
                !line.startsWith('#') &&
                !line.startsWith(';') &&
                !line.startsWith('//'),
        );
}

function yamlPayload(content) {
    const parsed = YAML.safeLoad(`${content || ''}`);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.payload)) {
        return parsed.payload;
    }
    throw new Error('Clash rule-provider YAML must contain a payload array');
}

export function sanitizeClashRuleProvider(
    content,
    { behavior = 'classical', format = 'yaml' } = {},
) {
    const payload = (format === 'text' ? textPayload : yamlPayload)(content);
    const omittedTypes = new Set();
    const sanitized = payload.filter((entry) => {
        if (typeof entry !== 'string' || !entry.trim()) return false;
        if (behavior !== 'classical') return true;
        const type = entry.split(',')[0].trim().toUpperCase();
        if (CLASSICAL_RULE_TYPES.has(type)) return true;
        omittedTypes.add(type || '(empty)');
        return false;
    });
    if (!sanitized.length) {
        throw new Error(
            'Clash rule-provider did not contain any rules supported by the selected behavior',
        );
    }
    return {
        body: YAML.safeDump(
            { payload: sanitized },
            { lineWidth: 0, noRefs: true },
        ),
        omittedTypes: [...omittedTypes],
        ruleCount: sanitized.length,
    };
}
