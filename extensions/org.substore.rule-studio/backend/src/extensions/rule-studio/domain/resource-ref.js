import {
    RULE_STUDIO_CONTRACT,
    RULE_STUDIO_CONTRIBUTION_ID,
    RULE_STUDIO_EXTENSION_ID,
    RULE_STUDIO_RESOURCE_TYPE,
} from '../constants';
import { assertRuleStudio } from '../errors';

export function createRuleSetRef(id) {
    return Object.freeze({
        schema: 'substore.resource-ref@1',
        providerId: RULE_STUDIO_EXTENSION_ID,
        providerContributionId: RULE_STUDIO_CONTRIBUTION_ID,
        type: RULE_STUDIO_RESOURCE_TYPE,
        id,
        contract: RULE_STUDIO_CONTRACT,
    });
}

export function assertOwnRuleSetRef(ref) {
    assertRuleStudio(
        ref?.schema === 'substore.resource-ref@1' &&
            ref.providerId === RULE_STUDIO_EXTENSION_ID &&
            ref.providerContributionId === RULE_STUDIO_CONTRIBUTION_ID &&
            ref.type === RULE_STUDIO_RESOURCE_TYPE &&
            ref.contract === RULE_STUDIO_CONTRACT &&
            typeof ref.id === 'string' &&
            ref.id,
        'RESOURCE_REF_INVALID',
        '规则集资源引用无效',
    );
    return ref;
}
