import { z } from 'zod';

export const discoveryPath = z.string().regex(/^\/(?:features|pricing|calculator|signup|guides(?:\/[a-z0-9-]{1,140})?)?$/);
export const discoveryLabel = z.string().regex(/^[a-z0-9._-]{0,100}$/);
export const discoveryEvent = z.object({
  visit: z.string().uuid(),
  event: z.string().uuid(),
  path: discoveryPath,
  landing: discoveryPath,
  channel: z.enum(['organic search', 'paid search', 'social', 'email', 'referral', 'direct / unknown', 'other campaign']),
  source: discoveryLabel,
  medium: discoveryLabel,
  campaign: discoveryLabel,
  signupClick: z.boolean(),
}).strict();
export type DiscoveryEvent = z.infer<typeof discoveryEvent>;
