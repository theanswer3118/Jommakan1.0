-- =============================================================
-- JOM MAKAN RESTAURANT OS - PHASE 2: PURCHASING
-- Adds new objects only. Does NOT modify Phase 1A / 1B.
-- =============================================================

-- 1. ENUMS
do $$ begin
  create type public.pr_status as enum ('DRAFT','SUBMITTED','PROCESSING','COMPLETED','REJECTED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.po_status as enum ('DRAFT','ORDERED','PARTIAL','COMPLETE','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.receiving_status as enum ('DRAFT','POSTED','CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.payment_method as enum ('CASH','TRANSFER','QRIS','CARD','OTHER');
exception when duplicate_object then null; end $$;

-- 2. TABLES
create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  name text not null,
  contact_name text,
  whatsapp text,
  phone text,
  email text,
  address text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, name)
);
create index if not exists idx_suppliers_outlet on public.suppliers(outlet_id);

create table if not exists public.item_suppliers (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete cascade,
  current_price numeric(15,2) not null,
  price_unit_id uuid references public.units(id),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_is_supplier on public.item_suppliers(supplier_id);
create index if not exists idx_is_item on public.item_suppliers(item_id);

create table if not exists public.purchase_requests (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  requested_by uuid,
  requester_name text,
  requester_role public.employee_role,
  original_text text,
  notes text,
  status public.pr_status not null default 'DRAFT',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_pr_outlet on public.purchase_requests(outlet_id);
create index if not exists idx_pr_status on public.purchase_requests(status);
create index if not exists idx_pr_requested_by on public.purchase_requests(requested_by);

create table if not exists public.purchase_request_items (
  id uuid primary key default gen_random_uuid(),
  purchase_request_id uuid not null references public.purchase_requests(id) on delete cascade,
  item_id uuid references public.items(id) on delete restrict,
  item_name_text text,
  quantity numeric(15,3) not null,
  unit_id uuid references public.units(id),
  unit_text text,
  notes text,
  needs_review boolean not null default false
);
create index if not exists idx_pri_pr on public.purchase_request_items(purchase_request_id);

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  purchase_request_id uuid references public.purchase_requests(id) on delete set null,
  po_number text not null,
  order_date date not null default current_date,
  expected_date date,
  status public.po_status not null default 'ORDERED',
  notes text,
  created_by uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, po_number)
);
create unique index if not exists uq_po_idempotency on public.purchase_orders(idempotency_key) where idempotency_key is not null;
create index if not exists idx_po_outlet on public.purchase_orders(outlet_id);
create index if not exists idx_po_supplier on public.purchase_orders(supplier_id);
create index if not exists idx_po_status on public.purchase_orders(status);

create table if not exists public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  item_id uuid not null references public.items(id) on delete restrict,
  item_name_snapshot text not null,
  ordered_qty numeric(15,3) not null,
  purchase_unit_id uuid references public.units(id),
  purchase_unit_snapshot text,
  stock_unit_id uuid references public.units(id),
  conversion_ratio_snapshot numeric(15,4) not null default 1,
  unit_price numeric(15,2) not null default 0,
  total numeric(15,2) generated always as (ordered_qty * unit_price) stored,
  received_qty numeric(15,3) not null default 0
);
create index if not exists idx_poi_po on public.purchase_order_items(purchase_order_id);

create table if not exists public.receivings (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  received_by uuid,
  received_at timestamptz not null default now(),
  status public.receiving_status not null default 'POSTED',
  notes text,
  photo_path text,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_rec_idempotency on public.receivings(idempotency_key) where idempotency_key is not null;
create index if not exists idx_rec_outlet on public.receivings(outlet_id);
create index if not exists idx_rec_po on public.receivings(purchase_order_id);

create table if not exists public.receiving_items (
  id uuid primary key default gen_random_uuid(),
  receiving_id uuid not null references public.receivings(id) on delete cascade,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  ordered_qty_snapshot numeric(15,3) not null,
  received_qty numeric(15,3) not null,
  purchase_unit_id uuid references public.units(id),
  stock_unit_id uuid references public.units(id),
  conversion_ratio_snapshot numeric(15,4) not null default 1,
  stock_movement_id uuid references public.stock_movements(id)
);
create index if not exists idx_ri_receiving on public.receiving_items(receiving_id);

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  bill_number text not null,
  bill_date date not null default current_date,
  due_date date,
  total_amount numeric(15,2) not null,
  notes text,
  photo_path text,
  created_by uuid,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, bill_number)
);
create unique index if not exists uq_bill_idempotency on public.bills(idempotency_key) where idempotency_key is not null;
create index if not exists idx_bills_outlet on public.bills(outlet_id);
create index if not exists idx_bills_supplier on public.bills(supplier_id);

create table if not exists public.bill_receivings (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills(id) on delete cascade,
  receiving_id uuid not null references public.receivings(id) on delete restrict,
  unique (bill_id, receiving_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  bill_id uuid not null references public.bills(id) on delete restrict,
  amount numeric(15,2) not null,
  payment_date date not null default current_date,
  method public.payment_method not null default 'TRANSFER',
  reference text,
  proof_file text,
  parent_transaction_id uuid references public.payments(id),
  created_by uuid,
  idempotency_key text,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_payment_idempotency on public.payments(idempotency_key) where idempotency_key is not null;
create index if not exists idx_pay_bill on public.payments(bill_id);
create index if not exists idx_pay_outlet on public.payments(outlet_id);
create index if not exists idx_pay_parent on public.payments(parent_transaction_id);

-- 3. TRIGGERS
-- 3a. Auto-generate stock movement RECEIVING when receiving_items row inserted
create or replace function public.tg_receiving_to_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_receiving public.receivings;
  v_outlet uuid;
  v_stock_qty numeric(15,3);
  v_mv_id uuid;
begin
  select * into v_receiving from public.receivings where id = NEW.receiving_id;
  v_outlet := v_receiving.outlet_id;
  v_stock_qty := NEW.received_qty * NEW.conversion_ratio_snapshot;

  insert into public.stock_movements(
    outlet_id, item_id, movement_type, quantity, stock_unit_id,
    purchase_quantity, purchase_unit_id, reason, created_by
  ) values (
    v_outlet, NEW.item_id, 'RECEIVING', v_stock_qty, NEW.stock_unit_id,
    NEW.received_qty, NEW.purchase_unit_id,
    'Auto: receiving ' || NEW.receiving_id::text, v_receiving.received_by
  ) returning id into v_mv_id;

  update public.receiving_items set stock_movement_id = v_mv_id where id = NEW.id;

  -- update PO item received_qty (in purchase unit)
  update public.purchase_order_items
    set received_qty = received_qty + NEW.received_qty
    where id = NEW.purchase_order_item_id;

  return NEW;
end;
$$;

drop trigger if exists apply_receiving_to_stock on public.receiving_items;
create trigger apply_receiving_to_stock
  after insert on public.receiving_items
  for each row execute function public.tg_receiving_to_stock();

-- 3b. Update PO status when POI received_qty changes
create or replace function public.tg_update_po_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_po_id uuid;
  v_all_complete boolean;
  v_any_received boolean;
  v_new_status public.po_status;
  v_current public.po_status;
begin
  v_po_id := NEW.purchase_order_id;

  select bool_and(received_qty >= ordered_qty), bool_or(received_qty > 0)
    into v_all_complete, v_any_received
  from public.purchase_order_items where purchase_order_id = v_po_id;

  select status into v_current from public.purchase_orders where id = v_po_id;

  if v_all_complete then v_new_status := 'COMPLETE';
  elsif v_any_received then v_new_status := 'PARTIAL';
  else v_new_status := coalesce(v_current, 'ORDERED');
  end if;

  if v_new_status is distinct from v_current then
    update public.purchase_orders set status = v_new_status, updated_at = now() where id = v_po_id;
  end if;
  return NEW;
end;
$$;

drop trigger if exists update_po_status on public.purchase_order_items;
create trigger update_po_status
  after update of received_qty on public.purchase_order_items
  for each row execute function public.tg_update_po_status();

-- 3c. updated_at triggers
drop trigger if exists set_updated_at_suppliers on public.suppliers;
create trigger set_updated_at_suppliers before update on public.suppliers
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at_pr on public.purchase_requests;
create trigger set_updated_at_pr before update on public.purchase_requests
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at_po on public.purchase_orders;
create trigger set_updated_at_po before update on public.purchase_orders
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at_bill on public.bills;
create trigger set_updated_at_bill before update on public.bills
for each row execute function public.tg_set_updated_at();

-- 3d. Audit triggers (reuse Phase 1A write_audit_row)
drop trigger if exists audit_suppliers on public.suppliers;
create trigger audit_suppliers after insert or update or delete on public.suppliers
  for each row execute function public.write_audit_row();

drop trigger if exists audit_pr on public.purchase_requests;
create trigger audit_pr after insert or update or delete on public.purchase_requests
  for each row execute function public.write_audit_row();

drop trigger if exists audit_po on public.purchase_orders;
create trigger audit_po after insert or update or delete on public.purchase_orders
  for each row execute function public.write_audit_row();

drop trigger if exists audit_receivings on public.receivings;
create trigger audit_receivings after insert or update or delete on public.receivings
  for each row execute function public.write_audit_row();

drop trigger if exists audit_bills on public.bills;
create trigger audit_bills after insert or update or delete on public.bills
  for each row execute function public.write_audit_row();

drop trigger if exists audit_payments on public.payments;
create trigger audit_payments after insert or update or delete on public.payments
  for each row execute function public.write_audit_row();

-- 4. PERMISSIONS
insert into public.permissions(key, description) values
  ('view_suppliers','Lihat supplier'),
  ('manage_suppliers','Kelola supplier'),
  ('view_purchase_requests','Lihat purchase request'),
  ('create_purchase_request','Buat purchase request'),
  ('process_purchase_requests','Proses purchase request'),
  ('create_po','Buat purchase order'),
  ('view_receiving','Lihat receiving'),
  ('create_receiving','Buat receiving'),
  ('view_bills','Lihat bill'),
  ('create_bill','Buat bill'),
  ('view_payments','Lihat pembayaran'),
  ('create_payment','Buat pembayaran')
on conflict (key) do nothing;

-- OWNER & MANAGER get everything
insert into public.role_permissions(role, permission_id)
  select r::public.employee_role, p.id
  from unnest(array['OWNER','MANAGER']) as r
  cross join public.permissions p
  where p.key in ('view_suppliers','manage_suppliers','view_purchase_requests','create_purchase_request','process_purchase_requests','create_po','view_receiving','create_receiving','view_bills','create_bill','view_payments','create_payment')
on conflict do nothing;

-- PURCHASING
insert into public.role_permissions(role, permission_id)
  select 'PURCHASING'::public.employee_role, p.id from public.permissions p
  where p.key in ('view_suppliers','manage_suppliers','view_purchase_requests','process_purchase_requests','create_po','view_receiving','create_receiving','view_bills','create_bill','view_payments','create_payment')
on conflict do nothing;

-- KITCHEN, BAR, SERVICE: create + view own request
insert into public.role_permissions(role, permission_id)
  select r::public.employee_role, p.id
  from unnest(array['KITCHEN','BAR','SERVICE']) as r
  cross join public.permissions p
  where p.key in ('view_purchase_requests','create_purchase_request')
on conflict do nothing;

-- STOCK: view receiving and receiving creation
insert into public.role_permissions(role, permission_id)
  select 'STOCK'::public.employee_role, p.id from public.permissions p
  where p.key in ('view_suppliers','view_receiving','create_receiving')
on conflict do nothing;

-- 5. RLS
alter table public.suppliers enable row level security;
alter table public.item_suppliers enable row level security;
alter table public.purchase_requests enable row level security;
alter table public.purchase_request_items enable row level security;
alter table public.purchase_orders enable row level security;
alter table public.purchase_order_items enable row level security;
alter table public.receivings enable row level security;
alter table public.receiving_items enable row level security;
alter table public.bills enable row level security;
alter table public.bill_receivings enable row level security;
alter table public.payments enable row level security;

-- SUPPLIERS
drop policy if exists sup_select on public.suppliers;
create policy sup_select on public.suppliers for select to authenticated
  using (public.has_permission('view_suppliers'));
drop policy if exists sup_write on public.suppliers;
create policy sup_write on public.suppliers for all to authenticated
  using (public.has_permission('manage_suppliers')) with check (public.has_permission('manage_suppliers'));

-- ITEM_SUPPLIERS: read w/ view_suppliers, write w/ manage_suppliers
drop policy if exists is_select on public.item_suppliers;
create policy is_select on public.item_suppliers for select to authenticated
  using (public.has_permission('view_suppliers'));
drop policy if exists is_write on public.item_suppliers;
create policy is_write on public.item_suppliers for all to authenticated
  using (public.has_permission('manage_suppliers')) with check (public.has_permission('manage_suppliers'));

-- PURCHASE_REQUESTS
drop policy if exists pr_select on public.purchase_requests;
create policy pr_select on public.purchase_requests for select to authenticated
  using (
    public.has_permission('view_purchase_requests')
    or requested_by = (select auth.uid())
  );
drop policy if exists pr_insert on public.purchase_requests;
create policy pr_insert on public.purchase_requests for insert to authenticated
  with check (public.has_permission('create_purchase_request'));
drop policy if exists pr_update on public.purchase_requests;
create policy pr_update on public.purchase_requests for update to authenticated
  using (
    (requested_by = (select auth.uid()) and status = 'DRAFT')
    or public.has_permission('process_purchase_requests')
  )
  with check (
    (requested_by = (select auth.uid()) and status = 'DRAFT')
    or public.has_permission('process_purchase_requests')
  );
drop policy if exists pr_delete on public.purchase_requests;
create policy pr_delete on public.purchase_requests for delete to authenticated
  using (
    (requested_by = (select auth.uid()) and status = 'DRAFT')
    or public.has_permission('process_purchase_requests')
  );

-- PURCHASE_REQUEST_ITEMS: mirror parent visibility
drop policy if exists pri_select on public.purchase_request_items;
create policy pri_select on public.purchase_request_items for select to authenticated
  using (exists(select 1 from public.purchase_requests p where p.id = purchase_request_id and
    (public.has_permission('view_purchase_requests') or p.requested_by = (select auth.uid()))));

drop policy if exists pri_write on public.purchase_request_items;
drop policy if exists pri_insert on public.purchase_request_items;
create policy pri_insert on public.purchase_request_items for insert to authenticated
  with check (exists(select 1 from public.purchase_requests p where p.id = purchase_request_id and
    (p.requested_by = (select auth.uid()) or public.has_permission('process_purchase_requests'))));

drop policy if exists pri_update on public.purchase_request_items;
create policy pri_update on public.purchase_request_items for update to authenticated
  using (exists(select 1 from public.purchase_requests p where p.id = purchase_request_id and
    ((p.requested_by = (select auth.uid()) and p.status = 'DRAFT') or public.has_permission('process_purchase_requests'))))
  with check (exists(select 1 from public.purchase_requests p where p.id = purchase_request_id and
    ((p.requested_by = (select auth.uid()) and p.status = 'DRAFT') or public.has_permission('process_purchase_requests'))));

drop policy if exists pri_delete on public.purchase_request_items;
create policy pri_delete on public.purchase_request_items for delete to authenticated
  using (exists(select 1 from public.purchase_requests p where p.id = purchase_request_id and
    ((p.requested_by = (select auth.uid()) and p.status = 'DRAFT') or public.has_permission('process_purchase_requests'))));

-- PURCHASE_ORDERS
drop policy if exists po_select on public.purchase_orders;
create policy po_select on public.purchase_orders for select to authenticated
  using (public.has_permission('view_suppliers') or public.has_permission('create_po'));
drop policy if exists po_write on public.purchase_orders;
create policy po_write on public.purchase_orders for all to authenticated
  using (public.has_permission('create_po')) with check (public.has_permission('create_po'));

drop policy if exists poi_select on public.purchase_order_items;
create policy poi_select on public.purchase_order_items for select to authenticated
  using (exists(select 1 from public.purchase_orders o where o.id = purchase_order_id and
    (public.has_permission('view_suppliers') or public.has_permission('create_po'))));
drop policy if exists poi_write on public.purchase_order_items;
create policy poi_write on public.purchase_order_items for all to authenticated
  using (public.has_permission('create_po')) with check (public.has_permission('create_po'));

-- RECEIVINGS
drop policy if exists rec_select on public.receivings;
create policy rec_select on public.receivings for select to authenticated
  using (public.has_permission('view_receiving'));
drop policy if exists rec_write on public.receivings;
create policy rec_write on public.receivings for all to authenticated
  using (public.has_permission('create_receiving')) with check (public.has_permission('create_receiving'));

drop policy if exists ri_select on public.receiving_items;
create policy ri_select on public.receiving_items for select to authenticated
  using (public.has_permission('view_receiving'));
drop policy if exists ri_write on public.receiving_items;
create policy ri_write on public.receiving_items for all to authenticated
  using (public.has_permission('create_receiving')) with check (public.has_permission('create_receiving'));

-- BILLS
drop policy if exists bill_select on public.bills;
create policy bill_select on public.bills for select to authenticated
  using (public.has_permission('view_bills'));
drop policy if exists bill_write on public.bills;
create policy bill_write on public.bills for all to authenticated
  using (public.has_permission('create_bill')) with check (public.has_permission('create_bill'));

drop policy if exists br_select on public.bill_receivings;
create policy br_select on public.bill_receivings for select to authenticated
  using (public.has_permission('view_bills'));
drop policy if exists br_write on public.bill_receivings;
create policy br_write on public.bill_receivings for all to authenticated
  using (public.has_permission('create_bill')) with check (public.has_permission('create_bill'));

-- PAYMENTS: read w/ view_payments; write w/ create_payment; NO update/delete for anyone (immutable)
drop policy if exists pay_select on public.payments;
create policy pay_select on public.payments for select to authenticated
  using (public.has_permission('view_payments'));
drop policy if exists pay_insert on public.payments;
create policy pay_insert on public.payments for insert to authenticated
  with check (public.has_permission('create_payment'));

-- Explicitly revoke UPDATE/DELETE on payments so tamper attempts fail hard.
revoke update, delete on public.payments from authenticated, anon;
grant select, insert on public.payments to authenticated;

-- 6. Bill status computed view
create or replace view public.bill_status_view as
select
  b.id as bill_id,
  b.outlet_id,
  b.total_amount,
  coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) as paid_amount,
  case
    when coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) = 0 then 'UNPAID'
    when coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) < b.total_amount then 'PARTIAL'
    when coalesce((select sum(p.amount) from public.payments p where p.bill_id = b.id), 0) = b.total_amount then 'PAID'
    else 'OVERPAID'
  end as status
from public.bills b;

grant select on public.bill_status_view to authenticated;

-- 7. Storage bucket for receipts (private)
insert into storage.buckets (id, name, public)
  values ('receipts','receipts', false)
on conflict (id) do nothing;

-- Storage RLS: allow authenticated with any relevant permission to upload
-- (Supabase already has RLS on storage.objects)
drop policy if exists receipts_select on storage.objects;
create policy receipts_select on storage.objects for select to authenticated
  using (bucket_id = 'receipts' and (
    public.has_permission('view_receiving')
    or public.has_permission('view_bills')
    or public.has_permission('view_payments')
    or public.has_permission('create_receiving')
    or public.has_permission('create_bill')
    or public.has_permission('create_payment')
  ));

drop policy if exists receipts_insert on storage.objects;
create policy receipts_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts' and (
    public.has_permission('create_receiving')
    or public.has_permission('create_bill')
    or public.has_permission('create_payment')
  ));

drop policy if exists receipts_update on storage.objects;
create policy receipts_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts' and (
    public.has_permission('create_receiving')
    or public.has_permission('create_bill')
    or public.has_permission('create_payment')
  ));

drop policy if exists receipts_delete on storage.objects;
create policy receipts_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts' and (
    public.has_permission('create_receiving')
    or public.has_permission('create_bill')
    or public.has_permission('create_payment')
  ));

select 'PHASE 2 migration completed' as status;
