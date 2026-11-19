// ========================================================
// Sehatra — Order capture (Supabase) + WhatsApp routing
// ========================================================

const OFFICIAL_WHATSAPP_NUMBER = "923042917388";

// Supabase project (public anon key — insert-only, RLS protected)
const SUPABASE_URL = "https://iheerbgatusywlqoejeg.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImloZWVyYmdhdHVzeXdscW9lamVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1Mjk0NjcsImV4cCI6MjEwOTEwNTQ2N30.hGz1ffyZyD00W8MfvaZYK4NBXmBRSi-07LP1olxMBeg";

const ORDERS_ENDPOINT = SUPABASE_URL + "/functions/v1/lead-capture";

// 1. Product -> price lookup (PKR)
function priceForProduct(productText) {
    const match = /Rs\.?\s*([\d,]+)/.exec(productText || "");
    return match ? parseInt(match[1].replace(/,/g, ""), 10) : null;
}

// 2. Select product from a pricing card
function selectProductInForm(productName) {
    const selectElem = document.getElementById("productSelect");
    if (selectElem) {
        selectElem.value = productName;
    }
    const formSection = document.getElementById("order-form-section");
    if (formSection) {
        formSection.scrollIntoView({ behavior: "smooth" });
    }
}

// 3. Copy to clipboard
function copyText(elementId) {
    const elem = document.getElementById(elementId);
    if (!elem) return;
    const text = elem.innerText.trim();
    navigator.clipboard.writeText(text).then(() => {
        const btn = elem.nextElementSibling;
        if (btn && btn.classList.contains("btn-copy")) {
            const originalHTML = btn.innerHTML;
            btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
            setTimeout(() => {
                btn.innerHTML = originalHTML;
            }, 2000);
        }
    }).catch(err => {
        console.error("Copy failed", err);
    });
}

// 4. Pre-filled WhatsApp message (English)
function buildOrderMessage(order) {
    let waText = "*Hello Sehatra! New Inspection Toolkit Order:*\n\n";
    waText += "Doctor / Lead: " + order.name + "\n";
    waText += "Clinic / Hospital: " + order.clinic + "\n";
    waText += "City: " + order.city + "\n";
    waText += "WhatsApp: " + order.whatsapp + "\n";
    waText += "Selected Package: " + order.product + "\n";
    waText += "Payment Method: " + order.payment_method + "\n";
    if (order.notes) {
        waText += "Notes: " + order.notes + "\n";
    }
    waText += "\nOrder ID: " + order._orderId;
    waText += "\n\nPlease share payment confirmation so our team can dispatch your toolkit within 1 hour.";
    return waText;
}

// 5. Order id shown to the buyer and stored in the record
function makeOrderId() {
    const now = new Date();
    const stamp = String(now.getFullYear()).slice(2) +
        String(now.getMonth() + 1).padStart(2, "0") +
        String(now.getDate()).padStart(2, "0");
    const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
    return "SEHATRA-" + stamp + "-" + rand;
}

// 6. Raw insert. Resolves true only when Supabase accepted the row.
async function postOrder(record) {
    const res = await fetch(ORDERS_ENDPOINT, {
        method: "POST",
        keepalive: true,
        headers: {
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": "Bearer " + SUPABASE_ANON_KEY,
            "Content-Type": "application/json",
            "Prefer": "return=minimal"
        },
        body: JSON.stringify(record)
    });
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error("Supabase " + res.status + " " + body.slice(0, 200));
    }
    return true;
}

// Failed submissions are not persisted in browser storage. Existing legacy queued
// records are left untouched for a separate, privacy-aware recovery decision.
async function saveOrder(record) {
    try {
        await postOrder(record);
        return true;
    } catch (err) {
        return false;
    }
}

// 9. Page ready
document.addEventListener("DOMContentLoaded", () => {
    const faqItems = document.querySelectorAll(".faq-item");
    faqItems.forEach(item => {
        const question = item.querySelector(".faq-question");
        if (!question) return;
        question.addEventListener("click", () => {
            const isActive = item.classList.contains("active");
            faqItems.forEach(i => i.classList.remove("active"));
            if (!isActive) {
                item.classList.add("active");
            }
        });
    });

    const orderForm = document.getElementById("orderForm");
    const successModal = document.getElementById("successModal");
    const modalWaBtn = document.getElementById("modalWaBtn");


    if (!orderForm) return;

    orderForm.addEventListener("submit", function (e) {
        e.preventDefault();

        // Honeypot: real people never fill this hidden field
        const honey = document.getElementById("website");
        if (honey && honey.value.trim() !== "") {
            return;
        }

        const read = (id) => (document.getElementById(id)?.value || "").trim();

        const product = read("productSelect");
        const order = {
            _orderId: makeOrderId(),
            name: read("fullName"),
            clinic: read("clinicName"),
            city: read("city"),
            whatsapp: read("whatsappNumber"),
            product: product,
            payment_method: document.querySelector('input[name="paymentMethod"]:checked')?.value || "Raast / Bank",
            notes: read("notes") || null,
            price_pkr: priceForProduct(product),
            source: window.location.origin + window.location.pathname
        };

        if (!order.name || !order.clinic || !order.city || !order.whatsapp || !order.product) {
            orderForm.reportValidity();
            return;
        }

        const waUrl = "https://wa.me/" + OFFICIAL_WHATSAPP_NUMBER + "?text=" +
            encodeURIComponent(buildOrderMessage(order));

        if (modalWaBtn) {
            modalWaBtn.href = waUrl;
        }
        const status = document.getElementById("orderSaveStatus");
        if (status) status.textContent = "Saving your details. Please send the WhatsApp message to confirm your order.";

        // WhatsApp must open inside this click gesture, or mobile browsers block it.
        let waWindow = null;
        try {
            waWindow = window.open(waUrl, "_blank");
        } catch (err) {
            waWindow = null;
        }

        // Save the lead in the background (never blocks the WhatsApp tab).
        // Only the fields shown on the form are sent; the server decides price, source
        // and every other column, so a visitor cannot set them.
        const record = {
            name: order.name, clinic: order.clinic, city: order.city,
            whatsapp: order.whatsapp, product: order.product,
            payment_method: order.payment_method, notes: order.notes
        };
        saveOrder(record).then(saved => {
            const orderIdEl = document.getElementById("orderIdValue");
            if (orderIdEl) orderIdEl.textContent = order._orderId;
            const status = document.getElementById("orderSaveStatus");
            if (status) status.textContent = saved
                ? "Your details were saved. Send the WhatsApp message to confirm your order."
                : "We could not save your details. Please send the WhatsApp message below to place your order.";
            // Clear the typed details only once they are safely stored.
            if (saved && typeof orderForm.reset === "function") orderForm.reset();
        });

        if (successModal) {
            const idLine = document.getElementById("orderIdValue");
            if (idLine) idLine.textContent = order._orderId;
            successModal.classList.add("active");
            successModal.setAttribute("data-wa-opened", waWindow ? "1" : "0");
        }

    });

});

// 10. Modal controls
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeModal();
});

document.addEventListener("click", (e) => {
    const modal = e.target;
    if (modal && modal.id === "successModal") closeModal();
});

function closeModal() {
    const successModal = document.getElementById("successModal");
    if (successModal) {
        successModal.classList.remove("active");
    }
}



// Scroll reveal animations
(function(){
  function initReveal(){
    var els = document.querySelectorAll('.reveal');
    if(!('IntersectionObserver' in window)) { els.forEach(function(el){ el.classList.add('in-view'); }); return; }
    var obs = new IntersectionObserver(function(entries){
      entries.forEach(function(e){ if(e.isIntersecting){ e.target.classList.add('in-view'); obs.unobserve(e.target); } });
    }, { threshold: 0.12 });
    els.forEach(function(el){ obs.observe(el); });
  }
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', initReveal); } else { initReveal(); }
})();



// Dashboard tab navigation (no infinite scroll)
(function(){
  var HASH_BY_TAB = {home:'', products:'products', software:'software', services:'services', how:'how-it-works', order:'order-form-section', phc:'phc-resources', faq:'faq'};
  var TAB_BY_HASH = {products:'products', software:'software', services:'services', comparison:'products', 'how-it-works':'how', 'order-form-section':'order', payment:'order', 'phc-resources':'phc', faq:'faq', 'documentation-areas':'products', home:'home'};

  function activateTab(tab){
    if(!tab) tab = 'home';
    var panels = document.querySelectorAll('.tab-panel');
    var found = false;
    panels.forEach(function(p){ if(p.getAttribute('data-panel')===tab) found = true; });
    if(!found) tab = 'home';

    panels.forEach(function(p){
      var on = p.getAttribute('data-panel')===tab;
      p.classList.toggle('active', on);
      p.setAttribute('aria-hidden', on ? 'false' : 'true');
    });
    document.querySelectorAll('.tab-link').forEach(function(l){
      var on = l.getAttribute('data-tab')===tab;
      l.classList.toggle('active', on);
      l.setAttribute('aria-selected', on ? 'true' : 'false');
      if(on){ l.setAttribute('aria-current','page'); } else { l.removeAttribute('aria-current'); }
    });
    document.querySelectorAll('.mbn-item').forEach(function(b){
      var on = b.getAttribute('data-tab')===tab;
      b.classList.toggle('active', on);
      if(on){ b.setAttribute('aria-current','page'); } else { b.removeAttribute('aria-current'); }
    });
    try { window.scrollTo({top:0, behavior:'smooth'}); } catch(e){ window.scrollTo(0,0); }
    document.querySelectorAll('.tab-panel.active .reveal').forEach(function(el){ el.classList.add('in-view'); });
    return tab;
  }

  function tabFromHash(){
    var h = (location.hash||'').replace('#','');
    return TAB_BY_HASH[h] || 'home';
  }

  function go(tab){
    activateTab(tab);
    var hash = HASH_BY_TAB[tab];
    if(history && history.replaceState){
      var url = (hash ? '#' + hash : location.pathname + location.search);
      history.replaceState(null, '', url);
    }
  }

  document.addEventListener('click', function(e){
    var t = e.target.closest('[data-tab]');
    if(!t) return;
    var tab = t.getAttribute('data-tab');
    if(!tab) return;
    if(t.classList.contains('tab-link') || t.classList.contains('dash-btn') || t.classList.contains('mbn-item') || t.hasAttribute('data-switch-tab')){
      e.preventDefault();
      go(tab);
    }
  });

  window.addEventListener('hashchange', function(){ activateTab(tabFromHash()); });
  function init(){ activateTab(tabFromHash()); }
  if(document.readyState === 'loading'){ document.addEventListener('DOMContentLoaded', init); } else { init(); }
})();

// Aggregate analytics is disabled until the visitor opts in for this page session.
// Nothing is stored and nothing is sent before the click; a "no" lasts for the page only.
(function () {
  let enabled = false;
  const endpoint = SUPABASE_URL + '/functions/v1/analytics';
  // Global Privacy Control is a formal opt-out signal; honour it without asking.
  const optedOut = navigator.globalPrivacyControl === true;
  const send = (event, label) => {
    if (!enabled || optedOut) return;
    fetch(endpoint, {method:'POST',keepalive:true,headers:{'Content-Type':'application/json',apikey:SUPABASE_ANON_KEY},body:JSON.stringify({event,label})}).catch(() => {});
  };
  const active = () => document.querySelector('.tab-panel.active')?.getAttribute('data-panel') || 'home';
  document.addEventListener('DOMContentLoaded', () => {
    const choice = document.getElementById('analyticsChoice');
    if (!choice) return;
    if (optedOut) { choice.hidden = true; return; }
    document.getElementById('analyticsAllow')?.addEventListener('click', () => { enabled = true; choice.hidden = true; send('page',active()); });
    document.getElementById('analyticsDecline')?.addEventListener('click', () => { enabled = false; choice.hidden = true; });
    document.addEventListener('click', e => {
      if (!enabled) return;
      const tab = e.target.closest('[data-tab]');
      if (tab && ['home','products','software','services','how','order','phc','faq'].includes(tab.dataset.tab)) send('page',tab.dataset.tab);
      const link = e.target.closest('a[href]');
      if (link && link.hostname === 'wa.me') send('click','whatsapp');
      if (e.target.closest('#orderForm button[type="submit"]')) send('click','order');
    });
  });
})();
