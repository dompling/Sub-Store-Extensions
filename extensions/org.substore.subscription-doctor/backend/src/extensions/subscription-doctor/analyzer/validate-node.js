import { diagnostic } from '../diagnostics.js';
import { normalizeProtocol } from '../compatibility/registry.js';
import { nodeQualitySignals } from './quality.js';

const HOSTNAME_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const IPV4_RE = /^(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const IPV6_RE = /^[0-9a-f:]+$/i;

const requiredCredentialGroups = Object.freeze({
    ss: [['password'], ['cipher']],
    ssr: [['password']],
    vmess: [['uuid']],
    vless: [['uuid']],
    trojan: [['password']],
    snell: [['psk']],
    tuic: [['uuid', 'token'], ['password']],
    hysteria: [['auth', 'auth-str', 'password']],
    hysteria2: [['password', 'auth', 'auth-str']],
    anytls: [['password']],
    wireguard: [['private-key'], ['public-key']],
    ssh: [['username'], ['password', 'private-key']],
});

const present = (value) => value !== undefined && value !== null && `${value}`.trim() !== '';

function safeHost(server) {
    if (!present(server)) return false;
    const value = `${server}`.trim();
    if (/\s|[/?#@]/.test(value)) return false;
    if (IPV4_RE.test(value)) return true;
    if (value.includes(':')) return IPV6_RE.test(value);
    return HOSTNAME_RE.test(value);
}

export function validateNode(node, index) {
    const diagnostics = [];
    const protocol = normalizeProtocol(node?.type || node?.protocol);
    const path = `nodes[${index}]`;

    if (!present(node?.name)) {
        diagnostics.push(
            diagnostic('warning', 'NODE_NAME_MISSING', 'Node name is empty', {
                path: `${path}.name`,
            }),
        );
    }
    if (!present(node?.type || node?.protocol)) {
        diagnostics.push(
            diagnostic('error', 'NODE_PROTOCOL_MISSING', 'Node protocol is missing', {
                path: `${path}.type`,
            }),
        );
    }
    if (!safeHost(node?.server)) {
        diagnostics.push(
            diagnostic(
                'error',
                present(node?.server) ? 'NODE_SERVER_INVALID' : 'NODE_SERVER_MISSING',
                present(node?.server)
                    ? 'Node server has an invalid format'
                    : 'Node server is missing',
                { path: `${path}.server` },
            ),
        );
    }
    const port = Number(node?.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        diagnostics.push(
            diagnostic(
                'error',
                present(node?.port) ? 'NODE_PORT_INVALID' : 'NODE_PORT_MISSING',
                present(node?.port)
                    ? 'Node port must be an integer between 1 and 65535'
                    : 'Node port is missing',
                { path: `${path}.port` },
            ),
        );
    }

    const credentialGroups = requiredCredentialGroups[protocol] || [];
    credentialGroups.forEach((alternatives) => {
        if (!alternatives.some((field) => present(node?.[field]))) {
            diagnostics.push(
                diagnostic(
                    'error',
                    'NODE_REQUIRED_FIELD_MISSING',
                    `Node requires ${alternatives.join(' or ')}`,
                    { path: `${path}.${alternatives[0]}` },
                ),
            );
        }
    });

    const quality = nodeQualitySignals(node, protocol);
    if (quality.tlsVerificationDisabled) {
        diagnostics.push(
            diagnostic(
                'warning',
                'NODE_TLS_VERIFY_DISABLED',
                'TLS certificate verification is disabled',
                { path: `${path}.tls` },
            ),
        );
    }
    if (quality.tlsServerNameMissing) {
        diagnostics.push(
            diagnostic(
                'warning',
                'NODE_TLS_SERVER_NAME_MISSING',
                'TLS uses an IP endpoint without an explicit server name',
                { path: `${path}.sni` },
            ),
        );
    }
    if (quality.privateEndpoint) {
        diagnostics.push(
            diagnostic(
                'info',
                'NODE_PRIVATE_ENDPOINT',
                'Node uses a private, loopback or link-local endpoint',
                { path: `${path}.server` },
            ),
        );
    }
    if (quality.plaintextProxy) {
        diagnostics.push(
            diagnostic(
                'warning',
                'NODE_PLAINTEXT_PROXY',
                'HTTP or SOCKS proxy transport is not protected by TLS',
                { path: `${path}.type` },
            ),
        );
    }
    if (quality.legacyCipher) {
        diagnostics.push(
            diagnostic(
                'warning',
                'NODE_LEGACY_CIPHER',
                'Node uses a legacy Shadowsocks cipher',
                { path: `${path}.cipher` },
            ),
        );
    }
    return diagnostics;
}
