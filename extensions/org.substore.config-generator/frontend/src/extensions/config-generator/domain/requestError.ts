export type ConfigGeneratorApiError = {
  code?: string;
  type?: string;
  message?: string;
  details?: unknown;
  issues?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value)
  && typeof value === 'object';

const nonEmptyString = (value: unknown) => typeof value === 'string' && value.trim()
  ? value.trim()
  : undefined;

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text) return value;

  const candidates = [text];
  const objectStart = text.indexOf('{');
  const objectEnd = text.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    candidates.push(text.slice(objectStart, objectEnd + 1));
  }
  const arrayStart = text.indexOf('[');
  const arrayEnd = text.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    candidates.push(text.slice(arrayStart, arrayEnd + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch (_) {
      // The Host may append plain-text status lines after the error message.
    }
  }
  return value;
};

const apiErrorCandidate = (value: unknown): ConfigGeneratorApiError | undefined => {
  if (!isRecord(value)) return undefined;
  const candidate: ConfigGeneratorApiError = {
    code: nonEmptyString(value.code),
    type: nonEmptyString(value.type),
    message: nonEmptyString(value.message),
    details: value.details,
    issues: value.issues,
  };
  return candidate.code
    || candidate.type
    || candidate.message
    || candidate.details !== undefined
    || candidate.issues !== undefined
    ? candidate
    : undefined;
};

const textErrorCandidate = (value: unknown): ConfigGeneratorApiError | undefined => {
  if (typeof value !== 'string') return undefined;
  const code = value.match(/(?:^|\n|\s)code:\s*([A-Z0-9][A-Z0-9_.-]*)/i)?.[1];
  const type = value.match(/(?:^|\n|\s)type:\s*([A-Za-z][A-Za-z0-9_.-]*)/i)?.[1];
  return code || type ? { code, type } : undefined;
};

const candidateScore = (candidate: ConfigGeneratorApiError) =>
  (candidate.issues !== undefined ? 120 : 0)
  + (candidate.details !== undefined ? 100 : 0)
  + (candidate.code ? 20 : 0)
  + (candidate.type ? 10 : 0)
  + (candidate.message ? 5 : 0);

const failedEnvelopeError = (value: unknown): ConfigGeneratorApiError | undefined => {
  if (!isRecord(value) || value.status !== 'failed') return undefined;
  return apiErrorCandidate(value.error);
};

export const apiErrorFromResponse = (response: unknown): ConfigGeneratorApiError | undefined => {
  if (!isRecord(response)) return undefined;
  const responseData = response.data;
  return failedEnvelopeError(responseData)
    || (isRecord(responseData) ? failedEnvelopeError(responseData.data) : undefined)
    || failedEnvelopeError(response);
};

export const extractConfigGeneratorApiError = (
  input: unknown,
): ConfigGeneratorApiError | undefined => {
  const queue: Array<{ value: unknown; depth: number }> = [{ value: input, depth: 0 }];
  const visited = new Set<object>();
  const candidates: ConfigGeneratorApiError[] = [];
  const nestedKeys = ['response', 'data', 'body', 'payload', 'error', 'cause'] as const;

  while (queue.length) {
    const current = queue.shift();
    if (!current || current.depth > 6) continue;
    const parsed = parseJsonValue(current.value);
    const textCandidate = textErrorCandidate(parsed);
    if (textCandidate) candidates.push(textCandidate);
    if (!isRecord(parsed)) continue;
    if (visited.has(parsed)) continue;
    visited.add(parsed);

    const envelopeError = failedEnvelopeError(parsed);
    if (envelopeError) candidates.push(envelopeError);
    const candidate = apiErrorCandidate(parsed);
    if (candidate) candidates.push(candidate);

    nestedKeys.forEach((key) => {
      const nested = parsed[key];
      if (nested !== undefined && nested !== parsed) {
        queue.push({ value: nested, depth: current.depth + 1 });
      }
    });
    if (typeof parsed.message === 'string') {
      const messageCandidate = textErrorCandidate(parsed.message);
      if (messageCandidate) candidates.push(messageCandidate);
      const parsedMessage = parseJsonValue(parsed.message);
      if (parsedMessage !== parsed.message) {
        queue.push({ value: parsedMessage, depth: current.depth + 1 });
      }
    }
  }

  if (!candidates.length) return undefined;
  candidates.sort((left, right) => candidateScore(right) - candidateScore(left));
  const preferred = { ...candidates[0] };
  for (const candidate of candidates.slice(1)) {
    preferred.code ||= candidate.code;
    preferred.type ||= candidate.type;
    preferred.message ||= candidate.message;
    if (preferred.details === undefined) preferred.details = candidate.details;
    if (preferred.issues === undefined) preferred.issues = candidate.issues;
  }
  return preferred;
};

const detailsArray = (value: unknown): unknown[] => {
  const parsed = parseJsonValue(value);
  if (Array.isArray(parsed)) return parsed;
  if (isRecord(parsed)) {
    if (Array.isArray(parsed.issues)) return parsed.issues;
    if (Array.isArray(parsed.details)) return parsed.details;
  }
  return parsed === undefined || parsed === null ? [] : [parsed];
};

export const getConfigGeneratorErrorDetails = (error: unknown): unknown[] => {
  const normalized = extractConfigGeneratorApiError(error);
  return detailsArray(normalized?.issues ?? normalized?.details);
};
