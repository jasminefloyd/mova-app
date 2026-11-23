const serve = Deno.serve;
const repo = Deno.env.get('MOVA_QA_REPO')!;
type Handler = (request: Request) => Response | Promise<Response>;
const handlers = new Map<string, Handler>();
let importQueue = Promise.resolve();
const cors = {
  'access-control-allow-origin':'*',
  'access-control-allow-methods':'GET,POST,OPTIONS,PATCH,PUT,DELETE,HEAD',
  'access-control-allow-headers':'*',
  'access-control-expose-headers':'content-range,x-request-id,location',
};
async function load(name: string) {
  const job = importQueue.then(async () => {
    if (handlers.has(name)) return;
    Deno.serve = ((handler: Handler) => { handlers.set(name, handler); }) as typeof Deno.serve;
    try { await import(`file://${encodeURI(repo)}/supabase/functions/${name}/index.ts`); }
    finally { Deno.serve = serve; }
  });
  importQueue = job.catch(() => {});
  await job;
  return handlers.get(name);
}
serve({hostname:'127.0.0.1',port:55421}, async (request) => {
  const url=new URL(request.url);
  if (request.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
  const flow=url.pathname.match(/^\/(auth\/v1|rest\/v1|functions\/v1|templates)(?:\/(.*))?$/);
  if (!flow) return new Response(JSON.stringify({message:'QA native gateway'}),{headers:cors});
  const [,api,suffix='']=flow;
  try {
    if(api==='templates' && /^[a-z_]+\.html$/.test(suffix)) return new Response(await Deno.readTextFile(`${repo}/supabase/templates/${suffix}`),{headers:{'content-type':'text/html'}});
    let response: Response;
    if (api==='functions/v1') {
      const name=suffix.split('/')[0];
      if (!/^[a-z-]+$/.test(name)) return new Response(null,{status:404});
      const handler=await load(name);
      response=handler ? await handler(request) : new Response(null,{status:404});
    } else {
      const port=api==='auth/v1'?55425:55426;
      const headers=new Headers(request.headers);
      headers.delete('host');
      response=await fetch(`http://127.0.0.1:${port}/${suffix}${url.search}`,{
        method:request.method,headers,redirect:'manual',
        ...(['GET','HEAD'].includes(request.method)?{}:{body:await request.arrayBuffer()}),
      });
    }
    const headers=new Headers(response.headers);
    for (const [key,val] of Object.entries(cors)) headers.set(key,val);
    return new Response(response.body,{status:response.status,headers});
  } catch (error) {
    console.error(api,suffix.split('/')[0],error instanceof Error ? error.message.split('\n')[0] : 'runtime error');
    return Response.json({code:'QA_RUNTIME_ERROR'},{status:500,headers:cors});
  }
});
