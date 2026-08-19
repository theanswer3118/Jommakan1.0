-- =============================================================
-- JOM MAKAN RESTAURANT OS - PHASE 1B: STOCK ENGINE
-- Only adds new objects. Does NOT modify Phase 1A schema.
-- =============================================================

-- 1. ENUM
do $$ begin
  create type public.stock_movement_type as enum (
    'RECEIVING','USAGE','WASTE','OPNAME','CORRECTION','VOID'
  );
exception when duplicate_object then null; end $$;

-- 2. TABLES
create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  movement_type public.stock_movement_type not null,
  quantity numeric(15,3) not null,
  stock_unit_id uuid references public.units(id),
  purchase_quantity numeric(15,3),
  purchase_unit_id uuid references public.units(id),
  parent_transaction_id uuid references public.stock_movements(id) on delete restrict,
  reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  idempotency_key text
);
create index if not exists idx_sm_outlet_item on public.stock_movements(outlet_id, item_id, created_at desc);
create index if not exists idx_sm_type on public.stock_movements(movement_type);
create index if not exists idx_sm_parent on public.stock_movements(parent_transaction_id);
create index if not exists idx_sm_created_by on public.stock_movements(created_by);
-- Partial unique index for idempotency
create unique index if not exists uq_sm_idempotency
  on public.stock_movements(idempotency_key)
  where idempotency_key is not null;

create table if not exists public.stock_balances (
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  item_id uuid not null references public.items(id) on delete restrict,
  current_qty numeric(15,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (outlet_id, item_id)
);

-- 3. TRIGGER: after insert stock_movements -> update stock_balances (atomic, row-locked via upsert)
create or replace function public.tg_apply_stock_movement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Upsert with FOR UPDATE-equivalent locking via ON CONFLICT DO UPDATE
  insert into public.stock_balances(outlet_id, item_id, current_qty, updated_at)
  values (NEW.outlet_id, NEW.item_id, NEW.quantity, now())
  on conflict (outlet_id, item_id) do update
    set current_qty = public.stock_balances.current_qty + NEW.quantity,
        updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists apply_stock_movement on public.stock_movements;
create trigger apply_stock_movement
  after insert on public.stock_movements
  for each row execute function public.tg_apply_stock_movement();

-- 4. Audit trigger on stock_movements (reuse Phase 1A trigger fn)
drop trigger if exists audit_stock_movements on public.stock_movements;
create trigger audit_stock_movements after insert or update or delete on public.stock_movements
for each row execute function public.write_audit_row();

-- 5. PERMISSIONS (new)
insert into public.permissions(key, description) values
  ('view_stock','Lihat stok & histori pergerakan'),
  ('create_stock_movement','Buat Receiving/Usage/Waste'),
  ('create_opname','Lakukan stock opname'),
  ('create_correction','Buat correction'),
  ('create_void','Buat void')
on conflict (key) do nothing;

-- Grant to roles
-- OWNER + MANAGER: all
insert into public.role_permissions(role, permission_id)
  select r::public.employee_role, p.id
  from unnest(array['OWNER','MANAGER']) as r
  cross join public.permissions p
  where p.key in ('view_stock','create_stock_movement','create_opname','create_correction','create_void')
on conflict do nothing;

-- STOCK role: all stock operations
insert into public.role_permissions(role, permission_id)
  select 'STOCK'::public.employee_role, p.id from public.permissions p
  where p.key in ('view_stock','create_stock_movement','create_opname','create_correction','create_void')
on conflict do nothing;

-- PURCHASING: view + receiving/usage/waste + opname (they receive goods)
insert into public.role_permissions(role, permission_id)
  select 'PURCHASING'::public.employee_role, p.id from public.permissions p
  where p.key in ('view_stock','create_stock_movement','create_opname')
on conflict do nothing;

-- KITCHEN + BAR: view + usage/waste (create_stock_movement)
insert into public.role_permissions(role, permission_id)
  select r::public.employee_role, p.id
  from unnest(array['KITCHEN','BAR']) as r
  cross join public.permissions p
  where p.key in ('view_stock','create_stock_movement')
on conflict do nothing;

-- SERVICE: view only
insert into public.role_permissions(role, permission_id)
  select 'SERVICE'::public.employee_role, p.id from public.permissions p
  where p.key in ('view_stock')
on conflict do nothing;

-- 6. RLS
alter table public.stock_movements enable row level security;
alter table public.stock_balances enable row level security;

-- stock_movements SELECT: has view_stock
drop policy if exists sm_select on public.stock_movements;
create policy sm_select on public.stock_movements for select to authenticated
  using (public.has_permission('view_stock'));

-- stock_movements INSERT: gated per movement_type
drop policy if exists sm_insert on public.stock_movements;
create policy sm_insert on public.stock_movements for insert to authenticated
  with check (
    (movement_type = 'CORRECTION' and public.has_permission('create_correction'))
    or (movement_type = 'VOID' and public.has_permission('create_void'))
    or (movement_type = 'OPNAME' and public.has_permission('create_opname'))
    or (movement_type in ('RECEIVING','USAGE','WASTE') and public.has_permission('create_stock_movement'))
  );

-- Ledger is source of truth: revoke UPDATE + DELETE at grant level (immutable ledger)
revoke update, delete on public.stock_movements from authenticated, anon;
grant select, insert on public.stock_movements to authenticated;

-- stock_balances SELECT: view_stock; NO direct write from user (only trigger writes it)
drop policy if exists sb_select on public.stock_balances;
create policy sb_select on public.stock_balances for select to authenticated
  using (public.has_permission('view_stock'));

revoke insert, update, delete on public.stock_balances from authenticated, anon;
grant select on public.stock_balances to authenticated;

-- 7. Convenience function: reconciliation view
create or replace view public.stock_reconciliation as
  select
    b.outlet_id,
    b.item_id,
    b.current_qty as balance_qty,
    coalesce((select sum(m.quantity) from public.stock_movements m
              where m.outlet_id = b.outlet_id and m.item_id = b.item_id), 0) as ledger_sum,
    (b.current_qty - coalesce((select sum(m.quantity) from public.stock_movements m
                               where m.outlet_id = b.outlet_id and m.item_id = b.item_id), 0)) as diff
  from public.stock_balances b;

select 'PHASE 1B migration completed' as status;
