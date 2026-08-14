export {
    parseProfileSections,
    replaceManagedSections,
    serializeProfileSections,
} from '@/extensions/config-generator/core/profile-sections';
export {
    parseSurgeCsv,
    serializeSurgeCsv,
} from '@/extensions/config-generator/targets/surge/serializer';
export {
    projectIncludedPolicyGroups,
    projectPolicyGroupMembers,
} from '@/extensions/config-generator/core/policy-group-projection';
export {
    createRemoteProxySourceContext,
    projectGroupRemoteProxySource,
} from '@/extensions/config-generator/core/remote-proxy-source';
export {
    resolvePolicyGroupCapability,
} from '@/extensions/config-generator/core/target-capabilities';
export {
    resolveRuleSetSource,
    resolveRuleSetUrl,
} from '@/extensions/config-generator/core/rule-set-source-resolver';
export {
    ConfigGeneratorValidationError,
    validateProject,
    validateRuleSet,
} from '@/extensions/config-generator/validation';
export {
    configProjectResourceRef,
    normalizeResourceRef,
    projectResourceTargets,
    resourceRuleSetDownloadUrl,
    ruleSetRepresentation,
} from '@/extensions/config-generator/core/resource-rule-set';
