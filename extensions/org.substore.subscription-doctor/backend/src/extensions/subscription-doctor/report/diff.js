import { TARGETS } from '../constants.js';

const difference = (current = 0, previous = 0) => Number(current) - Number(previous);

export function reportDiff(current, previous) {
    if (!previous) return null;
    return {
        previousReportId: previous.id,
        checkedAt: previous.checkedAt,
        counts: Object.fromEntries(
            ['total', 'invalid', 'duplicate', 'duplicateName'].map((key) => [
                key,
                difference(current.counts?.[key], previous.counts?.[key]),
            ]),
        ),
        protocols: Object.fromEntries(
            [...new Set([
                ...Object.keys(current.protocols || {}),
                ...Object.keys(previous.protocols || {}),
            ])]
                .sort()
                .map((protocol) => [
                    protocol,
                    difference(
                        current.protocols?.[protocol],
                        previous.protocols?.[protocol],
                    ),
                ]),
        ),
        targets: Object.fromEntries(
            TARGETS.map((target) => [
                target,
                Object.fromEntries(
                    ['exact', 'fallback', 'filtered', 'unknown'].map((state) => [
                        state,
                        difference(
                            current.targets?.[target]?.[state],
                            previous.targets?.[target]?.[state],
                        ),
                    ]),
                ),
            ]),
        ),
    };
}
