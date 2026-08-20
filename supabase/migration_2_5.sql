-- =============================================================
-- PHASE 2.5: QUICK PURCHASE + PENDING PRICE
-- Adds only. Does not alter existing tables destructively.
-- =============================================================

-- 1. ENUM for pricing status
do $$ begin
  create type public.bill_pricing_status as enum ('PENDING','PRICED');
exception when duplicate_object then null; end $$;

-- 2. Add columns to bills
alter table public.bills
  add column if not exists pricing_status public.bill_pricing_status not null default 'PRICED';

-- 3. Recreate bill_status_view to consider pricing_status
drop view if exists public.bill_status_view;
create view public.bill_status_view as
select
  b.id as bill_id,
  b.outlet_id,
  b.total_amount,
  b.pricing_status,
  coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) as paid_amount,
  case
    when b.pricing_status = 'PENDING' then 'PENDING_PRICE'
    when coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) = 0 then 'UNPAID'
    when coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) < b.total_amount then 'PARTIAL'
    when coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) = b.total_amount then 'PAID'
    else 'OVERPAID'
  end as status
from public.bills b;

grant select on public.bill_status_view to authenticated;

-- 4. Payments cannot be created against a PENDING bill (block via trigger)
create or replace function public.tg_block_payment_if_pending()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_pricing public.bill_pricing_status;
begin
  select pricing_status into v_pricing from public.bills where id = NEW.bill_id;
  if v_pricing = 'PENDING' then
    raise exception 'Bill masih MENUNGGU HARGA — belum bisa dibayar';
  end if;
  return NEW;
end;
$$;

drop trigger if exists block_payment_if_pending on public.payments;
create trigger block_payment_if_pending
  before insert on public.payments
  for each row execute function public.tg_block_payment_if_pending();

-- 5. Idempotency for quick purchase composite key
alter table public.purchase_orders
  add column if not exists is_quick_purchase boolean not null default false;

select 'Phase 2.5 migration completed' as status;
