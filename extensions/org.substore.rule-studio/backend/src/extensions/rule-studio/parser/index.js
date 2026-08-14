import { parse as parseYaml } from 'yaml';
import { RULE_STUDIO_LIMITS } from '../constants';
import { diagnostic } from '../diagnostics';
import { RuleStudioError } from '../errors';
import { normalizeParsedRule } from '../normalize/rule';
import { splitRuleFields } from './csv';
import { detectRuleSetFormat, isObviouslyInvalidDocument } from './detect';

function rawRulesFromClashPayload(content, format) {
    let parsed;
    try {
        parsed = parseYaml(content);
    } catch (error) {
        throw new RuleStudioError('RESOURCE_CONTENT_INVALID', 'Clash YAML 无法解析', undefined, 422);
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.payload)) {
        throw new RuleStudioError('RESOURCE_CONTENT_INVALID', 'Clash provider 缺少 payload 数组', undefined, 422);
    }
    return parsed.payload.map((value, index) => ({
        value,
        line: index + 1,
        format,
    }));
}

function parsedFromDomainValue(value, source) {
    const text = `${value || ''}`.trim();
    if (text.startsWith('+.') || text.startsWith('.')) {
        return { rawType: 'DOMAIN-SUFFIX', value: text.replace(/^\+?\./, ''), trailing: [], source };
    }
    return { rawType: 'DOMAIN', value: text, trailing: [], source };
}

function parsedFromCidrValue(value, source) {
    return {
        rawType: `${value}`.includes(':') ? 'IP-CIDR6' : 'IP-CIDR',
        value: `${value}`.trim(),
        trailing: [],
        source,
    };
}

function parseLine(line, source, format) {
    if (format === 'clash-domain-yaml') return parsedFromDomainValue(line, source);
    if (format === 'clash-ipcidr-yaml') return parsedFromCidrValue(line, source);
    if (!`${line}`.includes(',')) {
        if (/^[0-9A-Fa-f:.]+\/\d{1,3}$/.test(`${line}`.trim())) return parsedFromCidrValue(line, source);
        if (/^(?:\+\.|\.)?[A-Za-z0-9_\p{L}-]+(?:\.[A-Za-z0-9_\p{L}-]+)+$/u.test(`${line}`.trim())) {
            return parsedFromDomainValue(line, source);
        }
    }
    const fields = splitRuleFields(`${line}`);
    return {
        rawType: fields[0],
        value: fields[1],
        trailing: fields.slice(2),
        source,
    };
}

export function parseRuleSet(content, {
    sourceId = 'inline',
    format = 'auto',
    preserveComments = true,
} = {}) {
    const text = `${content || ''}`.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
    if (Buffer.byteLength(text, 'utf8') > RULE_STUDIO_LIMITS.maxSourceBytes) {
        throw new RuleStudioError('RESOURCE_CONTENT_TOO_LARGE', '规则集内容超过 10 MiB 限制', undefined, 413);
    }
    if (isObviouslyInvalidDocument(text)) {
        throw new RuleStudioError('RESOURCE_CONTENT_INVALID', '规则集为空或返回了错误页面', undefined, 422);
    }
    const detection = format === 'auto' ? detectRuleSetFormat(text) : { format, confidence: 1 };
    const resolvedFormat = detection.format || 'clash-classical-text';
    const diagnostics = [];
    if (format === 'auto' && detection.confidence < 0.6) {
        diagnostics.push(diagnostic({
            severity: 'warning',
            code: 'RULE_SET_FORMAT_UNCONFIRMED',
            message: '规则集格式识别置信度较低，请确认来源格式',
        }));
    }

    const rawRules = resolvedFormat.includes('-yaml')
        ? rawRulesFromClashPayload(text, resolvedFormat)
        : text.split('\n').map((value, index) => ({ value, line: index + 1, format: resolvedFormat }));
    const rules = [];
    let pendingComment = '';
    for (const raw of rawRules) {
        if (typeof raw.value !== 'string') {
            diagnostics.push(diagnostic({
                severity: 'error',
                code: 'RULE_VALUE_INVALID',
                message: '规则必须是字符串',
                sourceLine: raw.line,
                disposition: 'invalid',
            }));
            continue;
        }
        const trimmed = raw.value.trim();
        if (!trimmed) continue;
        if (/^(?:#|;|\/\/)/.test(trimmed)) {
            if (preserveComments) pendingComment = trimmed.replace(/^(?:#|;|\/\/)\s*/, '');
            continue;
        }
        const source = {
            sourceId,
            line: raw.line,
            raw: raw.value,
            format: resolvedFormat,
        };
        const parsed = parseLine(raw.value, source, resolvedFormat);
        if (pendingComment) {
            parsed.comment = pendingComment;
            pendingComment = '';
        }
        const normalized = normalizeParsedRule(parsed);
        diagnostics.push(...normalized.diagnostics);
        if (normalized.rule) rules.push(normalized.rule);
        if (rules.length > RULE_STUDIO_LIMITS.maxRules) {
            throw new RuleStudioError(
                'RULE_STUDIO_RULE_LIMIT_EXCEEDED',
                `单个项目最多允许 ${RULE_STUDIO_LIMITS.maxRules} 条规则`,
                undefined,
                413,
            );
        }
    }
    return {
        format: resolvedFormat,
        confidence: detection.confidence,
        rules,
        diagnostics,
    };
}
