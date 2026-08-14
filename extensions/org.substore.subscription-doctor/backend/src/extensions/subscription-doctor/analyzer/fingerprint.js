import { createHash } from 'node:crypto';
import { normalizeProtocol } from '../compatibility/registry.js';

function stable(value) {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === 'object') {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                if (value[key] !== undefined) result[key] = stable(value[key]);
                return result;
            }, {});
    }
    return value ?? null;
}

const credentialIdentity = (node) => ({
    username: node.username,
    password: node.password,
    uuid: node.uuid,
    token: node.token,
    psk: node.psk,
    privateKey: node['private-key'],
    publicKey: node['public-key'],
    auth: node.auth,
    authStr: node['auth-str'],
});

const transportIdentity = (node) => ({
    cipher: node.cipher,
    protocol: node.protocol,
    network: node.network,
    tls: node.tls,
    sni: node.sni || node.servername,
    flow: node.flow,
    alpn: node.alpn,
    plugin: node.plugin,
    pluginOpts: node['plugin-opts'],
    wsOpts: node['ws-opts'],
    httpOpts: node['http-opts'],
    h2Opts: node['h2-opts'],
    grpcOpts: node['grpc-opts'],
    realityOpts: node['reality-opts'],
});

export function exactFingerprint(node) {
    const identity = stable({
        protocol: normalizeProtocol(node?.type || node?.protocol),
        server: `${node?.server || ''}`.trim().toLowerCase(),
        port: Number(node?.port),
        credentials: credentialIdentity(node || {}),
        transport: transportIdentity(node || {}),
    });
    return createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export function snapshotHash(value) {
    return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
