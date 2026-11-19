import { createHandler } from './handler.mjs';

const url = Deno.env.get('SUPABASE_URL');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const hashSecret = Deno.env.get('LEAD_HASH_SECRET');

const encoder = new TextEncoder();
let hmacKey: CryptoKey | null = null;

// Only a keyed, truncated hash of the caller's address is stored, and only for hours.
// The raw address is never logged, stored or returned.
async function identify(req: Request): Promise<string> {
  if (!hashSecret) throw new Error('Missing hash secret');
  // Supabase's gateway appends the real address to any header the caller sent, so the
  // last entry is the one we can trust; a caller cannot pick its own rate-limit key.
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

Deno.serve(createHandler({ identify, rateLimit, insert }));
