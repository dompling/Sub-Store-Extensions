import { randomUUID } from 'node:crypto';
import { analyzeNodes } from './analyzer/analyze';
import { NODE_REPRESENTATION } from './constants';
import { failed, SubscriptionDoctorError, success } from './errors';
import { normalizeResourceRef } from './resource-ref';
import { resources } from './sdk';
import {
    deleteReport,
    getReport,
    latestReportForRef,
    listReports,
    saveReport,
} from './store';
import { reportDiff } from './report/diff';
import { exportReportJson, exportReportMarkdown } from './report/export';
import { sanitizeDescriptor, sanitizeDiagnostic } from './report/redact';
import manifest from './manifest.json';

const RESOURCE_LIST_OPTIONS = Object.freeze({
    types: ['subscription', 'collection'],
    contracts: ['substore.subscription@1', 'substore.collection@1'],
});

function parseNodes(output) {
    let value = output?.body;
    if (typeof value === 'string') {
        try {
            value = JSON.parse(value);
        } catch {
            throw new SubscriptionDoctorError(
                'RESOURCE_CONTENT_INVALID',
                'Resource did not produce valid node JSON',
                { statusCode: 422 },
            );
        }
    }
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.nodes)) return value.nodes;
    if (Array.isArray(value?.proxies)) return value.proxies;
    throw new SubscriptionDoctorError(
        'RESOURCE_CONTENT_INVALID',
        'Resource output does not contain a node array',
        { statusCode: 422 },
    );
}

async function listDiagnosableResources() {
    const descriptors = await resources.list(RESOURCE_LIST_OPTIONS);
    return (Array.isArray(descriptors) ? descriptors : [])
        .filter(
            (descriptor) =>
                RESOURCE_LIST_OPTIONS.types.includes(descriptor?.ref?.type) &&
                descriptor?.lifecycle?.state !== 'archived',
        )
        .map(sanitizeDescriptor)
        .sort((left, right) =>
            `${left.name || ''}`.localeCompare(`${right.name || ''}`),
        );
}

async function checkResource(refInput) {
    const ref = normalizeResourceRef(refInput);
    const startedAt = Date.now();
    const descriptor = await resources.get(ref);
    const output = await resources.produce(ref, {
        representation: NODE_REPRESENTATION,
        freshnessPolicy: 'fresh',
    });
    const analyzed = analyzeNodes(parseNodes(output));
    const previous = latestReportForRef(ref);
    const sourceDiagnostics = (output?.diagnostics || []).map(sanitizeDiagnostic);
    if (output?.freshness?.state === 'stale') {
        sourceDiagnostics.push({
            code: 'RESOURCE_STALE',
            severity: 'warning',
            count: 1,
            message: 'The provider returned a stale cached resource',
        });
    }
    if (analyzed.counts.total === 0) {
        sourceDiagnostics.push({
            code: 'RESOURCE_CONTENT_EMPTY',
            severity: 'error',
            count: 1,
            message: 'The resource contains no effective nodes',
        });
    }
    const status =
        analyzed.counts.total === 0 ||
        sourceDiagnostics.some((item) => item.severity === 'error')
            ? 'error'
            : analyzed.status === 'healthy' &&
              sourceDiagnostics.some((item) => item.severity === 'warning')
            ? 'warning'
            : analyzed.status;
    const report = {
        id: `doctor_${randomUUID()}`,
        sourceRef: ref,
        lastKnownName:
            descriptor?.displayName || descriptor?.name || descriptor?.ref?.id,
        sourceRevision: output?.sourceRevision ?? descriptor?.revision,
        checkedAt: Math.max(
            analyzed.checkedAt,
            previous ? Number(previous.checkedAt) + 1 : 0,
        ),
        durationMs: Math.max(0, Date.now() - startedAt),
        status,
        counts: analyzed.counts,
        protocols: analyzed.protocols,
        targets: analyzed.targets,
        quality: analyzed.quality,
        profile: analyzed.profile,
        networkChecks: analyzed.networkChecks,
        diagnostics: [...sourceDiagnostics, ...analyzed.diagnostics],
        snapshotHash: analyzed.snapshotHash,
    };
    report.diff = reportDiff(report, previous);
    return saveReport(report);
}

function parseReportId(request) {
    return decodeURIComponent(`${request.params.id || ''}`);
}

function requireReport(id) {
    const report = getReport(id);
    if (report) return report;
    throw new SubscriptionDoctorError(
        'SUBSCRIPTION_DOCTOR_REPORT_NOT_FOUND',
        'Subscription health report was not found',
        { statusCode: 404 },
    );
}

async function handleResources(_request, response) {
    try {
        success(response, { resources: await listDiagnosableResources() });
    } catch (error) {
        failed(response, error);
    }
}

async function handleCheck(request, response) {
    try {
        success(response, await checkResource(request.body?.sourceRef), 201);
    } catch (error) {
        failed(response, error);
    }
}

function handleReports(_request, response) {
    try {
        success(response, { reports: listReports() });
    } catch (error) {
        failed(response, error);
    }
}

function handleReport(request, response) {
    try {
        success(response, requireReport(parseReportId(request)));
    } catch (error) {
        failed(response, error);
    }
}

function handleDelete(request, response) {
    try {
        const id = parseReportId(request);
        if (!deleteReport(id)) requireReport(id);
        success(response, { id });
    } catch (error) {
        failed(response, error);
    }
}

function handleExport(request, response) {
    try {
        const report = requireReport(parseReportId(request));
        const format = `${request.params.format || 'json'}`.toLowerCase();
        if (!['json', 'markdown', 'md'].includes(format)) {
            throw new SubscriptionDoctorError(
                'RESOURCE_REPRESENTATION_UNSUPPORTED',
                `Report format ${format} is unsupported`,
                {
                    statusCode: 400,
                    details: { representation: format },
                },
            );
        }
        const markdown = format === 'markdown' || format === 'md';
        response
            .type(markdown ? 'text/markdown' : 'application/json')
            .send(markdown ? exportReportMarkdown(report) : exportReportJson(report));
    } catch (error) {
        failed(response, error);
    }
}

export function registerSubscriptionDoctorRoutes(app) {
    app.get('/api/extensions/subscription-doctor/resources', handleResources);
    app.post('/api/extensions/subscription-doctor/check', handleCheck);
    app.get('/api/extensions/subscription-doctor/reports', handleReports);
    app.get('/api/extensions/subscription-doctor/report/:id', handleReport);
    app.delete('/api/extensions/subscription-doctor/report/:id', handleDelete);
    app.get(
        '/api/extensions/subscription-doctor/report/:id/export/:format',
        handleExport,
    );
}

export const subscriptionDoctorExtension = Object.freeze({
    id: 'subscription-doctor',
    extensionId: manifest.id,
    manifest,
    feature: 'subscriptionDoctor',
    registerRoutes: registerSubscriptionDoctorRoutes,
});

export { analyzeNodes, checkResource, listDiagnosableResources };

export default registerSubscriptionDoctorRoutes;
