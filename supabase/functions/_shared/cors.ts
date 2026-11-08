export const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, idempotency-key, x-mova-artist-business-id',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
