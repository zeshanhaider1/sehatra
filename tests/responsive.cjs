// Responsive + in-browser behaviour check for the Sehatra copy.
// Dependency-free: serves the folder, drives headless Chrome over CDP with Node's global WebSocket,
// writes screenshots to ../evidence and prints a JSON report.
const http = require('http'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.resolve(ROOT, '..', 'evidence');
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'
].find(p => fs.existsSync(p));
const PORT = 0, DEBUG = 9333;
const VIEWPORTS = [
  { name: 'phone-375', width: 375, height: 812, mobile: true },
  { name: 'phone-390', width: 390, height: 844, mobile: true },
  { name: 'tablet-768', width: 768, height: 1024, mobile: true },
  { name: 'desktop-1440', width: 1440, height: 900, mobile: false }
];

const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const file = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

const wait = ms => new Promise(r => setTimeout(r, ms));

async function cdpTargets() {
  const res = await fetch(`http://127.0.0.1:${DEBUG}/json/list`);
  return res.json();
}

async function connect() {
  for (let i = 0; i < 40; i++) {
    try {
      const targets = await cdpTargets();
      const page = targets.find(t => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await wait(250);
  }
  throw new Error('Chrome did not start');
}

function session(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let id = 0;
    const pending = new Map(), listeners = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res, rej) => {
          const n = ++id;
          pending.set(n, { res, rej });
          ws.send(JSON.stringify({ id: n, method, params }));
        });
      },
      on(event, fn) { listeners.set(event, fn); },
      close() { ws.close(); }
    });
    ws.onerror = reject;
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej(new Error(msg.error.message)) : res(msg.result);
      } else if (msg.method && listeners.has(msg.method)) listeners.get(msg.method)(msg.params);
    };
  });
}

const evaluate = async (s, expression) => {
  const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || ''));
  return r.result.value;
};

async function openPage(s, url) {
  const loaded = new Promise(r => s.on('Page.loadEventFired', r));
  await s.send('Page.navigate', { url });
  await Promise.race([loaded, wait(15000)]);
  await wait(400);
}

// Measurements that matter on a narrow screen: no sideways scroll, nothing important clipped,
// readable form controls, and a reachable primary button.
const MEASURE = `(() => {
  const vw = innerWidth;
  const q = s => document.querySelector(s);
  const rect = el => el ? el.getBoundingClientRect() : null;
  const outside = [];
  document.querySelectorAll('input, select, textarea, button, .analytics-choice, .mobile-bottom-nav').forEach(el => {
    if (el.classList.contains('hp-field')) return; // honeypot is parked off-screen on purpose
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 1 || r.left < -1) outside.push(el.id || el.className || el.tagName);
  });
  const wide = [...document.querySelectorAll('body *')]
    .map(el => ({ el, r: el.getBoundingClientRect() }))
    .filter(({ r }) => r.width > 0 && r.right > vw + 1)
    .sort((a, b) => b.r.right - a.r.right)
    .slice(0, 6)
    .map(({ el, r }) => ({ tag: el.tagName, id: el.id || null, cls: (el.className || '').toString().slice(0, 50), right: Math.round(r.right), width: Math.round(r.width) }));
  const submit = q('#submitBtn');
  const form = q('#orderForm');
  return {
    viewport: vw,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth > vw + 1,
    clippedControls: outside.slice(0, 10),
    widest: wide,
    formVisible: !!form && form.getBoundingClientRect().width > 0,
    formWidth: Math.round(rect(form)?.width || 0),
    formInViewport: (() => { const r = rect(form); return r ? r.left >= -1 && r.right <= vw + 1 : null; })(),
    submit: rect(submit) ? { width: Math.round(submit.getBoundingClientRect().width), height: Math.round(submit.getBoundingClientRect().height), inViewport: submit.getBoundingClientRect().right <= vw + 1 } : null,
    submitFontPx: submit ? getComputedStyle(submit).fontSize : null,
    inputFontPx: form ? getComputedStyle(form.querySelector('input[type="text"]')).fontSize : null,
    consentVisible: !!q('#analyticsChoice') && !q('#analyticsChoice').hidden,
    consentInViewport: (() => { const r = rect(q('#analyticsChoice')); return r ? r.left >= -1 && r.right <= vw + 1 && r.bottom <= innerHeight + 1 : null; })(),
    bottomNavVisible: !!q('.mobile-bottom-nav') && rect(q('.mobile-bottom-nav')).width > 0,
    minTapTarget: Math.min(...[...document.querySelectorAll('.mbn-item, #submitBtn, #analyticsAllow, #analyticsDecline')].map(e => e.getBoundingClientRect().height).filter(h => h > 0))
  };
})()`;

(async () => {
  if (!CHROME) throw new Error('Chrome not found');
  fs.mkdirSync(EVIDENCE, { recursive: true });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const port = server.address().port;

  const profile = path.join(require('os').tmpdir(), 'sehatra-cdp-' + Date.now());
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--remote-debugging-port=${DEBUG}`, `--user-data-dir=${profile}`, 'about:blank'
  ], { stdio: 'ignore' });

  const s = await session(await connect());
  await s.send('Page.enable');
  await s.send('Runtime.enable');

  const base = `http://127.0.0.1:${port}/`;
  const report = { url: base, viewports: [], behaviour: {} };

  for (const vp of VIEWPORTS) {
    await s.send('Emulation.setDeviceMetricsOverride', {
      width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: vp.mobile
    });
    await openPage(s, base);
    // The order form lives in the "order" tab; open it the way a visitor would.
    await evaluate(s, `(() => { const t = document.querySelector('.mbn-item[data-tab="order"], .tab-link[data-tab="order"]'); if (t) t.click(); return !!t; })()`);
    await wait(500);
    report.viewports.push({ name: vp.name, ...(await evaluate(s, MEASURE)) });
    const shot = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    fs.writeFileSync(path.join(EVIDENCE, `responsive-${vp.name}.png`), Buffer.from(shot.data, 'base64'));
  }

  // Behaviour on a phone viewport: consent gating, success and failure copy, no local storage.
  await s.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await s.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `window.__sent = []; window.__mode = 'ok';
      window.fetch = async (url, opts) => {
        if (String(url).includes('/functions/v1/analytics')) { window.__sent.push(JSON.parse(opts.body)); return { ok: true, status: 204, text: async () => '' }; }
        if (String(url).includes('/functions/v1/lead-capture')) {
          window.__sent.push(JSON.parse(opts.body));
          if (window.__mode === 'fail') throw new Error('offline');
          return { ok: true, status: 201, text: async () => '' };
        }
        return { ok: false, status: 404, text: async () => '' };
      };
      const realOpen = window.open; window.open = () => { window.__opened = (window.__opened || 0) + 1; return null; };
      window.__storageWrites = 0;
      const setItem = Storage.prototype.setItem; Storage.prototype.setItem = function (...a) { window.__storageWrites++; return setItem.apply(this, a); };`
  });
  await openPage(s, base);

  const fill = async (mode) => evaluate(s, `(() => {
    window.__sent = []; window.__mode = '${mode}';
    const set = (id, v) => { const el = document.getElementById(id); el.value = v; };
    set('fullName', 'TEST ONLY'); set('clinicName', 'TEST FACILITY'); set('city', 'Test City');
    set('whatsappNumber', '03000000000');
    const sel = document.getElementById('productSelect'); sel.value = sel.options[1].value;
    set('notes', 'TEST ONLY');
    document.getElementById('orderForm').dispatchEvent(new Event('submit', { cancelable: true }));
    return true;
  })()`);

  await fill('ok');
  await wait(600);
  report.behaviour.success = await evaluate(s, `({
    status: document.getElementById('orderSaveStatus').textContent,
    sent: window.__sent.filter(x => 'name' in x),
    analyticsBeforeOptIn: window.__sent.filter(x => 'event' in x).length,
    whatsappOpened: window.__opened || 0,
    storageWrites: window.__storageWrites
  })`);

  await evaluate(s, `document.getElementById('analyticsAllow').click()`);
  await wait(300);
  report.behaviour.afterOptIn = await evaluate(s, `({ events: window.__sent.filter(x => 'event' in x), bannerHidden: document.getElementById('analyticsChoice').hidden })`);

  await evaluate(s, `document.querySelector('#orderForm textarea').value = ''`);
  await fill('fail');
  await wait(600);
  report.behaviour.failure = await evaluate(s, `({
    status: document.getElementById('orderSaveStatus').textContent,
    nameKept: document.getElementById('fullName').value
  })`);

  const shot = await s.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(path.join(EVIDENCE, 'mobile-order-flow-390.png'), Buffer.from(shot.data, 'base64'));

  console.log(JSON.stringify(report, null, 2));
  s.close();
  chrome.kill();
  server.close();
  process.exit(0);
})().catch(err => { console.error('FAILED', err); process.exit(1); });
