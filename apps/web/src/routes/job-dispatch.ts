import type { LoaderFunctionArgs } from 'react-router';

export async function loader({ request }: LoaderFunctionArgs) {
  const env = typeof process !== 'undefined' ? process.env : undefined;
  const cronSecret = env?.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) return new Response('Unauthorized', { status: 401 });
  const url = env?.SUPABASE_URL;
  const serviceKey = env?.SUPABASE_SERVICE_ROLE_KEY;
  const dispatchSecret = env?.MOVA_JOB_DISPATCH_SECRET;
  const workerSecret = env?.MOVA_JOB_WORKER_SECRET;
  if (!url || !serviceKey || !dispatchSecret || !workerSecret) return Response.json({ error: 'Server configuration missing' }, { status: 503 });

  const base = `${url.replace(/\/$/, '')}/functions/v1`;
  const headers = { apikey: serviceKey, 'Content-Type': 'application/json' };
  try {
    const dispatchResponse = await fetch(`${base}/job-dispatch`, {
      method: 'POST', headers: { ...headers, 'x-mova-job-secret': dispatchSecret }, body: JSON.stringify({ limit: 100 }),
    });
    const dispatched = await dispatchResponse.json().catch(() => null);
    if (!dispatchResponse.ok) return Response.json({ error: 'Job dispatch failed' }, { status: 503 });

    const workerResponse = await fetch(`${base}/job-worker`, {
      method: 'POST', headers: { ...headers, 'x-mova-job-secret': workerSecret }, body: JSON.stringify({ limit: 25 }),
    });
    const worked = await workerResponse.json().catch(() => null);
    if (!workerResponse.ok) return Response.json({ error: 'Job worker failed', enqueued: dispatched?.data?.enqueued ?? null }, { status: 503 });
    return Response.json({ dispatch: dispatched?.data ?? null, worker: worked?.data ?? null });
  } catch {
    return Response.json({ error: 'Job scheduler unavailable' }, { status: 503 });
  }
}
