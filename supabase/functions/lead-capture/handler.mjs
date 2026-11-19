// Pure request logic for the public lead-capture endpoint.
// No Deno or network APIs here so the rules can be tested in plain Node.
// The caller injects: identify(req) -> rate-limit key, rateLimit(key) -> bool,
// insert(row) -> void. Any dependency that throws fails the request closed.

const ALLOWED_ORIGIN = 'https://zeshanhaider1.github.io';

const PRODUCTS = new Map([
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

const json = (status, message) => new Response(JSON.stringify({ message }), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' }
});

// Printable text only, trimmed, non-empty, within the field limit.
const text = (value, max) => typeof value === 'string' &&
  value.trim().length > 0 &&
  value.trim().length <= max &&
  !/[\u0000-\u001f\u007f]/.test(value);

// Fields the browser is allowed to send. Anything else is rejected rather than ignored
// so a caller cannot smuggle a column such as status or price_pkr into the row.
const ALLOWED_FIELDS = ['name', 'clinic', 'city', 'whatsapp', 'product', 'payment_method', 'notes', 'website'];

export function createHandler({ identify, rateLimit, insert }) {
  return async function handle(req) {
    if (req.headers.get('origin') !== ALLOWED_ORIGIN) return json(403, 'Origin rejected');
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (req.method !== 'POST') return json(405, 'Method not allowed');
    if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
      return json(415, 'JSON required');
    }

    const raw = await req.text();
    if (raw.length > 8192) return json(413, 'Request too large');

    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(400, 'Invalid request');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, 'Invalid request');

    if (Object.keys(body).some(key => !ALLOWED_FIELDS.includes(key))) return json(400, 'Unexpected field');

    // Honeypot is enforced server-side, not only in the browser.
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
      // A per-client and global budget keeps a scripted flood from filling the table.
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
      // Verification, rate-limit and database failures all fail closed.
      return json(503, 'Unable to save');
    }
  };
}
