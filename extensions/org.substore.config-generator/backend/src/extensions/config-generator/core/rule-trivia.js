function decoratedHeadingLabel(text) {
    const match = `${text || ''}`.trim().match(/^=+\s*(.*?)\s*=+$/);
    return match?.[1]?.trim();
}

export function withoutGeneratedPolicyHeading(trivia, policy) {
    const expected = `${policy || ''}`.trim().toLowerCase();
    if (!expected) return trivia;

    const next = [...trivia];
    for (let index = next.length - 1; index >= 0; index--) {
        if (next[index]?.kind !== 'comment') continue;
        const label = decoratedHeadingLabel(next[index].text);
        if (label?.toLowerCase() !== expected) continue;
        next.splice(index, 1);
        break;
    }
    return next;
}

export function mergeSectionedImportedRules(localRules = [], remoteRules = []) {
    const finalIndex = localRules.findIndex((rule) => rule.kind === 'final');
    if (finalIndex < 0) return [...localRules, ...remoteRules];
    return [
        ...localRules.slice(0, finalIndex),
        ...remoteRules,
        ...localRules.slice(finalIndex),
    ];
}
