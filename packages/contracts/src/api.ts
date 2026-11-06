import { z } from 'zod';
import { ApiErrorSchema } from './errors.js';

export function createApiEnvelopeSchema<T extends z.ZodType>(dataSchema: T) {
  return z.object({
    data: z.unknown().nullable(),
    error: ApiErrorSchema.nullable(),
    request_id: z.string().min(1),
  }).transform((envelope) => ({
    ...envelope,
    data: envelope.data === null ? null : dataSchema.parse(envelope.data),
  }));
}

export type ApiEnvelope<T> = { data: T | null; error: z.infer<typeof ApiErrorSchema> | null; request_id: string };
