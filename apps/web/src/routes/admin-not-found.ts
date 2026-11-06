export function loader() { return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } }); }
export default function AdminNotFound() { return null; }
