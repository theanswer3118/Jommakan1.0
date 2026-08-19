-- =============================================================
-- JOM MAKAN RESTAURANT OS - PHASE 1A MIGRATION
-- Database + Auth + Security + RLS + Audit Log
-- Run this ONCE in Supabase SQL Editor
-- =============================================================

create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

-- =============================================================
-- 1. ROLE ENUM
-- =============================================================
do $$ begin
  create type public.employee_role as enum (
    'OWNER','MANAGER','PURCHASING','KITCHEN','BAR','SERVICE','STOCK'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.employee_status as enum ('active','inactive');
exception when duplicate_object then null; end $$;

-- =============================================================
-- 2. TABLES
-- =============================================================

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  logo_url text,
  footer_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.outlets (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brands(id) on delete cascade,
  name text not null,
  address text,
  phone text,
  whatsapp text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_outlets_brand on public.outlets(brand_id);

create table if not exists public.outlet_settings (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  key text not null,
  value text,
  unique (outlet_id, key)
);
create index if not exists idx_outlet_settings_outlet on public.outlet_settings(outlet_id);

create table if not exists public.employees (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  outlet_id uuid not null references public.outlets(id) on delete restrict,
  employee_code text not null,
  name text not null,
  phone text,
  photo_url text,
  position text,
  department text,
  role public.employee_role not null default 'SERVICE',
  start_date date,
  resignation_date date,
  status public.employee_status not null default 'active',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, employee_code)
);
create index if not exists idx_employees_outlet on public.employees(outlet_id);
create index if not exists idx_employees_auth on public.employees(auth_user_id);
create index if not exists idx_employees_status on public.employees(status);

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null
);

create table if not exists public.items (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid not null references public.outlets(id) on delete cascade,
  name text not null,
  category text,
  stock_unit_id uuid references public.units(id),
  purchase_unit_id uuid references public.units(id),
  minimum_stock numeric(14,3) default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (outlet_id, name)
);
create index if not exists idx_items_outlet on public.items(outlet_id);
create index if not exists idx_items_category on public.items(category);

create table if not exists public.item_unit_conversions (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.items(id) on delete cascade,
  purchase_unit_id uuid not null references public.units(id),
  stock_unit_id uuid not null references public.units(id),
  conversion_ratio numeric(14,4) not null check (conversion_ratio > 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_iuc_item on public.item_unit_conversions(item_id);

-- =============================================================
-- 3. PERMISSIONS
-- =============================================================
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  description text
);

create table if not exists public.role_permissions (
  id uuid primary key default gen_random_uuid(),
  role public.employee_role not null,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  unique (role, permission_id)
);
create index if not exists idx_rp_role on public.role_permissions(role);

-- seed permissions
insert into public.permissions(key, description) values
  ('view_dashboard','Lihat dashboard'),
  ('view_employee','Lihat karyawan'),
  ('manage_employee','Kelola karyawan'),
  ('view_items','Lihat items'),
  ('manage_items','Kelola items'),
  ('view_settings','Lihat settings'),
  ('manage_settings','Kelola settings'),
  ('view_audit_log','Lihat audit log')
on conflict (key) do nothing;

-- seed role_permissions
-- OWNER: all
insert into public.role_permissions(role, permission_id)
  select 'OWNER'::public.employee_role, id from public.permissions
on conflict do nothing;

-- MANAGER: all except manage_settings (still gets it), keep same as owner minus none
insert into public.role_permissions(role, permission_id)
  select 'MANAGER'::public.employee_role, id from public.permissions
  where key in ('view_dashboard','view_employee','manage_employee','view_items','manage_items','view_settings','manage_settings','view_audit_log')
on conflict do nothing;

-- PURCHASING
insert into public.role_permissions(role, permission_id)
  select 'PURCHASING'::public.employee_role, id from public.permissions
  where key in ('view_dashboard','view_items','manage_items','view_employee')
on conflict do nothing;

-- KITCHEN
insert into public.role_permissions(role, permission_id)
  select 'KITCHEN'::public.employee_role, id from public.permissions
  where key in ('view_dashboard','view_items')
on conflict do nothing;

-- BAR
insert into public.role_permissions(role, permission_id)
  select 'BAR'::public.employee_role, id from public.permissions
  where key in ('view_dashboard','view_items')
on conflict do nothing;

-- SERVICE
insert into public.role_permissions(role, permission_id)
  select 'SERVICE'::public.employee_role, id from public.permissions
  where key in ('view_dashboard','view_employee')
on conflict do nothing;

-- STOCK
insert into public.role_permissions(role, permission_id)
  select 'STOCK'::public.employee_role, id from public.permissions
  where key in ('view_dashboard','view_items','manage_items')
on conflict do nothing;

-- =============================================================
-- 4. SECURITY DEFINER FUNCTIONS
-- =============================================================

create or replace function public.get_current_user_role()
returns public.employee_role
language sql stable security definer
set search_path = ''
as $$
  select e.role
  from public.employees e
  where e.auth_user_id = (select auth.uid())
    and e.status = 'active'
  limit 1;
$$;

create or replace function public.get_current_employee_outlet()
returns uuid
language sql stable security definer
set search_path = ''
as $$
  select e.outlet_id
  from public.employees e
  where e.auth_user_id = (select auth.uid())
    and e.status = 'active'
  limit 1;
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    join public.role_permissions rp on rp.role = e.role
    join public.permissions p on p.id = rp.permission_id
    where e.auth_user_id = (select auth.uid())
      and e.status = 'active'
      and p.key = permission_key
  );
$$;

grant execute on function public.get_current_user_role() to anon, authenticated;
grant execute on function public.get_current_employee_outlet() to anon, authenticated;
grant execute on function public.has_permission(text) to anon, authenticated;

-- =============================================================
-- 5. AUDIT LOG (IMMUTABLE)
-- =============================================================
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  outlet_id uuid,
  user_id uuid,
  role public.employee_role,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  timestamp timestamptz not null default now(),
  before_data jsonb,
  after_data jsonb,
  reason text
);
create index if not exists idx_audit_entity_type on public.audit_logs(entity_type);
create index if not exists idx_audit_entity_id on public.audit_logs(entity_id);
create index if not exists idx_audit_timestamp on public.audit_logs(timestamp);
create index if not exists idx_audit_outlet on public.audit_logs(outlet_id);

-- Generic audit trigger writer
create or replace function public.write_audit_row()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role public.employee_role;
  v_outlet uuid;
  v_entity_id uuid;
begin
  begin
    select role, outlet_id into v_role, v_outlet
    from public.employees where auth_user_id = v_user and status = 'active' limit 1;
  exception when others then
    v_role := null; v_outlet := null;
  end;

  if TG_OP = 'DELETE' then
    v_entity_id := (to_jsonb(OLD)->>'id')::uuid;
  else
    v_entity_id := (to_jsonb(NEW)->>'id')::uuid;
  end if;

  insert into public.audit_logs(
    outlet_id, user_id, role, action, entity_type, entity_id,
    before_data, after_data
  ) values (
    coalesce((case when TG_OP='DELETE' then (to_jsonb(OLD)->>'outlet_id') else (to_jsonb(NEW)->>'outlet_id') end)::uuid, v_outlet),
    v_user,
    v_role,
    TG_OP,
    TG_TABLE_NAME,
    v_entity_id,
    case when TG_OP in ('UPDATE','DELETE') then to_jsonb(OLD) else null end,
    case when TG_OP in ('INSERT','UPDATE') then to_jsonb(NEW) else null end
  );

  return coalesce(NEW, OLD);
end;
$$;

-- Attach audit triggers on business tables
drop trigger if exists audit_employees on public.employees;
create trigger audit_employees after insert or update or delete on public.employees
for each row execute function public.write_audit_row();

drop trigger if exists audit_items on public.items;
create trigger audit_items after insert or update or delete on public.items
for each row execute function public.write_audit_row();

drop trigger if exists audit_outlet_settings on public.outlet_settings;
create trigger audit_outlet_settings after insert or update or delete on public.outlet_settings
for each row execute function public.write_audit_row();

drop trigger if exists audit_brands on public.brands;
create trigger audit_brands after insert or update or delete on public.brands
for each row execute function public.write_audit_row();

drop trigger if exists audit_outlets on public.outlets;
create trigger audit_outlets after insert or update or delete on public.outlets
for each row execute function public.write_audit_row();

-- Auto update updated_at
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at := now();
  return NEW;
end; $$;

drop trigger if exists set_updated_at_employees on public.employees;
create trigger set_updated_at_employees before update on public.employees
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at_items on public.items;
create trigger set_updated_at_items before update on public.items
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at_brands on public.brands;
create trigger set_updated_at_brands before update on public.brands
for each row execute function public.tg_set_updated_at();

drop trigger if exists set_updated_at_outlets on public.outlets;
create trigger set_updated_at_outlets before update on public.outlets
for each row execute function public.tg_set_updated_at();

-- =============================================================
-- 6. ENABLE RLS
-- =============================================================
alter table public.brands enable row level security;
alter table public.outlets enable row level security;
alter table public.outlet_settings enable row level security;
alter table public.employees enable row level security;
alter table public.units enable row level security;
alter table public.items enable row level security;
alter table public.item_unit_conversions enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.audit_logs enable row level security;

-- =============================================================
-- 7. POLICIES
-- =============================================================

-- BRANDS: view anyone authenticated; write requires manage_settings
drop policy if exists brands_select on public.brands;
create policy brands_select on public.brands for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists brands_write on public.brands;
create policy brands_write on public.brands for all to authenticated
  using (public.has_permission('manage_settings'))
  with check (public.has_permission('manage_settings'));

-- OUTLETS: view auth; write manage_settings
drop policy if exists outlets_select on public.outlets;
create policy outlets_select on public.outlets for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists outlets_write on public.outlets;
create policy outlets_write on public.outlets for all to authenticated
  using (public.has_permission('manage_settings'))
  with check (public.has_permission('manage_settings'));

-- OUTLET_SETTINGS: view w/ view_settings, write w/ manage_settings
drop policy if exists os_select on public.outlet_settings;
create policy os_select on public.outlet_settings for select to authenticated
  using (public.has_permission('view_settings'));

drop policy if exists os_write on public.outlet_settings;
create policy os_write on public.outlet_settings for all to authenticated
  using (public.has_permission('manage_settings'))
  with check (public.has_permission('manage_settings'));

-- EMPLOYEES
drop policy if exists emp_select on public.employees;
create policy emp_select on public.employees for select to authenticated
  using (
    public.has_permission('view_employee')
    or auth_user_id = (select auth.uid())
  );

drop policy if exists emp_insert on public.employees;
create policy emp_insert on public.employees for insert to authenticated
  with check (public.has_permission('manage_employee'));

drop policy if exists emp_update on public.employees;
create policy emp_update on public.employees for update to authenticated
  using (public.has_permission('manage_employee'))
  with check (public.has_permission('manage_employee'));

drop policy if exists emp_delete on public.employees;
create policy emp_delete on public.employees for delete to authenticated
  using (public.has_permission('manage_employee'));

-- UNITS: read all auth, write manage_items
drop policy if exists units_select on public.units;
create policy units_select on public.units for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists units_write on public.units;
create policy units_write on public.units for all to authenticated
  using (public.has_permission('manage_items'))
  with check (public.has_permission('manage_items'));

-- ITEMS
drop policy if exists items_select on public.items;
create policy items_select on public.items for select to authenticated
  using (public.has_permission('view_items'));

drop policy if exists items_write on public.items;
create policy items_write on public.items for all to authenticated
  using (public.has_permission('manage_items'))
  with check (public.has_permission('manage_items'));

-- ITEM UNIT CONVERSIONS
drop policy if exists iuc_select on public.item_unit_conversions;
create policy iuc_select on public.item_unit_conversions for select to authenticated
  using (public.has_permission('view_items'));

drop policy if exists iuc_write on public.item_unit_conversions;
create policy iuc_write on public.item_unit_conversions for all to authenticated
  using (public.has_permission('manage_items'))
  with check (public.has_permission('manage_items'));

-- PERMISSIONS + ROLE_PERMISSIONS: read authenticated, no write (managed by admin/service_role)
drop policy if exists perm_select on public.permissions;
create policy perm_select on public.permissions for select to authenticated
  using ((select auth.uid()) is not null);

drop policy if exists rp_select on public.role_permissions;
create policy rp_select on public.role_permissions for select to authenticated
  using ((select auth.uid()) is not null);

-- AUDIT LOGS: SELECT requires view_audit_log; NO update/delete for anyone (immutable)
drop policy if exists audit_select on public.audit_logs;
create policy audit_select on public.audit_logs for select to authenticated
  using (public.has_permission('view_audit_log'));

-- Deliberately NO insert/update/delete policies -> deny by default even for OWNER via user token.
-- Only triggers (SECURITY DEFINER) can write. Service role bypasses RLS if truly needed.

-- HARDEN audit_logs: revoke direct DML from user roles so tampering ERRORS explicitly
revoke insert, update, delete on public.audit_logs from authenticated, anon;
grant select on public.audit_logs to authenticated;

-- =============================================================
-- 8. SEED DATA (Brand + Outlet + Units)
-- =============================================================
insert into public.brands(id, name, footer_text)
values ('11111111-1111-1111-1111-111111111111','Jom Makan','© Jom Makan Restaurant OS')
on conflict (id) do nothing;

insert into public.outlets(id, brand_id, name, address, phone, is_active)
values ('22222222-2222-2222-2222-222222222222',
        '11111111-1111-1111-1111-111111111111',
        'Outlet 1', 'Jl. Contoh No. 1', '021-000000', true)
on conflict (id) do nothing;

insert into public.units(code, name) values
  ('PCS','Pieces'),
  ('KG','Kilogram'),
  ('GR','Gram'),
  ('LTR','Liter'),
  ('ML','Milliliter'),
  ('BOX','Box'),
  ('PACK','Pack')
on conflict (code) do nothing;

-- =============================================================
-- 9. Helper: get employee by employee_code (for login lookup)
-- =============================================================
create or replace function public.get_employee_login(p_employee_code text)
returns table (auth_user_id uuid, status public.employee_status, synthetic_email text)
language sql stable security definer
set search_path = ''
as $$
  select e.auth_user_id, e.status,
         'emp_' || lower(e.employee_code) || '@jommakan.local'
  from public.employees e
  where lower(e.employee_code) = lower(p_employee_code)
  limit 1;
$$;
grant execute on function public.get_employee_login(text) to anon, authenticated;

-- DONE
select 'PHASE 1A migration completed' as status;
