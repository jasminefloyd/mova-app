import { z } from 'zod';

export const ApiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  details: z.unknown().optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;

export class ApiRequestError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly requestId: string;
  readonly status: number;

  constructor(input: { code: string; message: string; details?: unknown; requestId: string; status: number }) {
    super(input.message);
    this.name = 'ApiRequestError';
    this.code = input.code;
    this.details = input.details;
    this.requestId = input.requestId;
    this.status = input.status;
  }
}
