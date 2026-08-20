const normalizedLabel = (value: unknown) => typeof value === 'string' ? value.trim() : '';

const normalizedNameBase = (value: string) => value
  .trim()
  .replace(/[^a-zA-Z\d._-]+/g, '-')
  .replace(/^-+|-+$/g, '') || 'config';

const uniqueName = (
  baseName: string,
  usedNames: Set<string>,
  separator: '-' | ' ',
) => {
  let name = baseName;
  let suffix = 2;
  while (usedNames.has(name)) {
    name = `${baseName}${separator}${suffix}`;
    suffix += 1;
  }
  return name;
};

export const createConfigProjectDuplicate = (
  project: ConfigProject,
  existingProjects: ConfigProject[],
  copyLabel: string,
): ConfigProject => {
  const duplicate = JSON.parse(JSON.stringify(project)) as ConfigProject;
  const name = uniqueName(
    `${normalizedNameBase(project.name)}-copy`,
    new Set(existingProjects.map(item => item.name)),
    '-',
  );
  const visibleNames = new Set(existingProjects.map(item => (
    normalizedLabel(item.displayName) || item.name
  )));
  const displayNameBase = [
    normalizedLabel(project.displayName) || project.name,
    normalizedLabel(copyLabel) || 'Copy',
  ].join(' ');

  duplicate.name = name;
  duplicate.displayName = uniqueName(displayNameBase, visibleNames, ' ');
  delete duplicate.revision;
  delete duplicate.updated;
  return duplicate;
};
