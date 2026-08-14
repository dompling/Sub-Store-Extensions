import { redactValue, sanitizeDiagnostic } from './redact.js';

function exportView(report) {
    return redactValue({
        schema: 'substore.subscription-health-report@1',
        id: report.id,
        source: {
            type: report.sourceRef.type,
            lastKnownName: report.lastKnownName,
            sourceRevision: report.sourceRevision,
        },
        checkedAt: report.checkedAt,
        durationMs: report.durationMs,
        status: report.status,
        counts: report.counts,
        protocols: report.protocols,
        targets: report.targets,
        quality: report.quality,
        profile: report.profile,
        networkChecks: report.networkChecks,
        diagnostics: (report.diagnostics || []).map(sanitizeDiagnostic),
        diff: report.diff,
        snapshotHash: report.snapshotHash,
    });
}

export function exportReportJson(report) {
    return `${JSON.stringify(exportView(report), null, 2)}\n`;
}

export function exportReportMarkdown(report) {
    const value = exportView(report);
    const lines = [
        '# Subscription health report',
        '',
        `- Source: ${value.source.lastKnownName || value.source.type}`,
        `- Type: ${value.source.type}`,
        `- Checked at: ${new Date(value.checkedAt).toISOString()}`,
        `- Status: ${value.status}`,
        `- Duration: ${value.durationMs} ms`,
        '',
        '## Summary',
        '',
        `- Nodes: ${value.counts.total}`,
        `- Invalid: ${value.counts.invalid}`,
        `- Exact duplicates: ${value.counts.duplicate}`,
        `- Duplicate names: ${value.counts.duplicateName}`,
        '',
        '## Protocols',
        '',
        '| Protocol | Count |',
        '| --- | ---: |',
        ...Object.entries(value.protocols).map(
            ([protocol, count]) => `| ${protocol} | ${count} |`,
        ),
        '',
        '## Compatibility',
        '',
        '| Target | Exact | Fallback | Filtered | Unknown |',
        '| --- | ---: | ---: | ---: | ---: |',
        ...Object.entries(value.targets).map(
            ([target, counts]) =>
                `| ${target} | ${counts.exact} | ${counts.fallback} | ${counts.filtered} | ${counts.unknown} |`,
        ),
        '',
        '## Quality signals',
        '',
        `- Unknown protocols: ${value.quality.unknownProtocol}`,
        `- TLS verification disabled: ${value.quality.tlsVerificationDisabled}`,
        `- TLS server name missing: ${value.quality.tlsServerNameMissing}`,
        `- Private endpoints: ${value.quality.privateEndpoint}`,
        `- Shared endpoints: ${value.quality.sharedEndpoint}`,
        `- Plaintext HTTP/SOCKS proxies: ${value.quality.plaintextProxy}`,
        `- Legacy ciphers: ${value.quality.legacyCipher}`,
        '',
        '## Node profile',
        '',
        `- Unique servers: ${value.profile.uniqueServers}`,
        `- Unique endpoints: ${value.profile.uniqueEndpoints}`,
        `- Region-labelled nodes: ${value.profile.regionTagged}`,
        `- Media-labelled nodes: ${value.profile.mediaTagged}`,
        '',
        '## Active network checks',
        '',
        `- State: ${value.networkChecks.state}`,
        `- Runner: ${value.networkChecks.runner}`,
        `- Tested: ${value.networkChecks.tested}`,
        `- Skipped: ${value.networkChecks.skipped}`,
        `- Reason: ${value.networkChecks.reasonCode}`,
        '',
        '## Diagnostics',
        '',
        ...(value.diagnostics.length
            ? value.diagnostics.map(
                  (item) =>
                      `- [${item.severity}] ${item.code} ×${item.count}: ${item.message}${
                          item.path ? ` (${item.path})` : ''
                      }`,
              )
            : ['- None']),
    ];
    return `${lines.join('\n')}\n`;
}
