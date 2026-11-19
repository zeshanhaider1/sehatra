import { createHandler } from './handler.mjs';
const url=Deno.env.get('SUPABASE_URL'), key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
Deno.serve(createHandler(async event=>{
 if (!url || !key) throw new Error('Missing database configuration');
 const r=await fetch(`${url}/rest/v1/rpc/record_site_event`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({p_event:event.event,p_label:event.label}),signal:AbortSignal.timeout(8000)});
 if(!r.ok) throw new Error('Aggregation failed'); return await r.json();
}));
