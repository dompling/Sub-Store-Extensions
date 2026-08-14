import { references } from '../sdk';
import {
    readConfigGeneratorStore,
    writeConfigGeneratorStore,
} from '../store';
import {
    configProjectResourceRef,
    projectResourceTargets,
} from './resource-rule-set';

function safeErrorCode(error) {
    return typeof error?.code === 'string'
        ? error.code
        : 'REFERENCE_INDEX_REPAIR_FAILED';
}

function writeReferenceIndexState(state) {
    const store = readConfigGeneratorStore();
    store.referenceIndex = state;
    writeConfigGeneratorStore(store);
    return state;
}

export async function replaceProjectResourceReferences(project, ruleSets) {
    try {
        const targets = project
            ? projectResourceTargets(project, ruleSets)
            : [];
        const owner = configProjectResourceRef(project);
        await references.replaceOwn({ owner, targets });
        writeReferenceIndexState({
            state: 'healthy',
            repairedAt: Date.now(),
        });
        return { owner, targets };
    } catch (error) {
        writeReferenceIndexState({
            state: 'repair-needed',
            failedAt: Date.now(),
            reasonCode: safeErrorCode(error),
        });
        throw error;
    }
}

export async function clearProjectResourceReferences(projectName) {
    return replaceProjectResourceReferences(
        { name: projectName, rules: [] },
        [],
    );
}

export async function repairConfigGeneratorReferences() {
    const store = readConfigGeneratorStore();
    try {
        for (const project of store.projects) {
            await references.replaceOwn({
                owner: configProjectResourceRef(project),
                targets: projectResourceTargets(project, store.ruleSets),
            });
        }
        return writeReferenceIndexState({
            state: 'healthy',
            repairedAt: Date.now(),
            projectCount: store.projects.length,
        });
    } catch (error) {
        writeReferenceIndexState({
            state: 'repair-needed',
            failedAt: Date.now(),
            reasonCode: safeErrorCode(error),
        });
        throw error;
    }
}

export function scheduleConfigGeneratorReferenceRepair() {
    Promise.resolve()
        .then(() => repairConfigGeneratorReferences())
        .catch(() => undefined);
}
