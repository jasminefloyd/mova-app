// Stand-in for Supabase Edge Functions during E2E, for requests made by the server (SSR loaders).
// Browser requests are still mocked per test with page.route. Listens where VITE_SUPABASE_URL points in run-e2e.mjs.
import http from 'node:http';
import { readFileSync } from 'node:fs';

const artists = JSON.parse(readFileSync(new URL('./public-artists.json', import.meta.url), 'utf8'));
const port = Number(process.env.MOCK_EDGE_PORT || 54321);
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

http.createServer((req, res) => {
  if (req.url === '/health') return send(res, 200, { ok: true });
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    if (req.method === 'POST' && req.url === '/functions/v1/public-artist') {
      const handle = (() => { try { return JSON.parse(raw).handle; } catch { return ''; } })();
      const artist = artists[handle];
      return artist ? send(res, 200, { data: artist, error: null, request_id: 'e2e-mock-edge' }) : send(res, 404, { data: { code: 'NOT_FOUND' }, error: null, request_id: 'e2e-mock-edge' });
    }
    // Anything else behaves like no server at all, as before this stand-in existed.
    req.socket.destroy();
  });
}).listen(port, '127.0.0.1', () => console.log(`mock edge on ${port}`));
