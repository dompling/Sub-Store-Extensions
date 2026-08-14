export class RuleStudioError extends Error {
    constructor(code, message, details, statusCode = 400) {
        super(message);
        this.name = 'RuleStudioError';
        this.code = code;
        this.details = details;
        this.statusCode = statusCode;
    }
}

export function asRuleStudioError(error) {
    if (error instanceof RuleStudioError) return error;
    return new RuleStudioError(
        error?.code || 'RULE_STUDIO_OPERATION_FAILED',
        error?.message || '规则集配置操作失败',
        undefined,
        error?.statusCode || 500,
    );
}

export function assertRuleStudio(condition, code, message, details, statusCode) {
    if (condition) return;
    throw new RuleStudioError(code, message, details, statusCode);
}
