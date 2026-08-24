import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { transformWithEsbuild } from 'vite';

let extractConfigGeneratorApiError;
let getConfigGeneratorErrorDetails;

before(async () => {
  const moduleUrl = new URL(
    '../frontend/src/extensions/config-generator/domain/requestError.ts',
    import.meta.url,
  );
  const source = await readFile(moduleUrl, 'utf8');
  const transformed = await transformWithEsbuild(source, fileURLToPath(moduleUrl), {
    format: 'esm',
    loader: 'ts',
    target: 'es2020',
  });
  const executableUrl = `data:text/javascript;base64,${Buffer.from(transformed.code).toString('base64')}`;
  ({ extractConfigGeneratorApiError, getConfigGeneratorErrorDetails } = await import(executableUrl));
});

test('keeps validation details when the Host returns a normal Axios response', () => {
  const error = extractConfigGeneratorApiError({
    response: {
      data: {
        status: 'failed',
        error: {
          code: 'CONFIG_GENERATOR_VALIDATION_FAILED',
          type: 'RequestInvalidError',
          message: 'Config generator validation failed',
          details: [{ path: 'rules[2].ruleSet', message: 'references a missing rule set' }],
        },
      },
    },
  });

  assert.equal(error.code, 'CONFIG_GENERATOR_VALIDATION_FAILED');
  assert.deepEqual(getConfigGeneratorErrorDetails(error), [
    { path: 'rules[2].ruleSet', message: 'references a missing rule set' },
  ]);
});

test('recovers details nested below data, cause, and a serialized Host message', () => {
  const details = [{ path: 'groups[0].members[1].value', message: 'references a missing policy group' }];
  const error = extractConfigGeneratorApiError({
    name: 'Error',
    message: JSON.stringify({
      status: 'failed',
      error: {
        code: 'CONFIG_GENERATOR_VALIDATION_FAILED',
        details,
      },
    }),
    status: 400,
    cause: { data: { status: 'failed', error: { details } } },
  });

  assert.equal(error.code, 'CONFIG_GENERATOR_VALIDATION_FAILED');
  assert.deepEqual(getConfigGeneratorErrorDetails(error), details);
});

test('does not turn a generic status message into a fake structured issue', () => {
  const error = extractConfigGeneratorApiError(
    new Error('Config generator validation failed\nstatus: 400\ncode: CONFIG_GENERATOR_VALIDATION_FAILED'),
  );

  assert.equal(error.code, 'CONFIG_GENERATOR_VALIDATION_FAILED');
  assert.deepEqual(getConfigGeneratorErrorDetails(error), []);
});
