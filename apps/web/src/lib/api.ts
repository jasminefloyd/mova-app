import { createApiEnvelopeSchema } from '@mova/contracts';
import type { z } from 'zod';
import { ApiRequestError } from '@mova/contracts';

export function createRequestId(): string {
  return crypto.randomUUID();
}

export async function requestApi<T extends z.ZodType>(input: {
  url: string;
  dataSchema: T;
  init?: RequestInit;
  fetcher?: typeof fetch;
}): Promise<z.output<T> | null> {
  const requestId = createRequestId();
  const fetcher = input.fetcher ?? fetch;
  const headers = new Headers(input.init?.headers);
  headers.set('x-request-id', requestId);
  const response = await fetcher(input.url, {
    ...input.init,
    headers,
  });
  const envelopeSchema = createApiEnvelopeSchema(input.dataSchema);
  const envelope = envelopeSchema.parse(await response.json());

  if (!response.ok || envelope.error) {
    const failure = envelope.error ?? { code: 'HTTP_ERROR', message: 'Request failed' };
    throw new ApiRequestError({
      code: failure.code,
      message: failure.message,
      ...(failure.details === undefined ? {} : { details: failure.details }),
      requestId: envelope.request_id,
      status: response.status,
    });
  }

  return envelope.data;
}
