-- Additive staging migration; does not alter existing orders or their policy.
create table if not exists public.site_event_totals (
  day date not null, event text not null, label text not null,
  count bigint not null default 0, primary key(day,event,label)
);
alter table public.site_event_totals enable row level security;
revoke all on public.site_event_totals from public, anon, authenticated;
-- A global cap limits accidental/flooding writes, but public counters can still be manipulated.
create table if not exists public.site_event_budget (
  minute timestamptz primary key, count integer not null
);
alter table public.site_event_budget enable row level security;
revoke all on public.site_event_budget from public, anon, authenticated;
create or replace function public.record_site_event(p_event text, p_label text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n integer; bucket timestamptz := pg_catalog.date_trunc('minute', pg_catalog.now());
begin
 if not ((p_event = 'page' and p_label in ('home','products','software','services','how','order','phc','faq')) or (p_event = 'click' and p_label in ('whatsapp','order'))) then return false; end if;
 insert into public.site_event_budget values(bucket,1)
 on conflict (minute) do update set count=public.site_event_budget.count+1
 where public.site_event_budget.count < 120 returning count into n;
 if n is null then return false; end if;
 insert into public.site_event_totals values((pg_catalog.now() at time zone 'UTC')::date,p_event,p_label,1)
 on conflict (day,event,label) do update set count=public.site_event_totals.count+1;
 delete from public.site_event_budget where minute < bucket - interval '2 days';
 return true;
end $$;
revoke all on function public.record_site_event(text,text) from public, anon, authenticated;
grant execute on function public.record_site_event(text,text) to service_role;
