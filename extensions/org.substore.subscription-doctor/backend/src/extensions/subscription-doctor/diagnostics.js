import { DIAGNOSTIC_SCHEMA } from './constants.js';

export function diagnostic(severity, code, message, options = {}) {
    return {
        schema: DIAGNOSTIC_SCHEMA,
        severity,
        code,
        message,
        ...(options.path ? { path: options.path } : {}),
        ...(options.details ? { details: options.details } : {}),
    };
}

export function diagnosticSummary(code, severity, count, message, path) {
    return {
        code,
        severity,
        count,
        message,
        ...(path ? { path } : {}),
    };
}
