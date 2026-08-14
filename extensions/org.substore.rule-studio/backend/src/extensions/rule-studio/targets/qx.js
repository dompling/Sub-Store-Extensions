import {
    exact,
    filtered,
    lineWithOptions,
    serializeProjectedRules,
} from './common';

const QX_TYPE = Object.freeze({
    domain: 'HOST',
    'domain-suffix': 'HOST-SUFFIX',
    'domain-keyword': 'HOST-KEYWORD',
    'ip-cidr': 'IP-CIDR',
    'ip-cidr6': 'IP6-CIDR',
    geoip: 'GEOIP',
    'process-name': 'PROCESS-NAME',
    'url-regex': 'URL-REGEX',
    'user-agent': 'USER-AGENT',
    'dst-port': 'DEST-PORT',
    'src-port': 'SRC-PORT',
    'src-ip-cidr': 'SRC-IP',
});

function project(rule) {
    const type = QX_TYPE[rule.type];
    if (type) return exact(rule, lineWithOptions(type, rule));
    return filtered(rule, 'QX_RULE_UNSUPPORTED', `Quantumult X 远程分流不支持 ${rule.type}`);
}

export function serializeQxFilter(rules) {
    return serializeProjectedRules(rules, project, { commentPrefix: '#' });
}
