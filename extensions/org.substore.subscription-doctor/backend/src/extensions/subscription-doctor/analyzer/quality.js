import { isIP } from 'node:net';

const LEGACY_CIPHERS = new Set([
    'rc4-md5',
    'aes-128-cfb',
    'aes-192-cfb',
    'aes-256-cfb',
    'bf-cfb',
    'camellia-128-cfb',
    'camellia-192-cfb',
    'camellia-256-cfb',
]);

const MEDIA_PATTERNS = Object.freeze({
    disney: /(?:disney\+?|迪士尼)/i,
    netflix: /(?:netflix|奈飞|网飞|\bnf\b)/i,
    openai: /(?:openai|chatgpt|\bgpt\b)/i,
    primeVideo: /(?:prime\s*video|amazon\s*prime)/i,
    spotify: /(?:spotify|声田)/i,
    tiktok: /(?:tiktok|抖音)/i,
    youtube: /(?:youtube|油管|\byt\b)/i,
});

const REGION_PATTERNS = Object.freeze({
    au: /(?:🇦🇺|澳大利亚|澳洲|\bau\b)/i,
    ca: /(?:🇨🇦|加拿大|\bca\b)/i,
    de: /(?:🇩🇪|德国|\bde\b)/i,
    fr: /(?:🇫🇷|法国|\bfr\b)/i,
    hk: /(?:🇭🇰|香港|\bhk\b)/i,
    jp: /(?:🇯🇵|日本|东京|大阪|\bjp\b)/i,
    kr: /(?:🇰🇷|韩国|首尔|\bkr\b)/i,
    nl: /(?:🇳🇱|荷兰|\bnl\b)/i,
    sg: /(?:🇸🇬|新加坡|狮城|\bsg\b)/i,
    tw: /(?:🇹🇼|台湾|台北|\btw\b)/i,
    uk: /(?:🇬🇧|英国|伦敦|\buk\b|\bgb\b)/i,
    us: /(?:🇺🇸|美国|洛杉矶|圣何塞|西雅图|纽约|\bus\b)/i,
});

const present = (value) =>
    value !== undefined && value !== null && `${value}`.trim() !== '';

const enabled = (value) =>
    value === true || ['1', 'true', 'yes', 'on'].includes(`${value}`.trim().toLowerCase());

const disabled = (value) =>
    value === false || ['0', 'false', 'no', 'off'].includes(`${value}`.trim().toLowerCase());

function tlsEnabled(node) {
    return (
        enabled(node?.tls) ||
        enabled(node?.['over-tls']) ||
        enabled(node?.['tls-enabled']) ||
        `${node?.security || ''}`.toLowerCase() === 'tls'
    );
}

function certificateVerificationDisabled(node) {
    return (
        enabled(node?.['skip-cert-verify']) ||
        enabled(node?.skipCertVerify) ||
        enabled(node?.['allow-insecure']) ||
        enabled(node?.allowInsecure) ||
        enabled(node?.['tls-insecure']) ||
        disabled(node?.['tls-verification'])
    );
}

function hasTlsServerName(node) {
    return ['sni', 'servername', 'server-name', 'tls-host', 'peer'].some((key) =>
        present(node?.[key]),
    );
}

function isPrivateIpv4(value) {
    const octets = value.split('.').map(Number);
    const [first, second] = octets;
    return (
        first === 10 ||
        first === 127 ||
        (first === 169 && second === 254) ||
        (first === 172 && second >= 16 && second <= 31) ||
        (first === 192 && second === 168) ||
        (first === 100 && second >= 64 && second <= 127)
    );
}

function isPrivateIpv6(value) {
    const normalized = value.toLowerCase();
    return (
        normalized === '::1' ||
        normalized.startsWith('fc') ||
        normalized.startsWith('fd') ||
        /^fe[89ab]/.test(normalized)
    );
}

export function nodeQualitySignals(node, protocol) {
    const server = `${node?.server || ''}`.trim();
    const ipVersion = isIP(server);
    const tls = tlsEnabled(node);
    const cipher = `${node?.cipher || node?.method || ''}`.trim().toLowerCase();
    return {
        tlsVerificationDisabled: certificateVerificationDisabled(node),
        tlsServerNameMissing: Boolean(tls && ipVersion && !hasTlsServerName(node)),
        privateEndpoint: Boolean(
            (ipVersion === 4 && isPrivateIpv4(server)) ||
                (ipVersion === 6 && isPrivateIpv6(server)),
        ),
        plaintextProxy: Boolean(
            ['http', 'socks', 'socks5'].includes(protocol) && !tls,
        ),
        legacyCipher: LEGACY_CIPHERS.has(cipher),
    };
}

const increment = (record, key) => {
    record[key] = (record[key] || 0) + 1;
};

export function summarizeNodeProfile(nodes, compatibilityRows) {
    const servers = new Set();
    const endpoints = new Map();
    const regions = {};
    const media = {};
    const quality = {
        unknownProtocol: 0,
        tlsVerificationDisabled: 0,
        tlsServerNameMissing: 0,
        privateEndpoint: 0,
        sharedEndpoint: 0,
        plaintextProxy: 0,
        legacyCipher: 0,
    };
    let regionTagged = 0;
    let mediaTagged = 0;

    nodes.forEach((node, index) => {
        const compatibility = compatibilityRows[index];
        const protocol = compatibility.protocol;
        const signals = nodeQualitySignals(node, protocol);
        if (Object.values(compatibility.matrix).every((value) => value === 'unknown')) {
            quality.unknownProtocol += 1;
        }
        for (const key of [
            'tlsVerificationDisabled',
            'tlsServerNameMissing',
            'privateEndpoint',
            'plaintextProxy',
            'legacyCipher',
        ]) {
            if (signals[key]) quality[key] += 1;
        }

        const server = `${node?.server || ''}`.trim().toLowerCase();
        const port = Number(node?.port);
        if (server) {
            servers.add(server);
            const endpoint = `${server}:${Number.isInteger(port) ? port : ''}`;
            endpoints.set(endpoint, (endpoints.get(endpoint) || 0) + 1);
        }

        const name = `${node?.name || ''}`;
        let hasRegion = false;
        for (const [key, pattern] of Object.entries(REGION_PATTERNS)) {
            if (!pattern.test(name)) continue;
            increment(regions, key);
            hasRegion = true;
            break;
        }
        if (hasRegion) regionTagged += 1;

        let hasMedia = false;
        for (const [key, pattern] of Object.entries(MEDIA_PATTERNS)) {
            if (!pattern.test(name)) continue;
            increment(media, key);
            hasMedia = true;
        }
        if (hasMedia) mediaTagged += 1;
    });

    quality.sharedEndpoint = [...endpoints.values()].reduce(
        (total, count) => total + Math.max(0, count - 1),
        0,
    );

    return {
        quality,
        profile: {
            uniqueServers: servers.size,
            uniqueEndpoints: endpoints.size,
            regionTagged,
            mediaTagged,
            regions: Object.fromEntries(Object.entries(regions).sort()),
            media: Object.fromEntries(Object.entries(media).sort()),
        },
    };
}

export function unsupportedNetworkChecks(nodeCount) {
    return {
        state: 'unsupported',
        runner: 'none',
        tested: 0,
        skipped: Math.max(0, Number(nodeCount) || 0),
        reachable: 0,
        failed: 0,
        reasonCode: 'NODE_PROXY_RUNNER_UNAVAILABLE',
        features: {
            connectivity: 'unsupported',
            streaming: 'unsupported',
            egress: 'unsupported',
        },
    };
}
