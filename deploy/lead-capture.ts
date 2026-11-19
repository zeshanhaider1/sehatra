// @ts-nocheck
// Sehatra public lead capture. Self-contained single-file build for deployment
// (same rules as supabase/functions/lead-capture/handler.mjs).
const ALLOWED_ORIGIN = 'https://zeshanhaider1.github.io';

const PRODUCTS = new Map<string, number>([
  ['Product 1: PHC Category-III Clinic Kit (Rs. 4,999)', 4999],
  ['Product 2: Hospital Staff HR Dossier Pack (Rs. 4,999)', 4999],
  ['Product 3: Hospital Statutory Committees Toolkit (Rs. 6,999)', 6999],
  ['Product 4: Infection Control & Waste Bundle (Rs. 2,999)', 2999],
  ['Complete Master Accreditation Vault (All 4 Products) - Rs. 30,000', 30000]
]);

const PAYMENTS = new Set(['Raast / Direct Bank Transfer', 'Easypaisa', 'JazzCash']);
const LIMITS = { name: 100, clinic: 150, city: 80, whatsapp: 25, notes: 1000 };

const CORS = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, prefer, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
  'Cache-Control': 'no-store'
};

const json = (status: number, message: string) => new Response(JSON.stringify({ message }), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});

const text = (value: unknown, max: number): boolean => typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);

const ALLOWED_FIELDS = ['name', 'clinic', 'city', 'whatsapp', 'product', 'payment_method', 'notes', 'website'];

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const hashSecret = Deno.env.get('LEAD_HASH_SECRET');

const encoder = new TextEncoder();
let hmacKey: CryptoKey | null = null;

async function identify(req: Request): Promise<string> {
  if (!hashSecret) throw new Error('Missing hash secret');
  const forwarded = (req.headers.get('x-forwarded-for') || '')
    .split(',').map(part => part.trim()).filter(Boolean).pop();
  const address = forwarded || req.headers.get('cf-connecting-ip') || 'unknown';
  if (!hmacKey) {
    hmacKey = await crypto.subtle.importKey(
      'raw', encoder.encode(hashSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
  }
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(address)));
  return [...sig.slice(0, 16)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function rateLimit(key: string): Promise<boolean> {
  if (!url || !serviceKey) throw new Error('Missing database configuration');
  const res = await fetch(`${url}/rest/v1/rpc/record_lead_attempt`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ p_key: key }),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error('Rate limit check failed');
  return (await res.json()) === true;
}

async function insert(row: Record<string, unknown>): Promise<void> {
  if (!url || !serviceKey) throw new Error('Missing database configuration');
  const res = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify(row),
    signal: AbortSignal.timeout(8000)
  });
  if (!res.ok) throw new Error('Database insert failed');
}

async function handle(req: Request): Promise<Response> {
  if (req.headers.get('origin') !== ALLOWED_ORIGIN) return json(403, 'Origin rejected');
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json(405, 'Method not allowed');
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return json(415, 'JSON required');
  }

  const raw = await req.text();
  if (raw.length > 8192) return json(413, 'Request too large');

  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return json(400, 'Invalid request');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, 'Invalid request');
  if (Object.keys(body).some(key => !ALLOWED_FIELDS.includes(key))) return json(400, 'Unexpected field');
  if (body.website != null && String(body.website).trim() !== '') return json(400, 'Invalid fields');

  const phone = typeof body.whatsapp === 'string' ? body.whatsapp.trim() : '';
  const valid =
    text(body.name, LIMITS.name) &&
    text(body.clinic, LIMITS.clinic) &&
    text(body.city, LIMITS.city) &&
    text(body.whatsapp, LIMITS.whatsapp) &&
    /^\+?[0-9 ()-]{7,25}$/.test(phone) &&
    PRODUCTS.has(body.product) &&
    PAYMENTS.has(body.payment_method) &&
    (body.notes == null || body.notes === '' || text(body.notes, LIMITS.notes));

  if (!valid) return json(400, 'Invalid fields');

  try {
    const key = await identify(req);
    if (!key) return json(503, 'Unable to save');
    if (!(await rateLimit(key))) return json(429, 'Too many requests');
    await insert({
      name: body.name.trim(),
      clinic: body.clinic.trim(),
      city: body.city.trim(),
      whatsapp: phone,
      product: body.product,
      payment_method: body.payment_method,
      notes: body.notes ? body.notes.trim() : null,
      price_pkr: PRODUCTS.get(body.product),
      source: ALLOWED_ORIGIN + '/sehatra/'
    });
    return json(201, 'Saved');
  } catch {
    return json(503, 'Unable to save');
  }
}

Deno.serve(handle);
