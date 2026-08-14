import { RULE_STUDIO_REPRESENTATIONS } from '../constants';
import { diagnostic } from '../diagnostics';
import { RuleStudioError } from '../errors';
import {
    serializeClashClassical,
    serializeClashDomain,
    serializeClashIpcidr,
} from './clash';
import { serializeLoonRuleList } from './loon';
import { serializeQxFilter } from './qx';
import { serializeSurgeRuleList } from './surge';

function requireBody(lines, representation) {
    if (!lines.length) {
        throw new RuleStudioError(
            'RESOURCE_CONTENT_INVALID',
            `${representation} 过滤后没有有效规则`,
            undefined,
            422,
        );
    }
    return `${lines.join('\n')}\n`;
}

export function serializeRules(rules, representation) {
    if (!RULE_STUDIO_REPRESENTATIONS.includes(representation)) {
        throw new RuleStudioError(
            'RESOURCE_REPRESENTATION_UNSUPPORTED',
            `不支持规则集表示 ${representation}`,
        );
    }
    if (representation === 'normalized-json') {
        return {
            body: `${JSON.stringify({ schema: 'substore.normalized-rule-set@1', rules }, null, 2)}\n`,
            mediaType: 'application/json',
            stats: { exact: rules.length, fallback: 0, filtered: 0, invalid: 0 },
            diagnostics: [],
        };
    }
    if (representation === 'surge-rule-list') {
        const result = serializeSurgeRuleList(rules);
        return { ...result, body: requireBody(result.lines, representation), mediaType: 'text/plain' };
    }
    if (representation === 'qx-filter') {
        const result = serializeQxFilter(rules);
        return { ...result, body: requireBody(result.lines, representation), mediaType: 'text/plain' };
    }
    if (representation === 'loon-rule-list') {
        const result = serializeLoonRuleList(rules);
        return { ...result, body: requireBody(result.lines, representation), mediaType: 'text/plain' };
    }
    if (representation === 'clash-classical-yaml') {
        const result = serializeClashClassical(rules, 'yaml');
        if (!result.payload.length) throw new RuleStudioError('RESOURCE_CONTENT_INVALID', 'Clash classical 过滤后没有有效规则', undefined, 422);
        return { ...result, mediaType: 'text/yaml' };
    }
    if (representation === 'clash-classical-text') {
        const result = serializeClashClassical(rules, 'text');
        if (!result.payload.length) throw new RuleStudioError('RESOURCE_CONTENT_INVALID', 'Clash classical 过滤后没有有效规则', undefined, 422);
        return { ...result, mediaType: 'text/plain' };
    }
    if (representation === 'clash-domain-yaml') {
        return { ...serializeClashDomain(rules), mediaType: 'text/yaml' };
    }
    if (representation === 'clash-ipcidr-yaml') {
        return { ...serializeClashIpcidr(rules), mediaType: 'text/yaml' };
    }
    throw new RuleStudioError('RESOURCE_REPRESENTATION_UNSUPPORTED', `不支持规则集表示 ${representation}`);
}

export function withExactDiagnostics(result, rules) {
    if (result.stats?.exact !== rules.length || result.diagnostics?.length) return result;
    return {
        ...result,
        diagnostics: [diagnostic({
            severity: 'info',
            code: 'RULE_SET_EXACT',
            message: `${rules.length} 条规则均可等价输出`,
            disposition: 'exact',
        })],
    };
}
