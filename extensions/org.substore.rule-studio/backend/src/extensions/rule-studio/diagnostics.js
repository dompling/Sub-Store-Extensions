export function diagnostic({
    severity = 'warning',
    code,
    message,
    path,
    sourceLine,
    details,
    disposition,
}) {
    return {
        schema: 'substore.diagnostic@1',
        severity,
        code,
        message,
        ...(path ? { path } : {}),
        ...(Number.isInteger(sourceLine) ? { sourceLine } : {}),
        ...(details || disposition
            ? { details: { ...(details || {}), ...(disposition ? { disposition } : {}) } }
            : {}),
    };
}

export function countDiagnostics(diagnostics = []) {
    return diagnostics.reduce(
        (result, item) => {
            const disposition = item?.details?.disposition;
            if (Object.prototype.hasOwnProperty.call(result, disposition)) {
                result[disposition] += 1;
            }
            if (item?.severity === 'warning') result.warning += 1;
            if (item?.severity === 'error') result.error += 1;
            return result;
        },
        {
            exact: 0,
            fallback: 0,
            filtered: 0,
            invalid: 0,
            warning: 0,
            error: 0,
        },
    );
}
