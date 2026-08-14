const SENSITIVE_KEY = /(?:password|passwd|secret|token|uuid|private[-_ ]?key|authorization|credential|server|host|url|body|content|nodes?)/i;
const URL_QUERY = /https?:\/\/[^\s)\]}>]+\?[^\s)\]}>]*/gi;
const URL_AUTHORITY = /https?:\/\/[^\s)\]}>]+/gi;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const IPV4 = /\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g;
const DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}\b/gi;
const PRIVATE_KEY = /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/gi;
const SECRET_ASSIGNMENT = /\b(?:password|passwd|secret|token|uuid|private[-_ ]?key|authorization)\s*[:=]\s*[^\s,;]+/gi;
const SECRET_SENTINEL = /\b(?:secret|password|passwd|token|uuid|private[-_]?key|query)[-_][a-z0-9_-]+\b/gi;

export function redactText(value) {
    return `${value ?? ''}`
        .replace(PRIVATE_KEY, '[redacted-private-key]')
        .replace(URL_QUERY, '[redacted-url]')
        .replace(URL_AUTHORITY, '[redacted-url]')
        .replace(UUID, '[redacted-uuid]')
        .replace(IPV4, '[redacted-host]')
        .replace(DOMAIN, '[redacted-host]')
        .replace(SECRET_ASSIGNMENT, (assignment) =>
            `${assignment.split(/[:=]/)[0]}=[redacted]`,
        )
        .replace(SECRET_SENTINEL, '[redacted]');
}

export function redactValue(value, key = '') {
    if (SENSITIVE_KEY.test(key)) return '[redacted]';
    if (typeof value === 'string') return redactText(value);
    if (Array.isArray(value)) return value.map((item) => redactValue(item));
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value)
                .filter(([entryKey]) => !SENSITIVE_KEY.test(entryKey))
                .map(([entryKey, entryValue]) => [
                    entryKey,
                    redactValue(entryValue, entryKey),
                ]),
        );
    }
    return value;
}

export function sanitizeDiagnostic(input) {
    const code = `${input?.code || ''}`;
    const path = `${input?.path || ''}`;
    return {
        code: /^[A-Z0-9_.-]{1,128}$/.test(code)
            ? code
            : 'SUBSCRIPTION_DOCTOR_DIAGNOSTIC',
        severity: ['info', 'warning', 'error'].includes(input?.severity)
            ? input.severity
            : 'warning',
        count: Number.isFinite(Number(input?.count))
            ? Math.max(1, Number(input.count))
            : 1,
        message: redactText(input?.message || 'Diagnostic'),
        ...(/^[A-Za-z0-9_.*\[\]-]{1,256}$/.test(path)
            ? { path: path.replace(/nodes\[\d+\]/g, 'nodes[*]') }
            : {}),
    };
}

export function sanitizeDescriptor(input) {
    return {
        ref: input?.ref,
        name: redactText(
            typeof input?.displayName === 'string' && input.displayName.trim()
                ? input.displayName
                : typeof input?.name === 'string' && input.name.trim()
                ? input.name
                : input?.ref?.id,
        ),
        revision: input?.revision,
        lifecycle: input?.lifecycle,
        availability: input?.availability,
    };
}
