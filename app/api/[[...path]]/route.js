import { NextResponse } from 'next/server';
import { getAdminSupabase, employeeCodeToEmail } from '@/lib/supabase/admin';
import { getUserSupabase } from '@/lib/supabase/userClient';

function getAccessToken(req) {
  const h = req.headers.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  return null;
}

async function getAuthContext(req) {
  const token = getAccessToken(req);
  if (!token) return { token: null, user: null, supabase: getUserSupabase(null) };
  const supabase = getUserSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { token, user: null, supabase };
  return { token, user: data.user, supabase };
}

function json(data, status = 200) {
  return NextResponse.json(data, { status });
}

async function handler(req, { params }) {
  const resolved = params && typeof params.then === 'function' ? await params : params;
  const path = (resolved?.path || []).join('/');
  const method = req.method;

  try {
    if (method === 'GET' && path === 'health') {
      return json({ ok: true, phase: '1A' });
    }

    // -------- SETUP: STATUS & SEED OWNER --------
    if (method === 'GET' && path === 'setup/status') {
      const admin = getAdminSupabase();
      const checks = {};
      const tables = ['brands','outlets','outlet_settings','employees','units','items','item_unit_conversions','permissions','role_permissions','audit_logs'];
      for (const t of tables) {
        const { error } = await admin.from(t).select('id', { count: 'exact' }).limit(1);
        checks[t] = error ? { ok: false, error: error.message } : { ok: true };
      }
      const migration_ok = Object.values(checks).every(c => c.ok);
      let has_brand = false, has_outlet = false, has_owner = false;
      if (migration_ok) {
        const { data: brand } = await admin.from('brands').select('id').limit(1);
        const { data: outlet } = await admin.from('outlets').select('id').limit(1);
        const { data: owner } = await admin.from('employees').select('id').eq('role','OWNER').limit(1);
        has_brand = (brand?.length || 0) > 0;
        has_outlet = (outlet?.length || 0) > 0;
        has_owner = (owner?.length || 0) > 0;
      }
      return json({ migration_ok, checks, has_brand, has_outlet, has_owner });
    }

    if (method === 'POST' && path === 'setup/seed-owner') {
      const admin = getAdminSupabase();
      const body = await req.json().catch(() => ({}));
      const employee_code = body.employee_code || 'OWN001';
      const name = body.name || 'Owner Utama';
      const pin = body.pin || '123456';

      // Auto-seed brand + outlet + units if missing (defensive)
      let { data: brand } = await admin.from('brands').select('id').limit(1).maybeSingle();
      if (!brand) {
        const { data: nb, error: bErr } = await admin.from('brands').insert({
          id: '11111111-1111-1111-1111-111111111111',
          name: 'Jom Makan',
          footer_text: '© Jom Makan Restaurant OS',
        }).select().single();
        if (bErr) return json({ error: 'Seed brand failed: ' + bErr.message }, 500);
        brand = nb;
      }
      let { data: outlet } = await admin.from('outlets').select('id').limit(1).maybeSingle();
      if (!outlet) {
        const { data: no, error: oErr } = await admin.from('outlets').insert({
          id: '22222222-2222-2222-2222-222222222222',
          brand_id: brand.id,
          name: 'Outlet 1',
          address: 'Jl. Contoh No. 1',
          phone: '021-000000',
          is_active: true,
        }).select().single();
        if (oErr) return json({ error: 'Seed outlet failed: ' + oErr.message }, 500);
        outlet = no;
      }
      // Seed units if missing
      const { count: unitCount } = await admin.from('units').select('*', { count: 'exact', head: true });
      if (!unitCount) {
        await admin.from('units').insert([
          { code: 'PCS', name: 'Pieces' },
          { code: 'KG', name: 'Kilogram' },
          { code: 'GR', name: 'Gram' },
          { code: 'LTR', name: 'Liter' },
          { code: 'ML', name: 'Milliliter' },
          { code: 'BOX', name: 'Box' },
          { code: 'PACK', name: 'Pack' },
        ]);
      }

      const { data: existing } = await admin.from('employees').select('id, auth_user_id').eq('employee_code', employee_code).maybeSingle();
      if (existing) return json({ error: 'Owner sudah ada', employee: existing }, 409);

      const email = employeeCodeToEmail(employee_code);
      const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
        email, password: pin, email_confirm: true,
        user_metadata: { employee_code, name },
      });
      if (authErr) return json({ error: authErr.message }, 400);

      const { data: emp, error: empErr } = await admin.from('employees').insert({
        auth_user_id: authUser.user.id,
        outlet_id: outlet.id,
        employee_code, name, role: 'OWNER', status: 'active',
      }).select().single();
      if (empErr) return json({ error: empErr.message }, 400);

      return json({ ok: true, employee: emp, credentials: { employee_code, pin } });
    }

    // -------- LOGIN --------
    if (method === 'POST' && path === 'auth/login') {
      const { employee_code, pin } = await req.json();
      if (!employee_code || !pin) return json({ error: 'employee_code dan PIN wajib diisi' }, 400);

      const admin = getAdminSupabase();
      const { data: emp } = await admin.from('employees')
        .select('id, auth_user_id, status, name, role, employee_code, outlet_id')
        .ilike('employee_code', employee_code).maybeSingle();

      if (!emp) return json({ error: 'Employee ID atau PIN salah' }, 401);
      if (emp.status !== 'active') return json({ error: 'Akun tidak aktif, hubungi admin' }, 403);
      if (!emp.auth_user_id) return json({ error: 'Akun belum ter-provision' }, 500);

      const email = employeeCodeToEmail(emp.employee_code);
      const anon = getUserSupabase(null);
      const { data: session, error: loginErr } = await anon.auth.signInWithPassword({ email, password: pin });
      if (loginErr || !session?.session) return json({ error: 'Employee ID atau PIN salah' }, 401);

      return json({ ok: true, session: session.session, employee: emp });
    }

    // -------- ME --------
    if (method === 'GET' && path === 'auth/me') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data: emp, error } = await supabase.from('employees')
        .select('*').eq('auth_user_id', user.id).maybeSingle();
      if (error) return json({ error: error.message }, 400);
      if (!emp) return json({ error: 'Employee not found' }, 404);

      const { data: perms } = await supabase.from('role_permissions')
        .select('permission_id, permissions(key)')
        .eq('role', emp.role);
      const permission_keys = (perms || []).map(p => p.permissions?.key).filter(Boolean);

      const { data: outlet } = await supabase.from('outlets').select('*').eq('id', emp.outlet_id).maybeSingle();
      let brand = null;
      if (outlet) {
        const { data: b } = await supabase.from('brands').select('*').eq('id', outlet.brand_id).maybeSingle();
        brand = b;
      }
      return json({ user: emp, permissions: permission_keys, outlet, brand });
    }

    // -------- DASHBOARD --------
    if (method === 'GET' && path === 'dashboard') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const [e, i, a, m, b] = await Promise.all([
        supabase.from('employees').select('*', { count: 'exact', head: true }),
        supabase.from('items').select('*', { count: 'exact', head: true }),
        supabase.from('audit_logs').select('*', { count: 'exact', head: true }),
        supabase.from('stock_movements').select('*', { count: 'exact', head: true }),
        supabase.from('stock_balances').select('current_qty').lt('current_qty', 0),
      ]);
      return json({
        employee_count: e.count || 0,
        item_count: i.count || 0,
        audit_count: a.count || 0,
        movement_count: m.count || 0,
        negative_stock_count: (b.data || []).length,
      });
    }

    // -------- EMPLOYEES --------
    if (method === 'GET' && path === 'employees') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('employees').select('*').order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 403);
      return json({ employees: data });
    }

    if (method === 'POST' && path === 'employees') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      const { data: currentEmp } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      const outlet_id = body.outlet_id || currentEmp?.outlet_id;
      if (!outlet_id) return json({ error: 'outlet_id required' }, 400);

      const email = employeeCodeToEmail(body.employee_code);
      const { data: authUser, error: authErr } = await admin.auth.admin.createUser({
        email, password: body.pin, email_confirm: true,
        user_metadata: { employee_code: body.employee_code, name: body.name },
      });
      if (authErr) return json({ error: authErr.message }, 400);

      const { data: emp, error: empErr } = await userClient.from('employees').insert({
        auth_user_id: authUser.user.id,
        outlet_id,
        employee_code: body.employee_code,
        name: body.name,
        phone: body.phone || null,
        position: body.position || null,
        department: body.department || null,
        role: body.role || 'SERVICE',
        start_date: body.start_date || null,
        status: body.status || 'active',
        notes: body.notes || null,
      }).select().single();

      if (empErr) {
        try { await admin.auth.admin.deleteUser(authUser.user.id); } catch (e) {}
        return json({ error: empErr.message }, 403);
      }
      return json({ employee: emp });
    }

    if (path.startsWith('employees/') && (method === 'PATCH' || method === 'DELETE')) {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[1];
      const userClient = getUserSupabase(token);

      if (method === 'DELETE') {
        const { error } = await userClient.from('employees').delete().eq('id', id);
        if (error) return json({ error: error.message }, 403);
        return json({ ok: true });
      }

      const body = await req.json();
      const patch = {};
      for (const k of ['name','phone','position','department','role','status','start_date','resignation_date','notes']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const { data, error } = await userClient.from('employees').update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 403);

      if (body.status === 'inactive' && data?.auth_user_id) {
        try { const admin = getAdminSupabase(); await admin.auth.admin.updateUserById(data.auth_user_id, { ban_duration: '87600h' }); } catch (e) {}
      } else if (body.status === 'active' && data?.auth_user_id) {
        try { const admin = getAdminSupabase(); await admin.auth.admin.updateUserById(data.auth_user_id, { ban_duration: 'none' }); } catch (e) {}
      }
      return json({ employee: data });
    }

    // -------- ITEMS --------
    if (method === 'GET' && path === 'items') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('items')
        .select('*, stock_unit:units!items_stock_unit_id_fkey(code,name), purchase_unit:units!items_purchase_unit_id_fkey(code,name)')
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 403);
      return json({ items: data });
    }

    if (method === 'GET' && path === 'units') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('units').select('*').order('code');
      if (error) return json({ error: error.message }, 403);
      return json({ units: data });
    }

    if (method === 'POST' && path === 'items') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      const { data: me } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      const outlet_id = body.outlet_id || me?.outlet_id;
      const { data, error } = await userClient.from('items').insert({
        outlet_id, name: body.name,
        category: body.category || null,
        stock_unit_id: body.stock_unit_id || null,
        purchase_unit_id: body.purchase_unit_id || null,
        minimum_stock: body.minimum_stock || 0,
        is_active: body.is_active !== false,
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ item: data });
    }

    if (path.startsWith('items/') && (method === 'PATCH' || method === 'DELETE')) {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[1];
      const userClient = getUserSupabase(token);
      if (method === 'DELETE') {
        const { error } = await userClient.from('items').delete().eq('id', id);
        if (error) return json({ error: error.message }, 403);
        return json({ ok: true });
      }
      const body = await req.json();
      const patch = {};
      for (const k of ['name','category','stock_unit_id','purchase_unit_id','minimum_stock','is_active']) {
        if (body[k] !== undefined) patch[k] = body[k];
      }
      const { data, error } = await userClient.from('items').update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ item: data });
    }

    // -------- SETTINGS --------
    if (method === 'GET' && path === 'settings') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data: brand, error: bErr } = await supabase.from('brands').select('*').limit(1).maybeSingle();
      const { data: outlet, error: oErr } = await supabase.from('outlets').select('*').limit(1).maybeSingle();
      const { data: settings, error: sErr } = await supabase.from('outlet_settings').select('*');
      if (bErr || oErr) return json({ error: (bErr || oErr).message }, 403);
      return json({ brand, outlet, settings: settings || [], settings_error: sErr?.message });
    }

    if (method === 'PATCH' && path === 'settings/brand') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      const { data: brand } = await userClient.from('brands').select('id').limit(1).maybeSingle();
      if (!brand) return json({ error: 'Brand tidak ditemukan' }, 404);
      const patch = {};
      for (const k of ['name','logo_url','footer_text']) if (body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await userClient.from('brands').update(patch).eq('id', brand.id).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ brand: data });
    }

    if (method === 'PATCH' && path === 'settings/outlet') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      const { data: outlet } = await userClient.from('outlets').select('id').limit(1).maybeSingle();
      if (!outlet) return json({ error: 'Outlet tidak ditemukan' }, 404);
      const patch = {};
      for (const k of ['name','address','phone','whatsapp','email','is_active']) if (body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await userClient.from('outlets').update(patch).eq('id', outlet.id).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ outlet: data });
    }

    // -------- AUDIT LOGS --------
    if (method === 'GET' && path === 'audit-logs') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      const { data, error } = await supabase.from('audit_logs')
        .select('*').order('timestamp', { ascending: false }).limit(limit);
      if (error) return json({ error: error.message }, 403);
      return json({ logs: data });
    }

    // Try to update/delete audit log for immutability test
    if ((method === 'DELETE' || method === 'PATCH') && path.startsWith('audit-logs/')) {
      const { token } = await getAuthContext(req);
      const id = path.split('/')[1];
      const userClient = getUserSupabase(token);
      if (method === 'DELETE') {
        const { error } = await userClient.from('audit_logs').delete().eq('id', id);
        if (error) return json({ error: error.message, immutable: true }, 403);
        return json({ ok: true });
      } else {
        const body = await req.json();
        const { error } = await userClient.from('audit_logs').update(body).eq('id', id);
        if (error) return json({ error: error.message, immutable: true }, 403);
        return json({ ok: true });
      }
    }

    // -------- STOCK --------
    // GET /api/stock -> list items joined with balance
    if (method === 'GET' && path === 'stock') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data: items, error } = await supabase.from('items')
        .select('id, name, category, minimum_stock, is_active, stock_unit:units!items_stock_unit_id_fkey(id, code, name)')
        .eq('is_active', true).order('name');
      if (error) return json({ error: error.message }, 403);
      const { data: balances } = await supabase.from('stock_balances').select('item_id, current_qty, updated_at');
      const bmap = Object.fromEntries((balances || []).map(b => [b.item_id, b]));
      const rows = (items || []).map(it => {
        const bal = bmap[it.id];
        const qty = bal ? Number(bal.current_qty) : 0;
        const min = Number(it.minimum_stock || 0);
        return {
          ...it,
          current_qty: qty,
          updated_at: bal?.updated_at || null,
          is_negative: qty < 0,
          below_minimum: qty < min && qty >= 0,
          needs_check: qty < 0,
        };
      });
      return json({ stock: rows });
    }

    // GET /api/stock/movements?item_id=&limit=
    if (method === 'GET' && path === 'stock/movements') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const item_id = url.searchParams.get('item_id');
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10), 500);
      let q = supabase.from('stock_movements')
        .select('*, item:items(name), stock_unit:units!stock_movements_stock_unit_id_fkey(code)')
        .order('created_at', { ascending: false }).limit(limit);
      if (item_id) q = q.eq('item_id', item_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 403);
      // Enrich with creator name
      const userIds = [...new Set((data || []).map(d => d.created_by).filter(Boolean))];
      let creators = {};
      if (userIds.length) {
        const { data: emps } = await supabase.from('employees').select('auth_user_id, name, employee_code').in('auth_user_id', userIds);
        creators = Object.fromEntries((emps || []).map(e => [e.auth_user_id, e]));
      }
      const rows = (data || []).map(m => ({ ...m, creator: creators[m.created_by] || null }));
      return json({ movements: rows });
    }

    // POST /api/stock/movements — main stock write endpoint
    if (method === 'POST' && path === 'stock/movements') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      const admin = getAdminSupabase();

      const {
        movement_type, // RECEIVING | USAGE | WASTE
        item_id,
        quantity, // absolute value from UI; sign applied by server
        stock_unit_id,
        purchase_quantity,
        purchase_unit_id,
        reason,
        idempotency_key,
        outlet_id: bodyOutletId,
      } = body;

      if (!['RECEIVING','USAGE','WASTE'].includes(movement_type)) {
        return json({ error: 'movement_type harus RECEIVING/USAGE/WASTE untuk endpoint ini' }, 400);
      }
      if (!item_id || quantity === undefined || quantity === null) {
        return json({ error: 'item_id dan quantity wajib' }, 400);
      }
      const qtyNum = Number(quantity);
      if (Number.isNaN(qtyNum) || qtyNum <= 0) {
        return json({ error: 'quantity harus > 0 (server yang tentukan tanda)' }, 400);
      }

      // Idempotency check first — return existing
      if (idempotency_key) {
        const { data: existing } = await admin.from('stock_movements')
          .select('*').eq('idempotency_key', idempotency_key).maybeSingle();
        if (existing) return json({ movement: existing, idempotent: true });
      }

      // Get item outlet + stock_unit
      const { data: me } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      const { data: item } = await userClient.from('items').select('id, outlet_id, stock_unit_id').eq('id', item_id).maybeSingle();
      if (!item) return json({ error: 'Item tidak ditemukan atau tidak accessible' }, 404);
      const outlet_id = bodyOutletId || item.outlet_id || me?.outlet_id;
      const finalStockUnit = stock_unit_id || item.stock_unit_id || null;

      // Determine signed quantity
      const signed = movement_type === 'RECEIVING' ? qtyNum : -qtyNum;

      const insertBody = {
        outlet_id, item_id, movement_type,
        quantity: signed,
        stock_unit_id: finalStockUnit,
        purchase_quantity: purchase_quantity ?? null,
        purchase_unit_id: purchase_unit_id ?? null,
        reason: reason ?? null,
        created_by: user.id,
        idempotency_key: idempotency_key ?? null,
      };
      const { data: mv, error } = await userClient.from('stock_movements').insert(insertBody).select().single();
      if (error) {
        if (error.code === '23505' && idempotency_key) {
          const { data: dup } = await admin.from('stock_movements').select('*').eq('idempotency_key', idempotency_key).maybeSingle();
          if (dup) return json({ movement: dup, idempotent: true });
        }
        return json({ error: error.message }, 403);
      }
      // Return new balance snapshot
      const { data: bal } = await admin.from('stock_balances').select('current_qty').eq('outlet_id', outlet_id).eq('item_id', item_id).maybeSingle();
      return json({ movement: mv, current_qty: bal ? Number(bal.current_qty) : signed, warning: (bal && Number(bal.current_qty) < 0) ? 'STOK NEGATIF' : null });
    }

    // POST /api/stock/opname { item_id, physical_qty, reason }
    if (method === 'POST' && path === 'stock/opname') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const { item_id, physical_qty, reason, idempotency_key } = body;
      if (!item_id || physical_qty === undefined || physical_qty === null || !reason) {
        return json({ error: 'item_id, physical_qty, reason wajib' }, 400);
      }
      const userClient = getUserSupabase(token);
      const admin = getAdminSupabase();

      if (idempotency_key) {
        const { data: existing } = await admin.from('stock_movements').select('*').eq('idempotency_key', idempotency_key).maybeSingle();
        if (existing) return json({ movement: existing, idempotent: true });
      }

      const { data: item } = await userClient.from('items').select('id, outlet_id, stock_unit_id').eq('id', item_id).maybeSingle();
      if (!item) return json({ error: 'Item tidak ditemukan' }, 404);
      const { data: bal } = await admin.from('stock_balances').select('current_qty').eq('outlet_id', item.outlet_id).eq('item_id', item_id).maybeSingle();
      const systemQty = bal ? Number(bal.current_qty) : 0;
      const delta = Number(physical_qty) - systemQty;

      const { data: mv, error } = await userClient.from('stock_movements').insert({
        outlet_id: item.outlet_id, item_id, movement_type: 'OPNAME',
        quantity: delta, stock_unit_id: item.stock_unit_id,
        reason, created_by: user.id, idempotency_key: idempotency_key ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ movement: mv, system_qty: systemQty, physical_qty: Number(physical_qty), delta });
    }

    // POST /api/stock/correction { parent_transaction_id, quantity (signed delta), reason }
    if (method === 'POST' && path === 'stock/correction') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const { parent_transaction_id, quantity, reason, idempotency_key } = body;
      if (!parent_transaction_id || quantity === undefined || quantity === null || !reason) {
        return json({ error: 'parent_transaction_id, quantity, reason wajib' }, 400);
      }
      const qtyNum = Number(quantity);
      if (Number.isNaN(qtyNum) || qtyNum === 0) return json({ error: 'quantity tidak valid' }, 400);
      const userClient = getUserSupabase(token);
      const admin = getAdminSupabase();

      if (idempotency_key) {
        const { data: existing } = await admin.from('stock_movements').select('*').eq('idempotency_key', idempotency_key).maybeSingle();
        if (existing) return json({ movement: existing, idempotent: true });
      }

      const { data: parent } = await userClient.from('stock_movements').select('*').eq('id', parent_transaction_id).maybeSingle();
      if (!parent) return json({ error: 'Parent transaction tidak ditemukan' }, 404);

      const { data: mv, error } = await userClient.from('stock_movements').insert({
        outlet_id: parent.outlet_id, item_id: parent.item_id,
        movement_type: 'CORRECTION',
        quantity: qtyNum,
        stock_unit_id: parent.stock_unit_id,
        parent_transaction_id, reason, created_by: user.id,
        idempotency_key: idempotency_key ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ movement: mv });
    }

    // POST /api/stock/void { parent_transaction_id, reason }
    if (method === 'POST' && path === 'stock/void') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const { parent_transaction_id, reason, idempotency_key } = body;
      if (!parent_transaction_id || !reason) return json({ error: 'parent_transaction_id dan reason wajib' }, 400);
      const userClient = getUserSupabase(token);
      const admin = getAdminSupabase();

      if (idempotency_key) {
        const { data: existing } = await admin.from('stock_movements').select('*').eq('idempotency_key', idempotency_key).maybeSingle();
        if (existing) return json({ movement: existing, idempotent: true });
      }

      const { data: parent } = await userClient.from('stock_movements').select('*').eq('id', parent_transaction_id).maybeSingle();
      if (!parent) return json({ error: 'Parent transaction tidak ditemukan' }, 404);
      if (parent.movement_type === 'VOID' || parent.movement_type === 'CORRECTION') {
        return json({ error: 'Tidak dapat VOID transaksi tipe ' + parent.movement_type }, 400);
      }
      // Idempotent: if already voided (a VOID movement referencing this parent), return that
      const { data: existingVoid } = await admin.from('stock_movements').select('*')
        .eq('parent_transaction_id', parent_transaction_id).eq('movement_type','VOID').maybeSingle();
      if (existingVoid) return json({ movement: existingVoid, already_voided: true });

      const { data: mv, error } = await userClient.from('stock_movements').insert({
        outlet_id: parent.outlet_id, item_id: parent.item_id,
        movement_type: 'VOID',
        quantity: -Number(parent.quantity),
        stock_unit_id: parent.stock_unit_id,
        parent_transaction_id, reason, created_by: user.id,
        idempotency_key: idempotency_key ?? null,
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ movement: mv });
    }

    // GET /api/stock/reconciliation
    if (method === 'GET' && path === 'stock/reconciliation') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('stock_reconciliation').select('*');
      if (error) return json({ error: error.message }, 403);
      return json({ reconciliation: data });
    }

    // ============ PHASE 2: PURCHASING ============

    // -------- SUPPLIERS --------
    if (method === 'GET' && path === 'suppliers') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('suppliers').select('*').order('name');
      if (error) return json({ error: error.message }, 403);
      return json({ suppliers: data });
    }
    if (method === 'POST' && path === 'suppliers') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      const { data: me } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      const { data, error } = await userClient.from('suppliers').insert({
        outlet_id: body.outlet_id || me?.outlet_id,
        name: body.name, contact_name: body.contact_name || null,
        whatsapp: body.whatsapp || null, phone: body.phone || null,
        email: body.email || null, address: body.address || null,
        notes: body.notes || null, is_active: body.is_active !== false,
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ supplier: data });
    }
    if (path.startsWith('suppliers/') && (method === 'PATCH' || method === 'DELETE')) {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[1];
      const userClient = getUserSupabase(token);
      if (method === 'DELETE') {
        const { error } = await userClient.from('suppliers').delete().eq('id', id);
        if (error) return json({ error: error.message }, 403);
        return json({ ok: true });
      }
      const body = await req.json();
      const patch = {};
      for (const k of ['name','contact_name','whatsapp','phone','email','address','notes','is_active']) if (body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await userClient.from('suppliers').update(patch).eq('id', id).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ supplier: data });
    }

    // -------- ITEM SUPPLIERS (price history) --------
    if (method === 'GET' && path === 'item-suppliers') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const item_id = url.searchParams.get('item_id');
      const supplier_id = url.searchParams.get('supplier_id');
      let q = supabase.from('item_suppliers').select('*, item:items(name), supplier:suppliers(name), unit:units!item_suppliers_price_unit_id_fkey(code,name)').order('effective_from', { ascending: false });
      if (item_id) q = q.eq('item_id', item_id);
      if (supplier_id) q = q.eq('supplier_id', supplier_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 403);
      return json({ prices: data });
    }
    if (method === 'POST' && path === 'item-suppliers') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      // Close previous active price for same supplier+item
      await userClient.from('item_suppliers').update({ is_active: false, effective_to: new Date().toISOString() })
        .eq('supplier_id', body.supplier_id).eq('item_id', body.item_id).eq('is_active', true);
      const { data, error } = await userClient.from('item_suppliers').insert({
        supplier_id: body.supplier_id, item_id: body.item_id,
        current_price: body.current_price, price_unit_id: body.price_unit_id || null,
        is_active: true,
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ price: data });
    }

    // -------- PURCHASE REQUESTS --------
    if (method === 'GET' && path === 'purchase-requests') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('purchase_requests')
        .select('*, items:purchase_request_items(*, unit:units(code, name), item:items(id, name))')
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 403);
      return json({ requests: data });
    }
    if (method === 'POST' && path === 'purchase-requests') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const userClient = getUserSupabase(token);
      const { data: me } = await userClient.from('employees').select('outlet_id, name, role').eq('auth_user_id', user.id).maybeSingle();
      // Create request
      const { data: pr, error } = await userClient.from('purchase_requests').insert({
        outlet_id: body.outlet_id || me?.outlet_id,
        requested_by: user.id,
        requester_name: me?.name || null,
        requester_role: me?.role || null,
        original_text: body.original_text || null,
        notes: body.notes || null,
        status: body.status || 'DRAFT',
      }).select().single();
      if (error) return json({ error: error.message }, 403);
      // Insert items
      if (Array.isArray(body.items) && body.items.length) {
        const rows = body.items.map(it => ({
          purchase_request_id: pr.id,
          item_id: it.item_id || null,
          item_name_text: it.item_name_text || null,
          quantity: it.quantity,
          unit_id: it.unit_id || null,
          unit_text: it.unit_text || null,
          notes: it.notes || null,
          needs_review: !it.item_id || !it.unit_id,
        }));
        const { error: iErr } = await userClient.from('purchase_request_items').insert(rows);
        if (iErr) return json({ error: iErr.message }, 400);
      }
      return json({ request: pr });
    }
    if (path.startsWith('purchase-requests/') && !path.includes('/', 18)) {
      const id = path.split('/')[1];
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const userClient = getUserSupabase(token);
      if (method === 'GET') {
        const { data, error } = await userClient.from('purchase_requests')
          .select('*, items:purchase_request_items(*, unit:units(code, name), item:items(id, name))')
          .eq('id', id).maybeSingle();
        if (error) return json({ error: error.message }, 403);
        return json({ request: data });
      }
      if (method === 'PATCH') {
        const body = await req.json();
        const patch = {};
        for (const k of ['status','notes','original_text']) if (body[k] !== undefined) patch[k] = body[k];
        const { data, error } = await userClient.from('purchase_requests').update(patch).eq('id', id).select().single();
        if (error) return json({ error: error.message }, 403);
        return json({ request: data });
      }
      if (method === 'DELETE') {
        const { error } = await userClient.from('purchase_requests').delete().eq('id', id);
        if (error) return json({ error: error.message }, 403);
        return json({ ok: true });
      }
    }

    // -------- PURCHASE ORDERS --------
    if (method === 'GET' && path === 'purchase-orders') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('purchase_orders')
        .select('*, supplier:suppliers(id, name, whatsapp, phone), items:purchase_order_items(*, item:items(name), purchase_unit:units!purchase_order_items_purchase_unit_id_fkey(code), stock_unit:units!purchase_order_items_stock_unit_id_fkey(code))')
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, 403);
      return json({ orders: data });
    }
    if (method === 'POST' && path === 'purchase-orders') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      if (body.idempotency_key) {
        const { data: existing } = await admin.from('purchase_orders').select('*, items:purchase_order_items(*)').eq('idempotency_key', body.idempotency_key).maybeSingle();
        if (existing) return json({ order: existing, idempotent: true });
      }

      const { data: me } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      const outlet_id = body.outlet_id || me?.outlet_id;

      // Generate PO number if not provided
      let po_number = body.po_number;
      if (!po_number) {
        const { count } = await admin.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('outlet_id', outlet_id);
        po_number = 'PO-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String((count || 0) + 1).padStart(3, '0');
      }

      const { data: po, error } = await userClient.from('purchase_orders').insert({
        outlet_id, supplier_id: body.supplier_id,
        purchase_request_id: body.purchase_request_id || null,
        po_number, order_date: body.order_date || new Date().toISOString().slice(0,10),
        expected_date: body.expected_date || null,
        status: 'ORDERED', notes: body.notes || null,
        created_by: user.id, idempotency_key: body.idempotency_key || null,
      }).select().single();
      if (error) {
        if (error.code === '23505' && body.idempotency_key) {
          const { data: dup } = await admin.from('purchase_orders').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
          if (dup) return json({ order: dup, idempotent: true });
        }
        return json({ error: error.message }, 403);
      }

      // Insert items with snapshots
      if (Array.isArray(body.items)) {
        const itemRows = [];
        for (const it of body.items) {
          const { data: itemRow } = await admin.from('items').select('name, stock_unit_id').eq('id', it.item_id).maybeSingle();
          const stockUnitId = itemRow?.stock_unit_id || null;
          let purchaseUnitSnapshot = null;
          if (it.purchase_unit_id) {
            const { data: u } = await admin.from('units').select('code, name').eq('id', it.purchase_unit_id).maybeSingle();
            purchaseUnitSnapshot = u ? `${u.code} — ${u.name}` : null;
          }
          itemRows.push({
            purchase_order_id: po.id,
            item_id: it.item_id,
            item_name_snapshot: itemRow?.name || it.item_name || 'Item',
            ordered_qty: it.ordered_qty,
            purchase_unit_id: it.purchase_unit_id || null,
            purchase_unit_snapshot: purchaseUnitSnapshot,
            stock_unit_id: stockUnitId,
            conversion_ratio_snapshot: it.conversion_ratio_snapshot ?? 1,
            unit_price: it.unit_price ?? 0,
          });
        }
        const { error: iErr } = await userClient.from('purchase_order_items').insert(itemRows);
        if (iErr) return json({ error: iErr.message }, 400);
      }

      // If linked to PR, mark PR PROCESSING
      if (body.purchase_request_id) {
        await userClient.from('purchase_requests').update({ status: 'PROCESSING' }).eq('id', body.purchase_request_id);
      }

      const { data: full } = await userClient.from('purchase_orders').select('*, supplier:suppliers(*), items:purchase_order_items(*)').eq('id', po.id).maybeSingle();
      return json({ order: full });
    }

    if (path.startsWith('purchase-orders/') && !path.includes('/receiving')) {
      const parts = path.split('/');
      const id = parts[1];
      const { user, token, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const userClient = getUserSupabase(token);
      if (method === 'GET') {
        const { data, error } = await userClient.from('purchase_orders')
          .select('*, supplier:suppliers(*), items:purchase_order_items(*, item:items(name, stock_unit_id), purchase_unit:units!purchase_order_items_purchase_unit_id_fkey(code, name))')
          .eq('id', id).maybeSingle();
        if (error) return json({ error: error.message }, 403);
        return json({ order: data });
      }
    }

    // -------- RECEIVINGS --------
    if (method === 'GET' && path === 'receivings') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const po_id = url.searchParams.get('purchase_order_id');
      let q = supabase.from('receivings')
        .select('*, po:purchase_orders(po_number, supplier_id, supplier:suppliers(name)), items:receiving_items(*, item:items(name))')
        .order('created_at', { ascending: false });
      if (po_id) q = q.eq('purchase_order_id', po_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 403);
      return json({ receivings: data });
    }
    if (method === 'POST' && path === 'receivings') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      if (body.idempotency_key) {
        const { data: existing } = await admin.from('receivings').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
        if (existing) return json({ receiving: existing, idempotent: true });
      }

      const { data: po } = await admin.from('purchase_orders').select('outlet_id').eq('id', body.purchase_order_id).maybeSingle();
      if (!po) return json({ error: 'PO tidak ditemukan' }, 404);

      const { data: rec, error } = await userClient.from('receivings').insert({
        outlet_id: po.outlet_id,
        purchase_order_id: body.purchase_order_id,
        received_by: user.id,
        received_at: body.received_at || new Date().toISOString(),
        status: 'POSTED', notes: body.notes || null,
        photo_path: body.photo_path || null,
        idempotency_key: body.idempotency_key || null,
      }).select().single();
      if (error) {
        if (error.code === '23505' && body.idempotency_key) {
          const { data: dup } = await admin.from('receivings').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
          if (dup) return json({ receiving: dup, idempotent: true });
        }
        return json({ error: error.message }, 403);
      }

      // Insert receiving items (trigger will create stock movements & update PO)
      const rows = [];
      for (const it of (body.items || [])) {
        // Snapshot fields from POI
        const { data: poi } = await admin.from('purchase_order_items').select('*').eq('id', it.purchase_order_item_id).maybeSingle();
        if (!poi) continue;
        if (Number(it.received_qty) <= 0) continue;
        rows.push({
          receiving_id: rec.id,
          purchase_order_item_id: poi.id,
          item_id: poi.item_id,
          ordered_qty_snapshot: poi.ordered_qty,
          received_qty: it.received_qty,
          purchase_unit_id: poi.purchase_unit_id,
          stock_unit_id: poi.stock_unit_id,
          conversion_ratio_snapshot: poi.conversion_ratio_snapshot,
        });
      }
      if (rows.length) {
        const { error: rErr } = await userClient.from('receiving_items').insert(rows);
        if (rErr) return json({ error: rErr.message }, 400);
      }

      const { data: full } = await userClient.from('receivings')
        .select('*, items:receiving_items(*, item:items(name)), po:purchase_orders(po_number, status)')
        .eq('id', rec.id).maybeSingle();
      return json({ receiving: full });
    }

    // -------- BILLS --------
    if (method === 'GET' && path === 'bills') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const { data, error } = await supabase.from('bills')
        .select('*, supplier:suppliers(name, whatsapp), receivings:bill_receivings(receiving_id, receiving:receivings(id, received_at, po:purchase_orders(po_number)))')
        .order('bill_date', { ascending: false });
      if (error) return json({ error: error.message }, 403);
      // enrich with status
      const ids = (data || []).map(b => b.id);
      let statusMap = {};
      if (ids.length) {
        const { data: sv } = await supabase.from('bill_status_view').select('*').in('bill_id', ids);
        statusMap = Object.fromEntries((sv || []).map(s => [s.bill_id, s]));
      }
      const rows = (data || []).map(b => ({ ...b, ...(statusMap[b.id] || {}) }));
      return json({ bills: rows });
    }
    if (method === 'POST' && path === 'bills') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      if (body.idempotency_key) {
        const { data: existing } = await admin.from('bills').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
        if (existing) return json({ bill: existing, idempotent: true });
      }

      const { data: me } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      let bill_number = body.bill_number;
      if (!bill_number) {
        const { count } = await admin.from('bills').select('*', { count: 'exact', head: true }).eq('outlet_id', me?.outlet_id);
        bill_number = 'BILL-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String((count || 0) + 1).padStart(3,'0');
      }
      const { data: bill, error } = await userClient.from('bills').insert({
        outlet_id: body.outlet_id || me?.outlet_id,
        supplier_id: body.supplier_id,
        bill_number,
        bill_date: body.bill_date || new Date().toISOString().slice(0,10),
        due_date: body.due_date || null,
        total_amount: body.total_amount,
        notes: body.notes || null,
        photo_path: body.photo_path || null,
        created_by: user.id,
        idempotency_key: body.idempotency_key || null,
      }).select().single();
      if (error) return json({ error: error.message }, 403);

      if (Array.isArray(body.receiving_ids) && body.receiving_ids.length) {
        const rows = body.receiving_ids.map(rid => ({ bill_id: bill.id, receiving_id: rid }));
        const { error: brErr } = await userClient.from('bill_receivings').insert(rows);
        if (brErr) return json({ error: brErr.message }, 400);
      }
      return json({ bill });
    }

    // -------- PAYMENTS --------
    if (method === 'GET' && path === 'payments') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const bill_id = url.searchParams.get('bill_id');
      let q = supabase.from('payments').select('*, bill:bills(bill_number)').order('payment_date', { ascending: false });
      if (bill_id) q = q.eq('bill_id', bill_id);
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 403);
      return json({ payments: data });
    }
    if (method === 'POST' && path === 'payments') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      if (body.idempotency_key) {
        const { data: existing } = await admin.from('payments').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
        if (existing) return json({ payment: existing, idempotent: true });
      }

      const { data: bill } = await admin.from('bills').select('outlet_id').eq('id', body.bill_id).maybeSingle();
      if (!bill) return json({ error: 'Bill tidak ditemukan' }, 404);

      const { data: pay, error } = await userClient.from('payments').insert({
        outlet_id: bill.outlet_id,
        bill_id: body.bill_id,
        amount: body.amount,
        payment_date: body.payment_date || new Date().toISOString().slice(0,10),
        method: body.method || 'TRANSFER',
        reference: body.reference || null,
        proof_file: body.proof_file || null,
        parent_transaction_id: body.parent_transaction_id || null,
        created_by: user.id,
        idempotency_key: body.idempotency_key || null,
      }).select().single();
      if (error) {
        if (error.code === '23505' && body.idempotency_key) {
          const { data: dup } = await admin.from('payments').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
          if (dup) return json({ payment: dup, idempotent: true });
        }
        return json({ error: error.message }, 403);
      }

      // Return new bill status
      const { data: sv } = await admin.from('bill_status_view').select('*').eq('bill_id', body.bill_id).maybeSingle();
      return json({ payment: pay, bill_status: sv });
    }

    // -------- STORAGE (receipts photos) --------
    // POST /api/storage/upload - multipart form with file, folder (receiving/bill/payment)
    if (method === 'POST' && path === 'storage/upload') {
      const { user } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const admin = getAdminSupabase();
      const form = await req.formData();
      const file = form.get('file');
      const folder = form.get('folder') || 'misc';
      if (!file) return json({ error: 'File wajib' }, 400);
      const ts = Date.now();
      const ext = (file.name || 'jpg').split('.').pop();
      const path = `${folder}/${user.id}/${ts}.${ext}`;
      const arrayBuffer = await file.arrayBuffer();
      const { data, error } = await admin.storage.from('receipts').upload(path, Buffer.from(arrayBuffer), {
        contentType: file.type || 'image/jpeg', upsert: false,
      });
      if (error) return json({ error: error.message }, 400);
      return json({ path: data.path });
    }

    // GET /api/storage/signed?path=xxx  -> returns short-lived signed URL
    if (method === 'GET' && path === 'storage/signed') {
      const { user } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const p = url.searchParams.get('path');
      if (!p) return json({ error: 'path wajib' }, 400);
      const admin = getAdminSupabase();
      const { data, error } = await admin.storage.from('receipts').createSignedUrl(p, 60 * 10);
      if (error) return json({ error: error.message }, 400);
      return json({ signed_url: data.signedUrl });
    }

    // ============ PHASE 2.5: QUICK PURCHASE ============

    // Fuzzy match supplier by name
    // GET /api/suppliers/match?q=<name>
    if (method === 'GET' && path === 'suppliers/match') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const url = new URL(req.url);
      const q = (url.searchParams.get('q') || '').trim();
      if (!q) return json({ matches: [] });
      const normalize = (s) => (s || '').toLowerCase()
        .replace(/\b(warung|toko|pak|bu|next|the|cv|pt|ud|mrs?|mrs)\b/gi, '')
        .replace(/[^a-z0-9]/g, '').trim();
      const nq = normalize(q);
      const { data: all } = await supabase.from('suppliers').select('id, name, whatsapp, is_active').eq('is_active', true);
      const scored = (all || []).map(s => {
        const ns = normalize(s.name);
        // similarity: prefix match / substring / same normalized
        let score = 0;
        if (ns === nq) score = 100;
        else if (ns.startsWith(nq) || nq.startsWith(ns)) score = 85;
        else if (ns.includes(nq) || nq.includes(ns)) score = 70;
        else {
          // jaccard-ish on trigrams
          const tri = (s) => { const t = new Set(); for (let i = 0; i < s.length - 2; i++) t.add(s.slice(i, i+3)); return t; };
          const a = tri(ns), b = tri(nq);
          const inter = [...a].filter(x => b.has(x)).length;
          const uni = new Set([...a, ...b]).size || 1;
          score = Math.round((inter / uni) * 100);
        }
        return { ...s, score };
      }).filter(s => s.score >= 40).sort((a,b)=>b.score - a.score).slice(0, 5);
      return json({ matches: scored });
    }

    // POST /api/quick-purchase — atomic PO+Receiving+Bill(+Payment)
    // body: {
    //   supplier_id (opsional) or supplier_name (auto-create),
    //   items: [{ item_id, qty, unit_price? (optional), purchase_unit_id? }],
    //   payment: { method, amount, reference? } | null,   // null jika belum bayar (Shopee prepaid harusnya diisi)
    //   received: true|false,                              // apakah barang sudah datang
    //   pricing_pending: true|false,                       // apakah harga belum diketahui
    //   photo_path?, notes?, idempotency_key?
    // }
    if (method === 'POST' && path === 'quick-purchase') {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      if (body.idempotency_key) {
        const { data: existing } = await admin.from('purchase_orders').select('*').eq('idempotency_key', body.idempotency_key).maybeSingle();
        if (existing) {
          const { data: fullExisting } = await admin.from('purchase_orders').select('*, supplier:suppliers(*), items:purchase_order_items(*)').eq('id', existing.id).maybeSingle();
          return json({ order: fullExisting, idempotent: true });
        }
      }

      const { data: me } = await userClient.from('employees').select('outlet_id').eq('auth_user_id', user.id).maybeSingle();
      const outlet_id = body.outlet_id || me?.outlet_id;

      // Resolve supplier
      let supplier_id = body.supplier_id;
      if (!supplier_id && body.supplier_name) {
        const { data: sup, error: supErr } = await userClient.from('suppliers').insert({
          outlet_id, name: body.supplier_name, is_active: true,
        }).select().single();
        if (supErr) {
          // maybe duplicate — try find
          const { data: found } = await admin.from('suppliers').select('id').eq('outlet_id', outlet_id).ilike('name', body.supplier_name).maybeSingle();
          if (found) supplier_id = found.id;
          else return json({ error: 'Gagal buat supplier: ' + supErr.message }, 400);
        } else supplier_id = sup.id;
      }
      if (!supplier_id) return json({ error: 'supplier_id atau supplier_name wajib' }, 400);

      // Generate PO number
      const { count: poCount } = await admin.from('purchase_orders').select('*', { count: 'exact', head: true }).eq('outlet_id', outlet_id);
      const po_number = 'QP-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String((poCount || 0) + 1).padStart(3, '0');

      // Create PO
      const { data: po, error: poErr } = await userClient.from('purchase_orders').insert({
        outlet_id, supplier_id, po_number,
        order_date: new Date().toISOString().slice(0,10),
        status: 'ORDERED', is_quick_purchase: true,
        notes: body.notes || null, created_by: user.id,
        idempotency_key: body.idempotency_key || null,
      }).select().single();
      if (poErr) return json({ error: poErr.message }, 400);

      // Insert PO items
      const poiRows = [];
      let totalAmount = 0;
      for (const it of (body.items || [])) {
        const { data: itemRow } = await admin.from('items').select('name, stock_unit_id').eq('id', it.item_id).maybeSingle();
        if (!itemRow) continue;
        const unitPrice = body.pricing_pending ? 0 : Number(it.unit_price || 0);
        totalAmount += Number(it.qty) * unitPrice;
        poiRows.push({
          purchase_order_id: po.id,
          item_id: it.item_id,
          item_name_snapshot: itemRow.name,
          ordered_qty: Number(it.qty),
          purchase_unit_id: it.purchase_unit_id || itemRow.stock_unit_id,
          stock_unit_id: itemRow.stock_unit_id,
          conversion_ratio_snapshot: it.conversion_ratio_snapshot ?? 1,
          unit_price: unitPrice,
        });
      }
      const { data: pois, error: poiErr } = await userClient.from('purchase_order_items').insert(poiRows).select();
      if (poiErr) return json({ error: poiErr.message }, 400);

      let receiving = null;
      if (body.received) {
        // Create receiving
        const { data: rec, error: recErr } = await userClient.from('receivings').insert({
          outlet_id, purchase_order_id: po.id,
          received_by: user.id, received_at: new Date().toISOString(),
          status: 'POSTED', notes: body.notes || null,
          photo_path: body.photo_path || null,
        }).select().single();
        if (recErr) return json({ error: recErr.message }, 400);
        // receiving_items (trigger will create stock movements + update PO status)
        const riRows = pois.map(poi => ({
          receiving_id: rec.id,
          purchase_order_item_id: poi.id,
          item_id: poi.item_id,
          ordered_qty_snapshot: poi.ordered_qty,
          received_qty: poi.ordered_qty, // all received
          purchase_unit_id: poi.purchase_unit_id,
          stock_unit_id: poi.stock_unit_id,
          conversion_ratio_snapshot: poi.conversion_ratio_snapshot,
        }));
        const { error: riErr } = await userClient.from('receiving_items').insert(riRows);
        if (riErr) return json({ error: riErr.message }, 400);
        receiving = rec;
      }

      // Create Bill (linked to receiving if any)
      const { count: billCount } = await admin.from('bills').select('*', { count: 'exact', head: true }).eq('outlet_id', outlet_id);
      const bill_number = 'BILL-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String((billCount || 0) + 1).padStart(3,'0');
      const { data: bill, error: billErr } = await userClient.from('bills').insert({
        outlet_id, supplier_id, bill_number,
        bill_date: new Date().toISOString().slice(0,10),
        total_amount: body.pricing_pending ? 0 : totalAmount,
        pricing_status: body.pricing_pending ? 'PENDING' : 'PRICED',
        notes: body.notes || null,
        photo_path: body.photo_path || null,
        created_by: user.id,
      }).select().single();
      if (billErr) return json({ error: billErr.message }, 400);
      if (receiving) {
        await userClient.from('bill_receivings').insert({ bill_id: bill.id, receiving_id: receiving.id });
      }

      // Create Payment if paid
      let payment = null;
      if (body.payment && Number(body.payment.amount) > 0 && !body.pricing_pending) {
        const { data: pay, error: payErr } = await userClient.from('payments').insert({
          outlet_id, bill_id: bill.id,
          amount: Number(body.payment.amount),
          payment_date: new Date().toISOString().slice(0,10),
          method: body.payment.method || 'CASH',
          reference: body.payment.reference || null,
          proof_file: body.payment.proof_file || body.photo_path || null,
          created_by: user.id,
        }).select().single();
        if (payErr) return json({ error: payErr.message }, 400);
        payment = pay;
      }

      // Update item_suppliers price history if priced
      if (!body.pricing_pending) {
        for (const it of (body.items || [])) {
          if (Number(it.unit_price) > 0) {
            await admin.from('item_suppliers').update({ is_active: false, effective_to: new Date().toISOString() })
              .eq('supplier_id', supplier_id).eq('item_id', it.item_id).eq('is_active', true);
            await admin.from('item_suppliers').insert({
              supplier_id, item_id: it.item_id, current_price: Number(it.unit_price),
              price_unit_id: it.purchase_unit_id || null, is_active: true,
            });
          }
        }
      }

      return json({ ok: true, po, receiving, bill, payment });
    }

    // PATCH /api/bills/:id/set-prices — update pricing for pending bill
    // body: { items: [{ purchase_order_item_id, unit_price }], total_amount? }
    if (method === 'PATCH' && path.match(/^bills\/[^/]+\/set-prices$/)) {
      const { user, token } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const id = path.split('/')[1];
      const body = await req.json();
      const admin = getAdminSupabase();
      const userClient = getUserSupabase(token);

      const { data: bill } = await admin.from('bills').select('*, receivings:bill_receivings(receiving:receivings(purchase_order_id))').eq('id', id).maybeSingle();
      if (!bill) return json({ error: 'Bill tidak ditemukan' }, 404);

      // Update PO items unit_price via admin (bypass RLS since owner-privileged)
      let total = 0;
      for (const it of (body.items || [])) {
        const { data: updated } = await admin.from('purchase_order_items')
          .update({ unit_price: Number(it.unit_price) })
          .eq('id', it.purchase_order_item_id).select().single();
        if (updated) total += Number(updated.ordered_qty) * Number(it.unit_price);
        // Update supplier price history
        if (Number(it.unit_price) > 0 && updated?.item_id) {
          await admin.from('item_suppliers').update({ is_active: false, effective_to: new Date().toISOString() })
            .eq('supplier_id', bill.supplier_id).eq('item_id', updated.item_id).eq('is_active', true);
          await admin.from('item_suppliers').insert({
            supplier_id: bill.supplier_id, item_id: updated.item_id,
            current_price: Number(it.unit_price),
            price_unit_id: updated.purchase_unit_id || null, is_active: true,
          });
        }
      }
      const finalTotal = body.total_amount !== undefined ? Number(body.total_amount) : total;
      const { data: updBill, error } = await userClient.from('bills')
        .update({ total_amount: finalTotal, pricing_status: 'PRICED' })
        .eq('id', id).select().single();
      if (error) return json({ error: error.message }, 403);
      return json({ bill: updBill });
    }

    // Dashboard extra
    if (method === 'GET' && path === 'dashboard/purchasing') {
      const { user, supabase } = await getAuthContext(req);
      if (!user) return json({ error: 'Unauthorized' }, 401);
      const [pending_delivery, pending_price] = await Promise.all([
        supabase.from('purchase_orders').select('id, po_number, order_date, supplier:suppliers(name), items:purchase_order_items(item_name_snapshot, ordered_qty, received_qty)').in('status', ['ORDERED','PARTIAL']),
        supabase.from('bills').select('id, bill_number, bill_date, supplier:suppliers(name, whatsapp)').eq('pricing_status', 'PENDING'),
      ]);
      return json({
        pending_delivery: pending_delivery.data || [],
        pending_price: pending_price.data || [],
      });
    }

    return json({ error: 'Not found', path, method }, 404);
  } catch (e) {
    return json({ error: e.message || 'Server error' }, 500);
  }
}

export { handler as GET, handler as POST, handler as PATCH, handler as PUT, handler as DELETE };
