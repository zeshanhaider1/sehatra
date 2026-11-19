// @ts-nocheck
// Sehatra aggregate analytics. Self-contained single-file build for deployment
// (same rules as supabase/functions/analytics/handler.mjs).
const origin = 'https://zeshanhaider1.github.io';
const cors = {
  'Access-Control-Allow-Origin': origin,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  'Cache-Control': 'no-store'
};
const pages = new Set(['home', 'products', 'software', 'services', 'how', 'order', 'phc', 'faq']);

const url = Deno.env.get('SUPABASE_URL');
const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

async function record(b: any): Promise<boolean> {
  if (!url || !key) throw new Error('Missing database configuration');
  const r = await fetch(`${url}/rest/v1/rpc/record_site_event`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_event: b.event, p_label: b.label }),
    signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('Aggregation failed');
  return await r.json();
}

Deno.serve(async (req: Request) => {
  if (req.headers.get('origin') !== origin) return new Response(null, { status: 403 });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response(null, { status: 405, headers: cors });
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return new Response(null, { status: 415, headers: cors });
  }
  const raw = await req.text();
  if (raw.length > 256) return new Response(null, { status: 413, headers: cors });
  let b: any;
  try { b = JSON.parse(raw); } catch { return new Response(null, { status: 400, headers: cors }); }
  if (!b || typeof b !== 'object' || Array.isArray(b) ||
      Object.keys(b).sort().join(',') !== 'event,label' ||
      !((b.event === 'page' && pages.has(b.label)) || (b.event === 'click' && ['whatsapp', 'order'].includes(b.label)))) {
    return new Response(null, { status: 400, headers: cors });
  }
  try {
    const ok = await record(b);
    return new Response(null, { status: ok ? 204 : 429, headers: cors });
  } catch {
    return new Response(null, { status: 503, headers: cors });
  }
});
