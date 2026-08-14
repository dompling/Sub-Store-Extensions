export interface RuleStudioTargetDefinition {
  name: string;
  path: 'Surge' | 'QX' | 'Clash' | 'Loon';
  icon: string;
}

// These icons are stable Host public assets. Keeping URLs here avoids
// duplicating the same client artwork in every extension package.
export const RULE_STUDIO_TARGET_DEFINITIONS: RuleStudioTargetDefinition[] = [
  { name: 'Surge', path: 'Surge', icon: '/surge.png' },
  { name: 'Quantumult X', path: 'QX', icon: '/quanx.png' },
  { name: 'Clash', path: 'Clash', icon: '/clash.png' },
  { name: 'Loon', path: 'Loon', icon: '/loon.png' },
];
