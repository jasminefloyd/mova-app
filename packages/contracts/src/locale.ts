import { z } from 'zod';

export const LocaleSchema = z.enum(['en-US', 'es-US']);
export type Locale = z.infer<typeof LocaleSchema>;
export const SUPPORTED_LOCALES = LocaleSchema.options;
export const DEFAULT_LOCALE: Locale = 'en-US';
