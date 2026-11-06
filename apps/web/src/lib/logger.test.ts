import { describe, expect, it } from 'vitest';
import { redactLogContext } from './logger';

describe('redacted logging context', () => {
  it('keeps identifiers and status while dropping unapproved fields', () => {
    const result = redactLogContext({
      requestId: '9bb3a52c-5b9a-4f40-b233-bfc40fce9da1',
      code: 'UPSTREAM_ERROR',
      status: 502,
      message: 'sensitive message text',
      email: 'person@example.test',
    } as Parameters<typeof redactLogContext>[0] & { message: string; email: string });

    expect(result).toEqual({ request_id: '9bb3a52c-5b9a-4f40-b233-bfc40fce9da1', code: 'UPSTREAM_ERROR', status: 502 });
  });
});
