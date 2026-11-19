const origin = 'https://zeshanhaider1.github.io';
const cors = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Vary':'Origin','Cache-Control':'no-store'};
const pages = new Set(['home','products','software','services','how','order','phc','faq']);
export function createHandler(record) { return async req => {
 if(req.headers.get('origin')!==origin) return new Response(null,{status:403});
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers:cors});
 if(req.method!=='POST') return new Response(null,{status:405,headers:cors});
 if(!(req.headers.get('content-type')||'').toLowerCase().startsWith('application/json')) return new Response(null,{status:415,headers:cors});
 const raw=await req.text(); if(raw.length>256) return new Response(null,{status:413,headers:cors});
 let b; try {b=JSON.parse(raw)} catch {return new Response(null,{status:400,headers:cors})}
 if(!b || typeof b!=='object' || Array.isArray(b) || Object.keys(b).sort().join(',')!=='event,label' || !((b.event==='page' && pages.has(b.label)) || (b.event==='click' && ['whatsapp','order'].includes(b.label)))) return new Response(null,{status:400,headers:cors});
 try {const ok=await record(b); return new Response(null,{status:ok?204:429,headers:cors});} catch {return new Response(null,{status:503,headers:cors});}
}; }
