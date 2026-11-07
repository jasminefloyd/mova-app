/* global __ENV */
import http from 'k6/http';
import { check } from 'k6';

const supabaseUrl = __ENV.MOVA_TEST_SUPABASE_URL;
const anonKey = __ENV.MOVA_TEST_SUPABASE_ANON_KEY;
const artistToken = __ENV.MOVA_TEST_ARTIST_ACCESS_TOKEN;
const businessId = __ENV.MOVA_TEST_ARTIST_BUSINESS_ID;

if (!supabaseUrl || !anonKey || !artistToken || !businessId) {
  throw new Error('Set local Supabase URL, anon key, seeded artist access token, and business UUID in MOVA_TEST_* variables.');
}
const target = new URL(supabaseUrl);
if (!['localhost', '127.0.0.1', '::1'].includes(target.hostname)) {
  throw new Error('This load scenario is restricted to a local Supabase host. Production load tests are not authorized by this script.');
}

export const options = {
  scenarios: { reports_90_day: { executor: 'constant-vus', vus: 5, duration: '1m' } },
  thresholds: { http_req_duration: ['p(95)<1500'], checks: ['rate>0.99'] },
};

export default function () {
  const response = http.post(`${supabaseUrl.replace(/\/$/, '')}/functions/v1/reports-summary`, JSON.stringify({ period: 90 }), {
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${artistToken}`,
      'x-mova-artist-business-id': businessId,
    },
  });
  check(response, { 'reports summary returns 200': (res) => res.status === 200 });
}
