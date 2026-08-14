import { parse as parseYaml } from 'yaml';

const looksLikeHtml = content => /^\s*(?:<!doctype\s+html|<html|<head|<body)/i.test(content);
const looksLikeErrorJson = content => {
    if (!/^\s*[\[{]/.test(content)) return false;
    try {
        const value = JSON.parse(content);
        return !Array.isArray(value?.payload) && !Array.isArray(value);
    } catch {
        return false;
    }
};

function clashBehavior(payload) {
    const values = payload.filter(value => typeof value === 'string').map(value => value.trim());
    if (!values.length) return 'classical';
    if (values.every(value => /^(?:\+\.|\.)?[A-Za-z0-9_\p{L}-]+(?:\.[A-Za-z0-9_\p{L}-]+)+$/u.test(value))) {
        return 'domain';
    }
    if (values.every(value => /^[0-9A-Fa-f:.]+\/\d{1,3}$/.test(value))) return 'ipcidr';
    return 'classical';
}

export function detectRuleSetFormat(content) {
    const text = `${content || ''}`.replace(/^\uFEFF/, '');
    if (!text.trim() || looksLikeHtml(text) || looksLikeErrorJson(text)) {
        return { format: null, confidence: 0 };
    }
    try {
        const parsed = parseYaml(text);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.payload)) {
            const behavior = clashBehavior(parsed.payload);
            return {
                format: behavior === 'domain'
                    ? 'clash-domain-yaml'
                    : behavior === 'ipcidr'
                        ? 'clash-ipcidr-yaml'
                        : 'clash-classical-yaml',
                confidence: 1,
            };
        }
    } catch {
        // Plain rule lists are intentionally handled below.
    }
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const rules = lines.filter(line => !/^(?:#|;|\/\/)/.test(line));
    if (!rules.length) return { format: null, confidence: 0 };
    if (rules.some(line => /^(?:host|host-suffix|host-keyword|ip6-cidr),/i.test(line))) {
        return { format: 'qx', confidence: 0.95 };
    }
    if (rules.some(line => /^(?:DOMAIN|DOMAIN-SUFFIX|IP-CIDR),/i.test(line))) {
        return { format: 'surge', confidence: 0.68 };
    }
    if (rules.every(line => line.includes(',') || /^[A-Za-z0-9.+_-]+\.[A-Za-z]{2,}$/.test(line))) {
        return { format: 'clash-classical-text', confidence: 0.5 };
    }
    return { format: null, confidence: 0.2 };
}

export function isObviouslyInvalidDocument(content) {
    const text = `${content || ''}`.trim();
    return !text || looksLikeHtml(text) || looksLikeErrorJson(text);
}
