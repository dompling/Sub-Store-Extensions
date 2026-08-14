import { performance } from 'node:perf_hooks';
import {
    addCompatibilityCounts,
    compatibilityForNode,
    createEmptyTargetCounts,
    normalizeProtocol,
} from '../compatibility/registry.js';
import { diagnosticSummary } from '../diagnostics.js';
import { exactFingerprint, snapshotHash } from './fingerprint.js';
import {
    summarizeNodeProfile,
    unsupportedNetworkChecks,
} from './quality.js';
import { validateNode } from './validate-node.js';

const increment = (record, key) => {
    record[key] = (record[key] || 0) + 1;
};

function summarizeDiagnostics(diagnostics) {
    const groups = new Map();
    for (const item of diagnostics) {
        const key = `${item.severity}\u0000${item.code}\u0000${item.message}\u0000${
            item.path?.replace(/nodes\[\d+\]/g, 'nodes[*]') || ''
        }`;
        const current = groups.get(key) || {
            severity: item.severity,
            code: item.code,
            message: item.message,
            path: item.path?.replace(/nodes\[\d+\]/g, 'nodes[*]'),
            count: 0,
        };
        current.count += Number(item.count) || 1;
        groups.set(key, current);
    }
    return [...groups.values()]
        .sort((left, right) =>
            left.severity === right.severity
                ? left.code.localeCompare(right.code)
                : left.severity === 'error'
                ? -1
                : right.severity === 'error'
                ? 1
                : left.severity === 'warning'
                ? -1
                : 1,
        )
        .map((item) =>
            diagnosticSummary(
                item.code,
                item.severity,
                item.count,
                item.message,
                item.path,
            ),
        );
}

export function analyzeNodes(input, { now = () => Date.now() } = {}) {
    const startedAt = performance.now();
    const nodes = Array.isArray(input) ? input : [];
    const protocols = {};
    const targets = createEmptyTargetCounts();
    const diagnostics = [];
    const fingerprintCounts = new Map();
    const nameFingerprints = new Map();
    const protocolFingerprints = [];
    const compatibilityRows = [];
    let invalid = 0;

    nodes.forEach((node, index) => {
        const protocol = normalizeProtocol(node?.type || node?.protocol);
        increment(protocols, protocol);
        const nodeDiagnostics = validateNode(node, index);
        if (nodeDiagnostics.some((item) => item.severity === 'error')) invalid += 1;
        diagnostics.push(...nodeDiagnostics);

        const fingerprint = exactFingerprint(node || {});
        fingerprintCounts.set(
            fingerprint,
            (fingerprintCounts.get(fingerprint) || 0) + 1,
        );
        const name = `${node?.name || ''}`.trim();
        if (name) {
            const values = nameFingerprints.get(name) || new Set();
            values.add(fingerprint);
            nameFingerprints.set(name, values);
        }
        protocolFingerprints.push(`${protocol}:${fingerprint}`);
        const compatibility = compatibilityForNode(node || {});
        compatibilityRows.push(compatibility);
        addCompatibilityCounts(targets, compatibility);
    });

    const duplicate = [...fingerprintCounts.values()].reduce(
        (total, count) => total + Math.max(0, count - 1),
        0,
    );
    const duplicateName = [...nameFingerprints.values()].reduce(
        (total, fingerprints) => total + Math.max(0, fingerprints.size - 1),
        0,
    );

    if (duplicate) {
        diagnostics.push({
            schema: 'substore.diagnostic@1',
            severity: 'warning',
            code: 'NODE_EXACT_DUPLICATE',
            message: 'Exact duplicate connection fingerprints were found',
            path: 'nodes[*]',
            count: duplicate,
        });
    }
    if (duplicateName) {
        diagnostics.push({
            schema: 'substore.diagnostic@1',
            severity: 'warning',
            code: 'NODE_NAME_DUPLICATE',
            message: 'Duplicate names with different connection fingerprints were found',
            path: 'nodes[*].name',
            count: duplicateName,
        });
    }

    const { quality, profile } = summarizeNodeProfile(nodes, compatibilityRows);
    if (quality.sharedEndpoint) {
        diagnostics.push({
            schema: 'substore.diagnostic@1',
            severity: 'info',
            code: 'NODE_ENDPOINT_SHARED',
            message: 'Multiple nodes share the same server endpoint',
            path: 'nodes[*].server',
            count: quality.sharedEndpoint,
        });
    }

    const counts = {
        total: nodes.length,
        invalid,
        duplicate,
        duplicateName,
    };
    const status =
        nodes.length === 0 || invalid > 0
            ? 'error'
            : duplicate > 0 ||
              duplicateName > 0 ||
              Object.values(targets).some(
                  (target) =>
                      target.filtered > 0 ||
                      target.fallback > 0 ||
                      target.unknown > 0,
              ) ||
              quality.tlsVerificationDisabled > 0 ||
              quality.tlsServerNameMissing > 0 ||
              quality.plaintextProxy > 0 ||
              quality.legacyCipher > 0
            ? 'warning'
            : 'healthy';

    return {
        checkedAt: now(),
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        status,
        counts,
        protocols: Object.fromEntries(
            Object.entries(protocols).sort(([left], [right]) =>
                left.localeCompare(right),
            ),
        ),
        targets,
        quality,
        profile,
        networkChecks: unsupportedNetworkChecks(nodes.length),
        diagnostics: summarizeDiagnostics(diagnostics),
        snapshotHash: snapshotHash({
            protocolFingerprints: protocolFingerprints.sort(),
            counts,
            targets,
            quality,
            profile,
        }),
    };
}
