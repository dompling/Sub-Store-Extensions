import { RULE_STUDIO_LIMITS } from '../constants';
import { diagnostic } from '../diagnostics';
import { RuleStudioError } from '../errors';
import { normalizedRuleKey } from './rule';

export function mergeNormalizedRuleSets(parsedSources, { deduplicate = true } = {}) {
    const rules = [];
    const diagnostics = [];
    const seen = new Map();
    for (const parsed of parsedSources) {
        diagnostics.push(...(parsed.diagnostics || []));
        for (const rule of parsed.rules || []) {
            const key = normalizedRuleKey(rule);
            if (deduplicate && seen.has(key)) {
                const first = seen.get(key);
                diagnostics.push(diagnostic({
                    severity: 'info',
                    code: 'RULE_DUPLICATE_REMOVED',
                    message: `已去除与来源 ${first.source.sourceId}:${first.source.line} 重复的规则`,
                    sourceLine: rule.source.line,
                    path: `sources.${rule.source.sourceId}`,
                    details: { duplicateOfSourceId: first.source.sourceId, duplicateOfLine: first.source.line },
                }));
                continue;
            }
            seen.set(key, rule);
            rules.push(rule);
            if (rules.length > RULE_STUDIO_LIMITS.maxRules) {
                throw new RuleStudioError(
                    'RULE_STUDIO_RULE_LIMIT_EXCEEDED',
                    `单个项目最多允许 ${RULE_STUDIO_LIMITS.maxRules} 条规则`,
                    undefined,
                    413,
                );
            }
        }
    }
    return { rules, diagnostics };
}
