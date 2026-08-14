import { REPORT_LIMIT, REPORT_STORE_SCHEMA_VERSION } from './constants';
import { storage } from './sdk';
import { normalizeResourceRef, resourceRefKey } from './resource-ref';
import { redactText, sanitizeDiagnostic } from './report/redact';

const QUALITY_KEYS = Object.freeze([
    'unknownProtocol',
    'tlsVerificationDisabled',
    'tlsServerNameMissing',
    'privateEndpoint',
    'sharedEndpoint',
    'plaintextProxy',
    'legacyCipher',
]);

const nonNegative = (value) => Math.max(0, Number(value) || 0);

const numericMap = (value) =>
    Object.fromEntries(
        Object.entries(value || {})
            .filter(([key]) => /^[A-Za-z0-9_-]{1,64}$/.test(key))
            .map(([key, count]) => [key, nonNegative(count)])
            .filter(([, count]) => count > 0),
    );

function normalizeQuality(value) {
    return Object.fromEntries(
        QUALITY_KEYS.map((key) => [key, nonNegative(value?.[key])]),
    );
}

function normalizeProfile(value) {
    return {
        uniqueServers: nonNegative(value?.uniqueServers),
        uniqueEndpoints: nonNegative(value?.uniqueEndpoints),
        regionTagged: nonNegative(value?.regionTagged),
        mediaTagged: nonNegative(value?.mediaTagged),
        regions: numericMap(value?.regions),
        media: numericMap(value?.media),
    };
}

function normalizeNetworkChecks(value, nodeCount) {
    const featureState = (input) =>
        ['not-run', 'unsupported', 'partial', 'complete'].includes(input)
            ? input
            : 'unsupported';
    return {
        state: featureState(value?.state),
        runner: value?.runner === 'http-socks' || value?.runner === 'host-probe'
            ? value.runner
            : 'none',
        tested: nonNegative(value?.tested),
        skipped: value?.skipped === undefined
            ? nonNegative(nodeCount)
            : nonNegative(value.skipped),
        reachable: nonNegative(value?.reachable),
        failed: nonNegative(value?.failed),
        reasonCode: /^[A-Z0-9_.-]{1,128}$/.test(`${value?.reasonCode || ''}`)
            ? `${value.reasonCode}`
            : 'NODE_PROXY_RUNNER_UNAVAILABLE',
        features: {
            connectivity: featureState(value?.features?.connectivity),
            streaming: featureState(value?.features?.streaming),
            egress: featureState(value?.features?.egress),
        },
    };
}

function normalizeReport(input) {
    if (!input || typeof input !== 'object') return null;
    try {
        return {
            id: `${input.id}`,
            sourceRef: normalizeResourceRef(input.sourceRef),
            ...(typeof input.lastKnownName === 'string'
                ? { lastKnownName: redactText(input.lastKnownName).slice(0, 256) }
                : {}),
            ...(typeof input.sourceRevision === 'string' ||
            typeof input.sourceRevision === 'number'
                ? { sourceRevision: input.sourceRevision }
                : {}),
            checkedAt: Number(input.checkedAt) || Date.now(),
            durationMs: Math.max(0, Number(input.durationMs) || 0),
            status: ['healthy', 'warning', 'error'].includes(input.status)
                ? input.status
                : 'error',
            counts: {
                total: Math.max(0, Number(input.counts?.total) || 0),
                invalid: Math.max(0, Number(input.counts?.invalid) || 0),
                duplicate: Math.max(0, Number(input.counts?.duplicate) || 0),
                duplicateName: Math.max(
                    0,
                    Number(input.counts?.duplicateName) || 0,
                ),
            },
            protocols: { ...(input.protocols || {}) },
            targets: { ...(input.targets || {}) },
            quality: normalizeQuality(input.quality),
            profile: normalizeProfile(input.profile),
            networkChecks: normalizeNetworkChecks(
                input.networkChecks,
                input.counts?.total,
            ),
            diagnostics: (input.diagnostics || []).map(sanitizeDiagnostic),
            snapshotHash: `${input.snapshotHash || ''}`,
            ...(input.diff ? { diff: input.diff } : {}),
        };
    } catch {
        return null;
    }
}

export function readSubscriptionDoctorStore() {
    const value = storage.read();
    const reports = Array.isArray(value?.reports)
        ? value.reports.map(normalizeReport).filter(Boolean)
        : [];
    reports.sort(
        (left, right) =>
            right.checkedAt - left.checkedAt || right.id.localeCompare(left.id),
    );
    return {
        schemaVersion: REPORT_STORE_SCHEMA_VERSION,
        reports: reports.slice(0, REPORT_LIMIT),
    };
}

export function writeSubscriptionDoctorStore(value) {
    const normalized = {
        schemaVersion: REPORT_STORE_SCHEMA_VERSION,
        reports: (value?.reports || [])
            .map(normalizeReport)
            .filter(Boolean)
            .sort(
                (left, right) =>
                    right.checkedAt - left.checkedAt ||
                    right.id.localeCompare(left.id),
            )
            .slice(0, REPORT_LIMIT),
    };
    storage.write(normalized);
    return normalized;
}

export function initializeSubscriptionDoctorStore() {
    if (!storage.read()) writeSubscriptionDoctorStore({ reports: [] });
}

export function listReports() {
    return readSubscriptionDoctorStore().reports;
}

export function getReport(id) {
    return listReports().find((report) => report.id === id) || null;
}

export function latestReportForRef(ref) {
    const key = resourceRefKey(ref);
    return (
        listReports().find((report) => resourceRefKey(report.sourceRef) === key) ||
        null
    );
}

export function saveReport(report) {
    const store = readSubscriptionDoctorStore();
    store.reports = [report, ...store.reports.filter((item) => item.id !== report.id)];
    writeSubscriptionDoctorStore(store);
    return getReport(report.id);
}

export function deleteReport(id) {
    const store = readSubscriptionDoctorStore();
    const next = store.reports.filter((report) => report.id !== id);
    if (next.length === store.reports.length) return false;
    writeSubscriptionDoctorStore({ reports: next });
    return true;
}
