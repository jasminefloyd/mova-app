Deno.test('Concierge review is tenant-scoped and permits reads only', async () => {
  const reviewBusiness = 'e2500000-0000-4000-8000-000000000001';
  const otherBusiness = 'e2500000-0000-4000-8000-000000000002';
  const localEnv = {
    SUPABASE_URL: 'http://supabase.local',
    SUPABASE_ANON_KEY: 'local-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'local-service',
    MOVA_CONCIERGE_REVIEW_BUSINESS_ID: reviewBusiness,
  };
  const originalEnv = Object.keys(localEnv).map((key) => [key, Deno.env.get(key)] as const);
  const savedFetch = globalThis.fetch;
  const savedServe = Deno.serve;
  const server: { handle?: (request: Request) => Promise<Response> } = {};
  let entitled = true;
  let writeAttempted = false;

  try {
    for (const [key, value] of Object.entries(localEnv)) Deno.env.set(key, value);
    Deno.serve = ((handler: (request: Request) => Promise<Response>) => { server.handle = handler; }) as unknown as typeof Deno.serve;
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      const url = new URL(request.url);
      const authorization = request.headers.get('authorization');
      if (url.pathname === '/auth/v1/user') {
        return Promise.resolve(Response.json({ id: 'e2500000-0000-4000-8000-000000000099', role: 'authenticated' }));
      }
      if (url.pathname === '/rest/v1/mova_artist_memberships') {
        const permitted = authorization === 'Bearer demo-token' ? reviewBusiness : otherBusiness;
        return Promise.resolve(Response.json(url.searchParams.get('artist_business_id') === `eq.${permitted}`
          ? [{ artist_business_id: permitted }] : []));
      }
      if (url.pathname.endsWith('/mova_feature_gate')) return Promise.resolve(Response.json({ enabled: entitled }));
      if (url.pathname.endsWith('/mova_platform_switches')) return Promise.resolve(Response.json([{ enabled: false }]));
      if (url.pathname.endsWith('/mova_system_log_append')) return Promise.resolve(Response.json(null));
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        writeAttempted = true;
        return Promise.resolve(Response.json({ error: 'Unexpected write' }, { status: 500 }));
      }
      return Promise.resolve(Response.json([]));
    }) as typeof fetch;
    await import('./index.ts');
    if (!server.handle) throw new Error('Concierge handler did not start');
    const handle = server.handle;
    async function call(action: string, business: string, token: string) {
      const response = await handle(new Request('http://local/functions/v1/concierge-artist', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'x-mova-artist-business-id': business },
        body: JSON.stringify({ action, conversation_id: 'fixture-conversation' }),
      }));
      return { status: response.status, payload: await response.json() };
    }
    const preview = await call('status', reviewBusiness, 'demo-token');
    if (preview.status !== 200 || preview.payload.data?.aiEnabled !== false) throw new Error('Paused business could not read its review inbox');
    const thread = await call('conversation', reviewBusiness, 'demo-token');
    if (thread.status !== 200) throw new Error('Paused business could not read its review thread');
    for (const action of ['save-settings', 'human-reply', 'unpause', 'save-knowledge', 'save-quote-estimate']) {
      const reply = await call(action, reviewBusiness, 'demo-token');
      if (reply.status !== 403 || reply.payload.error?.code !== 'CONCIERGE_REVIEW_ONLY') throw new Error(`Review allowed ${action}`);
    }
    const outsider = await call('status', otherBusiness, 'other-token');
    if (outsider.status !== 403 || outsider.payload.error?.code !== 'CONCIERGE_FEATURE_DISABLED') throw new Error('Review was visible to an unrelated business');
    if ((await call('status', reviewBusiness, 'other-token')).status !== 401) throw new Error('Business header bypassed membership validation');
    entitled = false;
    if ((await call('status', reviewBusiness, 'demo-token')).payload.error?.code !== 'PLAN_FEATURE_NOT_INCLUDED') throw new Error('Review bypassed plan entitlement');
    if (writeAttempted) throw new Error('A review action tried to write application data');
  } finally {
    globalThis.fetch = savedFetch;
    Deno.serve = savedServe;
    for (const [key, value] of originalEnv) {
      if (value === undefined) Deno.env.delete(key);
      else Deno.env.set(key, value);
    }
  }
});
