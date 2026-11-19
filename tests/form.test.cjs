// Runs the real script.js against a small DOM stub: checks what the browser sends,
// how it reports success and failure, and that nothing personal is persisted locally.
const fs = require('fs'), vm = require('vm'), assert = require('assert');

const events = {}, fields = {}, classes = { add() {}, remove() {}, toggle() {} };
const values = {
  fullName: 'TEST ONLY', clinicName: 'TEST FACILITY', city: 'Test City',
  whatsappNumber: '03000000000', productSelect: 'Product 1: PHC Category-III Clinic Kit (Rs. 4,999)',
  notes: '', website: ''
};
for (const [id, value] of Object.entries(values)) fields[id] = { value };
fields.orderForm = {
  addEventListener: (name, fn) => { events.submit = fn; },
  reportValidity() { throw Error('Unexpected invalid form'); },
  reset() { for (const [id] of Object.entries(values)) fields[id].value = ''; }
};
fields.orderIdValue = {};
fields.orderSaveStatus = {};
fields.modalWaBtn = {};
fields.successModal = { classList: classes, setAttribute() {} };

const doc = {
  addEventListener: (name, fn) => { if (name === 'DOMContentLoaded') (events.ready ??= []).push(fn); },
  getElementById: id => fields[id],
  querySelectorAll: () => [],
  querySelector: () => null,
  readyState: 'loading'
};

let writes = 0, requests = [], fail = false;
const context = {
  document: doc,
  window: {
    location: { origin: 'https://example.test', pathname: '/site/', href: 'https://example.test/site/?private=1' },
    open: () => null,
    addEventListener() {},
    scrollTo() {}
  },
  location: { hash: '' },
  history: { replaceState() {} },
  navigator: { userAgent: 'sensitive-agent' },
  localStorage: { getItem() { throw Error('unexpected storage read'); }, setItem() { writes += 1; } },
  fetch: async (url, opts) => {
    requests.push(JSON.parse(opts.body));
    if (fail) throw Error('offline');
    return { ok: true };
  },
  console, setTimeout, Date, Math, encodeURIComponent
};

vm.createContext(context);
vm.runInContext(fs.readFileSync('script.js', 'utf8'), context);
for (const fn of events.ready) fn();

(async () => {
  // 1. Happy path: one POST to the function, only form fields, no fingerprinting.
  events.submit({ preventDefault() {} });
  await new Promise(r => setImmediate(r));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].name, 'TEST ONLY');
  assert.deepEqual(Object.keys(requests[0]).sort(),
    ['city', 'clinic', 'name', 'notes', 'payment_method', 'product', 'whatsapp']);
  assert(!('source' in requests[0]) && !('user_agent' in requests[0]) && !('price_pkr' in requests[0]));
  assert.match(fields.orderSaveStatus.textContent, /details were saved/);
  assert.equal(fields.fullName.value, '');
  assert.equal(writes, 0);

  // 2. Failure path: honest message, typed details kept so the visitor can retry.
  for (const [id, value] of Object.entries(values)) fields[id].value = value;
  fail = true;
  events.submit({ preventDefault() {} });
  await new Promise(r => setImmediate(r));
  assert.match(fields.orderSaveStatus.textContent, /could not save/);
  assert.equal(fields.fullName.value, 'TEST ONLY');
  assert.equal(writes, 0);

  // 3. The legacy localStorage queue is never read or written by the new script.
  assert.equal(writes, 0);
  console.log('PASS: single POST, form fields only, correct success/failure copy, no local storage');
})().catch(e => { console.error(e); process.exitCode = 1; });
