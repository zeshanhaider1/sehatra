-- Abuse guard for the public lead endpoint. Additive: no existing order row is read,
-- changed or deleted. Counters keep only a keyed hash of the caller, never an address.
create table if not exists public.lead_rate_per_client (
  client_key text not null,
  bucket timestamptz not null,
  count integer not null default 0,
  primary key (client_key, bucket)
);

create table if not exists public.lead_rate_global (
  minute timestamptz primary key,
  count integer not null
);

alter table public.lead_rate_per_client enable row level security;
alter table public.lead_rate_global enable row level security;
revoke all on public.lead_rate_per_client from public, anon, authenticated;
revoke all on public.lead_rate_global from public, anon, authenticated;

-- Called only by the lead-capture function with the service role.
-- Six submissions per hashed client per hour, forty per minute across the site.
create or replace function public.record_lead_attempt(p_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket timestamptz := pg_catalog.date_trunc('hour', pg_catalog.now());
  v_minute timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
  v_client integer;
  v_global integer;
begin
  if p_key is null or p_key !~ '^[0-9a-f]{32}$' then
    return false;
  end if;

  insert into public.lead_rate_global (minute, count) values (v_minute, 1)
  on conflict (minute) do update set count = public.lead_rate_global.count + 1
  where public.lead_rate_global.count < 40
  returning count into v_global;

  if v_global is null then
    return false;
  end if;

  insert into public.lead_rate_per_client (client_key, bucket, count) values (p_key, v_bucket, 1)
  on conflict (client_key, bucket) do update set count = public.lead_rate_per_client.count + 1
  where public.lead_rate_per_client.count < 6
  returning count into v_client;

  if v_client is null then
    return false;
  end if;

  -- Counters are only useful for a short window; drop old ones opportunistically.
  if pg_catalog.random() < 0.02 then
    delete from public.lead_rate_per_client where bucket < v_bucket - interval '48 hours';
    delete from public.lead_rate_global where minute < v_minute - interval '2 hours';
  end if;

  return true;
end
$$;

revoke all on function public.record_lead_attempt(text) from public, anon, authenticated;
grant execute on function public.record_lead_attempt(text) to service_role;
