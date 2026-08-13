export interface PolicyGroupReferenceRenameResult {
  rulePolicies: number;
  memberPolicies: number;
  includedGroups: number;
  subnetPolicies: number;
  total: number;
}

const emptyResult = (): PolicyGroupReferenceRenameResult => ({
  rulePolicies: 0,
  memberPolicies: 0,
  includedGroups: 0,
  subnetPolicies: 0,
  total: 0,
});

const renameConditionalValue = (value: string, nextName: string) => {
  const separator = value.lastIndexOf(':');
  if (separator < 0) return value;
  return `${value.slice(0, separator + 1)}${nextName}`;
};

export const renamePolicyGroupReferences = (
  project: Pick<ConfigProject, 'groups' | 'rules'>,
  previousName: string,
  nextName: string,
): PolicyGroupReferenceRenameResult => {
  const previous = String(previousName || '').trim();
  const next = String(nextName || '').trim();
  const result = emptyResult();
  if (!previous || !next || previous === next) return result;

  (project.groups || []).forEach((group) => {
    (group.members || []).forEach((member) => {
      if (member.kind === 'group' && member.value === previous) {
        member.value = next;
        result.memberPolicies += 1;
        return;
      }
      if (member.kind === 'conditional' && member.policy === previous) {
        member.policy = next;
        member.value = renameConditionalValue(member.value, next);
        result.memberPolicies += 1;
      }
    });

    if (group.includeOtherGroups?.length) {
      group.includeOtherGroups = [...new Set(group.includeOtherGroups.map((name) => {
        if (name !== previous) return name;
        result.includedGroups += 1;
        return next;
      }))];
    }

    const surgeOptions = group.targetOptions?.surge;
    if (surgeOptions?.subnetDefault === previous) {
      surgeOptions.subnetDefault = next;
      result.subnetPolicies += 1;
    }
    (surgeOptions?.subnetRules || []).forEach((rule) => {
      if (rule.policy !== previous) return;
      rule.policy = next;
      result.subnetPolicies += 1;
    });
  });

  (project.rules || []).forEach((rule) => {
    if (!('policy' in rule) || rule.policy !== previous) return;
    rule.policy = next;
    result.rulePolicies += 1;
  });

  result.total = result.rulePolicies
    + result.memberPolicies
    + result.includedGroups
    + result.subnetPolicies;
  return result;
};
