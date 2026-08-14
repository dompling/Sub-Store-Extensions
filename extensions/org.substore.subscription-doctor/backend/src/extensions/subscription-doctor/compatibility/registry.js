import { TARGETS } from '../constants.js';

export const COMPATIBILITY_REGISTRY_VERSION = 1;

const E = 'exact';
const F = 'fallback';
const X = 'filtered';
const U = 'unknown';

const REGISTRY = Object.freeze({
    ss: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    ssr: Object.freeze({ surge: X, qx: E, clash: E, loon: E }),
    vmess: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    vless: Object.freeze({ surge: X, qx: E, clash: E, loon: E }),
    trojan: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    http: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    https: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    socks: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    socks5: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
    snell: Object.freeze({ surge: E, qx: X, clash: E, loon: X }),
    tuic: Object.freeze({ surge: E, qx: X, clash: E, loon: X }),
    hysteria: Object.freeze({ surge: X, qx: X, clash: E, loon: X }),
    hysteria2: Object.freeze({ surge: E, qx: X, clash: E, loon: E }),
    hy2: Object.freeze({ surge: E, qx: X, clash: E, loon: E }),
    wireguard: Object.freeze({ surge: F, qx: X, clash: E, loon: E }),
    'wireguard-surge': Object.freeze({ surge: E, qx: X, clash: F, loon: F }),
    anytls: Object.freeze({ surge: F, qx: E, clash: E, loon: E }),
    ssh: Object.freeze({ surge: E, qx: X, clash: F, loon: X }),
    direct: Object.freeze({ surge: E, qx: E, clash: E, loon: E }),
});

const PROTOCOL_ALIASES = Object.freeze({
    shadowsocks: 'ss',
    shadowsocksr: 'ssr',
    socks: 'socks5',
    hy2: 'hysteria2',
});

export function normalizeProtocol(value) {
    const protocol = `${value || ''}`.trim().toLowerCase();
    return PROTOCOL_ALIASES[protocol] || protocol || 'unknown';
}

function cloneMatrix(value) {
    return Object.fromEntries(TARGETS.map((target) => [target, value[target]]));
}

export function compatibilityForNode(node) {
    const protocol = normalizeProtocol(node?.type || node?.protocol);
    const registered = REGISTRY[protocol];
    const matrix = registered
        ? cloneMatrix(registered)
        : Object.fromEntries(TARGETS.map((target) => [target, U]));
    const notes = [];

    if (
        ['vmess', 'vless'].includes(protocol) &&
        node?.network === 'ws' &&
        node?.['ws-opts']?.['v2ray-http-upgrade']
    ) {
        for (const target of ['surge', 'qx', 'loon']) matrix[target] = X;
        notes.push('HTTP Upgrade WebSocket transport is target-specific');
    }
    if (protocol === 'vless' && node?.['reality-opts']) {
        matrix.surge = X;
        matrix.loon = F;
        notes.push('VLESS REALITY needs a target-specific fallback');
    }
    if (protocol === 'anytls' && node?.['reality-opts']) {
        matrix.surge = X;
        matrix.loon = X;
        notes.push('AnyTLS REALITY is not portable to all targets');
    }
    if (protocol === 'wireguard' && node?.['private-key']) {
        notes.push('WireGuard conversion depends on target-specific interface fields');
    }

    return {
        registryVersion: COMPATIBILITY_REGISTRY_VERSION,
        protocol,
        matrix,
        notes,
    };
}

export function createEmptyTargetCounts() {
    return Object.fromEntries(
        TARGETS.map((target) => [
            target,
            { exact: 0, fallback: 0, filtered: 0, unknown: 0 },
        ]),
    );
}

export function addCompatibilityCounts(targets, compatibility) {
    for (const target of TARGETS) {
        targets[target][compatibility.matrix[target]] += 1;
    }
    return targets;
}

export function compatibilityRegistry() {
    return REGISTRY;
}
