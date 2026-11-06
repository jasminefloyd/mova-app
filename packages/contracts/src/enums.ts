import { z } from 'zod';

export const CallerClassSchema = z.enum(['artist', 'client', 'guest', 'worker', 'provider']);
export type CallerClass = z.infer<typeof CallerClassSchema>;
