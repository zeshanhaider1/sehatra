import test from 'node:test';
import assert from 'node:assert/strict';
import { createHandler as leads } from '../supabase/functions/lead-capture/handler.mjs';
import { createHandler as analytics } from '../supabase/functions/analytics/handler.mjs';

const origin = 'https://zeshanhaider1.github.io';
const input = {
  name: 'TEST ONLY', clinic: 'TEST FACILITY', city: 'Test City', whatsapp: '03000000000',
  product: 'Product 1: PHC Category-III Clinic Kit (Rs. 4,999)', payment_method: 'Easypaisa',
  notes: 'TEST ONLY'
};
const request = (body, orig = origin) => new Request('https://example.test/', {
  method: 'POST', headers: { origin: orig, 'content-type': 'application/json' }, body: JSON.stringify(body)
});
const deps = (over = {}) => ({
  identify: async () => 'a'.repeat(32),
  rateLimit: async () => true,
  insert: async () => {},
  ...over
});

test('lead saves a valid payload and lets the server decide price and source', async () => {
  let row;
  const h = leads(deps({ insert: async r => { row = r; } }));
  const res = await h(request(input));
  assert.equal(res.status, 201);
  assert.equal(row.price_pkr, 4999);
  assert.equal(row.source, origin + '/sehatra/');
  assert.equal(row.name, 'TEST ONLY');
  assert(!('token' in row) && !('user_agent' in row) && !('website' in row));
});

test('lead rejects spoofed columns, wrong origin, bad phone and unknown product', async () => {
  let inserts = 0;
  const h = leads(deps({ insert: async () => { inserts++; } }));
  const cases = [
    [{ ...input, status: 'approved' }, origin],
    [{ ...input, price_pkr: 1 }, origin],
    [input, 'https://evil.example'],
    [{ ...input, whatsapp: 'x' }, origin],
    [{ ...input, product: 'unknown' }, origin],
    [{ ...input, payment_method: 'Cash' }, origin],
    [{ ...input, name: 'x'.repeat(101) }, origin]
  ];
  for (const [data, o] of cases) assert.notEqual((await h(request(data, o))).status, 201);
  assert.equal(inserts, 0);
});

test('lead enforces the honeypot on the server, not only in the browser', async () => {
  let inserts = 0;
  const h = leads(deps({ insert: async () => { inserts++; } }));
  assert.equal((await h(request({ ...input, website: 'SPAM' }))).status, 400);
  assert.equal((await h(request({ ...input, website: '' }))).status, 201);
  assert.equal(inserts, 1);
});

test('lead returns 429 when the abuse budget is exhausted and never inserts', async () => {
  let inserts = 0;
  const h = leads(deps({ rateLimit: async () => false, insert: async () => { inserts++; } }));
  assert.equal((await h(request(input))).status, 429);
  assert.equal(inserts, 0);
});

test('lead fails closed when the client hash, rate limit or database breaks', async () => {
  const broken = [
    deps({ identify: async () => { throw Error('no secret'); } }),
    deps({ rateLimit: async () => { throw Error('db down'); } }),
    deps({ insert: async () => { throw Error('db down'); } }),
    deps({ identify: async () => '' })
  ];
  for (const d of broken) assert.equal((await leads(d)(request(input))).status, 503);
});

test('lead rejects wrong method, content type, oversized body and non-object JSON', async () => {
  const h = leads(deps());
  const base = { origin, 'content-type': 'application/json' };
  assert.equal((await h(new Request('https://x.test/', { method: 'GET', headers: base }))).status, 405);
  assert.equal((await h(new Request('https://x.test/', { method: 'POST', headers: { origin, 'content-type': 'text/plain' }, body: 'x' }))).status, 415);
  assert.equal((await h(new Request('https://x.test/', { method: 'POST', headers: base, body: 'x'.repeat(9000) }))).status, 413);
  assert.equal((await h(new Request('https://x.test/', { method: 'POST', headers: base, body: '[]' }))).status, 400);
  assert.equal((await h(new Request('https://x.test/', { method: 'OPTIONS', headers: { origin } }))).status, 204);
});

test('analytics accepts only anonymous allowlisted events and respects the budget', async () => {
  let n = 0;
  const h = analytics(async () => ++n === 1);
  assert.equal((await h(request({ event: 'page', label: 'home' }))).status, 204);
  assert.equal((await h(request({ event: 'click', label: 'whatsapp' }))).status, 429);
  for (const b of [
    { event: 'page', label: '?name=person' },
    { event: 'page', label: 'home', name: 'person' },
    { event: 'click', label: 'arbitrary' }
  ]) assert.equal((await h(request(b))).status, 400);
  assert.equal(n, 2);
});
