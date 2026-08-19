'use client';

import { useEffect, useState, useCallback } from 'react';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { toast, Toaster } from 'sonner';
import { LogOut, LayoutDashboard, Users, Package, Settings as SettingsIcon, ScrollText, Loader2, Utensils, Shield, Plus, Trash2, Edit, Boxes, ArrowUpCircle, ArrowDownCircle, RefreshCw, Ban, Trash, ClipboardCheck, AlertTriangle, History } from 'lucide-react';

const ROLES = ['OWNER','MANAGER','PURCHASING','KITCHEN','BAR','SERVICE','STOCK'];

function useApi(session) {
  return useCallback(async (path, opts = {}) => {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`/api/${path}`, { ...opts, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }, [session]);
}

function LoginScreen({ onLoggedIn }) {
  const [employeeCode, setEmployeeCode] = useState('');
  const [pin, setPin] = useState('');
  const [loading, setLoading] = useState(false);
  const [setupInfo, setSetupInfo] = useState(null);
  const [checkingSetup, setCheckingSetup] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/setup/status');
        const data = await res.json();
        setSetupInfo(data);
      } catch (e) {}
      finally { setCheckingSetup(false); }
    })();
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: employeeCode, pin }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login gagal');
      const supabase = getBrowserSupabase();
      await supabase.auth.setSession({
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      toast.success(`Selamat datang, ${data.employee.name}`);
      onLoggedIn(data.session);
    } catch (err) {
      toast.error(err.message);
    } finally { setLoading(false); }
  };

  const seedOwner = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/setup/seed-owner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_code: 'OWN001', name: 'Owner Utama', pin: '123456' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Seed gagal');
      toast.success('Owner default berhasil dibuat: OWN001 / 123456');
      setEmployeeCode('OWN001'); setPin('123456');
      const r2 = await fetch('/api/setup/status'); setSetupInfo(await r2.json());
    } catch (err) { toast.error(err.message); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-white to-amber-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/brand/jom-makan-full.png" alt="Jom Makan" className="mx-auto h-20 md:h-24 w-auto mb-2" />
          <p className="text-sm text-gray-500 mt-1">Restaurant Operating System</p>
        </div>
        <Card className="shadow-xl border-0">
          <CardHeader>
            <CardTitle>Masuk</CardTitle>
            <CardDescription>Gunakan Employee ID dan PIN Anda</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <Label htmlFor="code">Employee ID</Label>
                <Input id="code" placeholder="OWN001" value={employeeCode} onChange={e => setEmployeeCode(e.target.value)} autoComplete="username" required />
              </div>
              <div>
                <Label htmlFor="pin">PIN</Label>
                <Input id="pin" type="password" inputMode="numeric" placeholder="******" value={pin} onChange={e => setPin(e.target.value)} autoComplete="current-password" required />
              </div>
              <Button type="submit" className="w-full bg-orange-500 hover:bg-orange-600" disabled={loading || checkingSetup}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Masuk'}
              </Button>
            </form>
            {setupInfo && !setupInfo.migration_ok && (
              <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                <strong>Migration belum dijalankan.</strong> Jalankan <code>/app/supabase/migration.sql</code> di Supabase SQL Editor terlebih dahulu.
              </div>
            )}
            {setupInfo?.migration_ok && !setupInfo.has_owner && (
              <div className="mt-4">
                <Button variant="outline" className="w-full" onClick={seedOwner} disabled={loading}>
                  <Shield className="w-4 h-4 mr-2" /> Buat Owner Default
                </Button>
                <p className="text-xs text-gray-500 mt-2 text-center">Membuat OWN001 dengan PIN 123456</p>
              </div>
            )}
          </CardContent>
        </Card>
        <p className="text-center text-xs text-gray-400 mt-4">Phase 1A — Database + Auth + Security</p>
      </div>
    </div>
  );
}

function Nav({ current, onNav, permissions, onLogout, me }) {
  const items = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, perm: 'view_dashboard' },
    { key: 'employees', label: 'Karyawan', icon: Users, perm: 'view_employee' },
    { key: 'items', label: 'Items', icon: Package, perm: 'view_items' },
    { key: 'stock', label: 'Stock', icon: Boxes, perm: 'view_stock' },
    { key: 'settings', label: 'Settings', icon: SettingsIcon, perm: 'view_settings' },
    { key: 'audit', label: 'Audit Log', icon: ScrollText, perm: 'view_audit_log' },
  ].filter(i => permissions.includes(i.perm));

  return (
    <>
      <div className="hidden md:flex flex-col w-64 bg-white border-r border-gray-200 min-h-screen p-4">
        <div className="flex items-center gap-3 mb-6 px-2">
          <img src="/brand/jom-makan-icon.png" alt="Jom Makan" className="w-11 h-11 object-contain" />
          <img src="/brand/jom-makan-text.png" alt="Jom Makan" className="h-8 object-contain" />
        </div>
        <nav className="flex-1 space-y-1">
          {items.map(i => (
            <button key={i.key} onClick={() => onNav(i.key)}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition ${current === i.key ? 'bg-orange-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>
              <i.icon className="w-4 h-4" />{i.label}
            </button>
          ))}
        </nav>
        <div className="border-t pt-3 mt-3">
          <div className="px-3 mb-2">
            <p className="text-xs text-gray-500">Masuk sebagai</p>
            <p className="text-sm font-semibold">{me?.name}</p>
            <Badge variant="secondary" className="mt-1">{me?.role}</Badge>
          </div>
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={onLogout}>
            <LogOut className="w-4 h-4 mr-2" /> Keluar
          </Button>
        </div>
      </div>
      <div className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t z-40">
        <div className="flex justify-around">
          {items.map(i => (
            <button key={i.key} onClick={() => onNav(i.key)}
              className={`flex-1 flex flex-col items-center py-2 gap-1 ${current === i.key ? 'text-orange-500' : 'text-gray-500'}`}>
              <i.icon className="w-5 h-5" />
              <span className="text-[10px]">{i.label}</span>
            </button>
          ))}
        </div>
        <button onClick={onLogout} className="w-full text-center text-xs py-1 text-gray-500 border-t">Keluar ({me?.name})</button>
      </div>
    </>
  );
}

function Dashboard({ api, me }) {
  const [stats, setStats] = useState(null);
  useEffect(() => { api('dashboard').then(setStats).catch(e => toast.error(e.message)); }, [api]);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-sm text-gray-500">Selamat datang kembali, {me?.name}</p>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        <Card><CardHeader className="pb-2"><CardDescription>Karyawan</CardDescription><CardTitle className="text-3xl">{stats?.employee_count ?? '-'}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Items</CardDescription><CardTitle className="text-3xl">{stats?.item_count ?? '-'}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Stock Movements</CardDescription><CardTitle className="text-3xl">{stats?.movement_count ?? '-'}</CardTitle></CardHeader></Card>
        <Card className={stats?.negative_stock_count > 0 ? 'border-red-300 bg-red-50' : ''}><CardHeader className="pb-2"><CardDescription>Stok Negatif</CardDescription><CardTitle className={`text-3xl ${stats?.negative_stock_count > 0 ? 'text-red-600' : ''}`}>{stats?.negative_stock_count ?? '-'}</CardTitle></CardHeader></Card>
        <Card><CardHeader className="pb-2"><CardDescription>Audit Log</CardDescription><CardTitle className="text-3xl">{stats?.audit_count ?? '-'}</CardTitle></CardHeader></Card>
      </div>
    </div>
  );
}

function Employees({ api, permissions }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ employee_code: '', name: '', pin: '', role: 'SERVICE', status: 'active', phone: '', position: '' });

  const canManage = permissions.includes('manage_employee');

  const load = async () => {
    setLoading(true);
    try { const d = await api('employees'); setList(d.employees || []); }
    catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      if (editing) {
        const patch = { name: form.name, role: form.role, status: form.status, phone: form.phone, position: form.position };
        await api(`employees/${editing.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        toast.success('Karyawan diperbarui');
      } else {
        await api('employees', { method: 'POST', body: JSON.stringify(form) });
        toast.success('Karyawan ditambahkan');
      }
      setOpen(false); setEditing(null);
      setForm({ employee_code: '', name: '', pin: '', role: 'SERVICE', status: 'active', phone: '', position: '' });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Hapus karyawan ini?')) return;
    try { await api(`employees/${id}`, { method: 'DELETE' }); toast.success('Terhapus'); load(); }
    catch (e) { toast.error(e.message); }
  };

  const openEdit = (emp) => {
    setEditing(emp);
    setForm({ employee_code: emp.employee_code, name: emp.name, pin: '', role: emp.role, status: emp.status, phone: emp.phone || '', position: emp.position || '' });
    setOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Karyawan</h1>
          <p className="text-sm text-gray-500">Kelola data karyawan</p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setEditing(null); }}>
            <DialogTrigger asChild>
              <Button className="bg-orange-500 hover:bg-orange-600"><Plus className="w-4 h-4 mr-1" />Tambah</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>{editing ? 'Edit Karyawan' : 'Tambah Karyawan'}</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div><Label>Employee ID</Label><Input value={form.employee_code} onChange={e => setForm({...form, employee_code: e.target.value})} disabled={!!editing} required /></div>
                <div><Label>Nama</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                {!editing && (<div><Label>PIN (min 6 digit)</Label><Input type="password" value={form.pin} onChange={e => setForm({...form, pin: e.target.value})} required minLength={6} /></div>)}
                <div>
                  <Label>Role</Label>
                  <Select value={form.role} onValueChange={v => setForm({...form, role: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ROLES.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={v => setForm({...form, status: v})}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="active">Aktif</SelectItem>
                      <SelectItem value="inactive">Nonaktif</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Phone</Label><Input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} /></div>
                <div><Label>Posisi</Label><Input value={form.position} onChange={e => setForm({...form, position: e.target.value})} /></div>
                <DialogFooter><Button type="submit">{editing ? 'Simpan' : 'Tambah'}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-500" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee ID</TableHead>
                  <TableHead>Nama</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Posisi</TableHead>
                  {canManage && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map(emp => (
                  <TableRow key={emp.id}>
                    <TableCell className="font-mono">{emp.employee_code}</TableCell>
                    <TableCell className="font-medium">{emp.name}</TableCell>
                    <TableCell><Badge variant="secondary">{emp.role}</Badge></TableCell>
                    <TableCell><Badge variant={emp.status === 'active' ? 'default' : 'destructive'}>{emp.status}</Badge></TableCell>
                    <TableCell>{emp.position || '-'}</TableCell>
                    {canManage && (
                      <TableCell className="text-right space-x-1">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(emp)}><Edit className="w-4 h-4" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => remove(emp.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {list.length === 0 && <TableRow><TableCell colSpan={canManage ? 6 : 5} className="text-center text-gray-500 py-8">Belum ada karyawan</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Items({ api, permissions }) {
  const [list, setList] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', category: '', stock_unit_id: '', purchase_unit_id: '', minimum_stock: 0 });
  const canManage = permissions.includes('manage_items');

  const load = async () => {
    setLoading(true);
    try {
      const [it, un] = await Promise.all([api('items'), api('units')]);
      setList(it.items || []); setUnits(un.units || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const submit = async (e) => {
    e.preventDefault();
    try {
      await api('items', { method: 'POST', body: JSON.stringify(form) });
      toast.success('Item ditambahkan');
      setOpen(false); setForm({ name: '', category: '', stock_unit_id: '', purchase_unit_id: '', minimum_stock: 0 });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const remove = async (id) => {
    if (!confirm('Hapus item?')) return;
    try { await api(`items/${id}`, { method: 'DELETE' }); toast.success('Terhapus'); load(); }
    catch (e) { toast.error(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Items</h1>
          <p className="text-sm text-gray-500">Manajemen inventory dasar</p>
        </div>
        {canManage && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-orange-500 hover:bg-orange-600"><Plus className="w-4 h-4 mr-1" />Tambah</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Tambah Item</DialogTitle></DialogHeader>
              <form onSubmit={submit} className="space-y-3">
                <div><Label>Nama</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} required /></div>
                <div><Label>Kategori</Label><Input value={form.category} onChange={e => setForm({...form, category: e.target.value})} /></div>
                <div>
                  <Label>Unit Stok</Label>
                  <Select value={form.stock_unit_id} onValueChange={v => setForm({...form, stock_unit_id: v})}>
                    <SelectTrigger><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                    <SelectContent>{units.map(u => <SelectItem key={u.id} value={u.id}>{u.code} - {u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Unit Pembelian</Label>
                  <Select value={form.purchase_unit_id} onValueChange={v => setForm({...form, purchase_unit_id: v})}>
                    <SelectTrigger><SelectValue placeholder="Pilih unit" /></SelectTrigger>
                    <SelectContent>{units.map(u => <SelectItem key={u.id} value={u.id}>{u.code} - {u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Stok Minimum</Label><Input type="number" step="0.01" value={form.minimum_stock} onChange={e => setForm({...form, minimum_stock: parseFloat(e.target.value) || 0})} /></div>
                <DialogFooter><Button type="submit">Tambah</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-500" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nama</TableHead>
                  <TableHead>Kategori</TableHead>
                  <TableHead>Unit Stok</TableHead>
                  <TableHead>Min Stok</TableHead>
                  {canManage && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.map(it => (
                  <TableRow key={it.id}>
                    <TableCell className="font-medium">{it.name}</TableCell>
                    <TableCell>{it.category || '-'}</TableCell>
                    <TableCell>{it.stock_unit?.code || '-'}</TableCell>
                    <TableCell>{it.minimum_stock}</TableCell>
                    {canManage && (
                      <TableCell className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => remove(it.id)}><Trash2 className="w-4 h-4 text-red-500" /></Button>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
                {list.length === 0 && <TableRow><TableCell colSpan={canManage ? 5 : 4} className="text-center text-gray-500 py-8">Belum ada item</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SettingsPage({ api, permissions }) {
  const [loading, setLoading] = useState(true);
  const canManage = permissions.includes('manage_settings');
  const [brand, setBrand] = useState({ name: '', footer_text: '' });
  const [outlet, setOutlet] = useState({ name: '', address: '', phone: '', whatsapp: '', email: '' });

  const load = async () => {
    setLoading(true);
    try {
      const d = await api('settings');
      if (d.brand) setBrand({ name: d.brand.name || '', footer_text: d.brand.footer_text || '' });
      if (d.outlet) setOutlet({ name: d.outlet.name || '', address: d.outlet.address || '', phone: d.outlet.phone || '', whatsapp: d.outlet.whatsapp || '', email: d.outlet.email || '' });
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const saveBrand = async () => {
    try { await api('settings/brand', { method: 'PATCH', body: JSON.stringify(brand) }); toast.success('Brand disimpan'); }
    catch (e) { toast.error(e.message); }
  };
  const saveOutlet = async () => {
    try { await api('settings/outlet', { method: 'PATCH', body: JSON.stringify(outlet) }); toast.success('Outlet disimpan'); }
    catch (e) { toast.error(e.message); }
  };

  if (loading) return <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-500" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-sm text-gray-500">Brand & Outlet</p>
      </div>
      <Card>
        <CardHeader><CardTitle>Brand</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Nama Brand</Label><Input value={brand.name} onChange={e => setBrand({...brand, name: e.target.value})} disabled={!canManage} /></div>
          <div><Label>Footer Text</Label><Textarea value={brand.footer_text} onChange={e => setBrand({...brand, footer_text: e.target.value})} disabled={!canManage} /></div>
          {canManage && <Button onClick={saveBrand}>Simpan Brand</Button>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Outlet</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div><Label>Nama Outlet</Label><Input value={outlet.name} onChange={e => setOutlet({...outlet, name: e.target.value})} disabled={!canManage} /></div>
          <div><Label>Alamat</Label><Textarea value={outlet.address} onChange={e => setOutlet({...outlet, address: e.target.value})} disabled={!canManage} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Telepon</Label><Input value={outlet.phone} onChange={e => setOutlet({...outlet, phone: e.target.value})} disabled={!canManage} /></div>
            <div><Label>WhatsApp</Label><Input value={outlet.whatsapp} onChange={e => setOutlet({...outlet, whatsapp: e.target.value})} disabled={!canManage} /></div>
          </div>
          <div><Label>Email</Label><Input value={outlet.email} onChange={e => setOutlet({...outlet, email: e.target.value})} disabled={!canManage} /></div>
          {canManage && <Button onClick={saveOutlet}>Simpan Outlet</Button>}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditLogs({ api }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try { const d = await api('audit-logs?limit=200'); setLogs(d.logs || []); }
      catch (e) { toast.error(e.message); }
      finally { setLoading(false); }
    })();
  }, []);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Audit Log</h1>
        <p className="text-sm text-gray-500">Semua perubahan tercatat otomatis (immutable)</p>
      </div>
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {loading ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-500" /></div> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Waktu</TableHead>
                  <TableHead>Aksi</TableHead>
                  <TableHead>Entity</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Entity ID</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs.map(l => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs whitespace-nowrap">{new Date(l.timestamp).toLocaleString('id-ID')}</TableCell>
                    <TableCell><Badge variant={l.action === 'DELETE' ? 'destructive' : l.action === 'INSERT' ? 'default' : 'secondary'}>{l.action}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{l.entity_type}</TableCell>
                    <TableCell><Badge variant="outline">{l.role || '-'}</Badge></TableCell>
                    <TableCell className="font-mono text-xs">{l.entity_id ? l.entity_id.slice(0, 8) : '-'}</TableCell>
                  </TableRow>
                ))}
                {logs.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-gray-500 py-8">Belum ada aktivitas</TableCell></TableRow>}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stock({ api, permissions }) {
  const [rows, setRows] = useState([]);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('stock'); // stock | history
  const [dialog, setDialog] = useState(null); // { type, item }
  const [form, setForm] = useState({ quantity: '', physical_qty: '', reason: '', correction_qty: '' });
  const [submitting, setSubmitting] = useState(false);

  const canMove = permissions.includes('create_stock_movement');
  const canOpname = permissions.includes('create_opname');
  const canCorrection = permissions.includes('create_correction');
  const canVoid = permissions.includes('create_void');

  const load = async () => {
    setLoading(true);
    try {
      const [s, h] = await Promise.all([api('stock'), api('stock/movements?limit=200')]);
      setRows(s.stock || []);
      setHistory(h.movements || []);
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const genKey = () => `ui-${Date.now()}-${Math.random().toString(36).slice(2,10)}`;

  const submitMovement = async (type) => {
    setSubmitting(true);
    try {
      const key = genKey();
      const body = {
        movement_type: type,
        item_id: dialog.item.id,
        quantity: parseFloat(form.quantity),
        reason: form.reason || null,
        idempotency_key: key,
      };
      const res = await api('stock/movements', { method: 'POST', body: JSON.stringify(body) });
      if (res.warning) toast.warning(res.warning);
      toast.success(`${type} tercatat. Saldo: ${res.current_qty}`);
      setDialog(null); setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const submitOpname = async () => {
    setSubmitting(true);
    try {
      if (!form.reason) throw new Error('Reason wajib diisi');
      const res = await api('stock/opname', { method: 'POST', body: JSON.stringify({
        item_id: dialog.item.id,
        physical_qty: parseFloat(form.physical_qty),
        reason: form.reason,
        idempotency_key: genKey(),
      })});
      toast.success(`Opname: sistem ${res.system_qty} → fisik ${res.physical_qty} (delta ${res.delta})`);
      setDialog(null); setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const submitCorrection = async () => {
    setSubmitting(true);
    try {
      if (!form.reason) throw new Error('Reason wajib diisi');
      const q = parseFloat(form.correction_qty);
      if (!q || q === 0) throw new Error('Correction quantity tidak boleh 0');
      await api('stock/correction', { method: 'POST', body: JSON.stringify({
        parent_transaction_id: dialog.movement.id,
        quantity: q,
        reason: form.reason,
        idempotency_key: genKey(),
      })});
      toast.success('Correction tercatat');
      setDialog(null); setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const submitVoid = async () => {
    setSubmitting(true);
    try {
      if (!form.reason) throw new Error('Reason wajib diisi');
      await api('stock/void', { method: 'POST', body: JSON.stringify({
        parent_transaction_id: dialog.movement.id,
        reason: form.reason,
        idempotency_key: genKey(),
      })});
      toast.success('VOID tercatat');
      setDialog(null); setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' });
      load();
    } catch (e) { toast.error(e.message); }
    finally { setSubmitting(false); }
  };

  const openMove = (item, type) => { setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' }); setDialog({ type, item }); };
  const openOpname = (item) => { setForm({ quantity:'', physical_qty: item.current_qty, reason:'', correction_qty:'' }); setDialog({ type: 'OPNAME', item }); };
  const openCorrection = (movement) => { setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' }); setDialog({ type: 'CORRECTION', movement }); };
  const openVoid = (movement) => { setForm({ quantity:'', physical_qty:'', reason:'', correction_qty:'' }); setDialog({ type: 'VOID', movement }); };

  const movementColor = (t) => ({
    RECEIVING: 'default',
    USAGE: 'secondary',
    WASTE: 'secondary',
    OPNAME: 'outline',
    CORRECTION: 'outline',
    VOID: 'destructive',
  }[t] || 'secondary');

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Stock</h1>
          <p className="text-sm text-gray-500">Manajemen stok, opname, koreksi & void</p>
        </div>
        <div className="flex gap-2">
          <Button variant={tab === 'stock' ? 'default' : 'outline'} size="sm" onClick={() => setTab('stock')}><Boxes className="w-4 h-4 mr-1" />Stok</Button>
          <Button variant={tab === 'history' ? 'default' : 'outline'} size="sm" onClick={() => setTab('history')}><History className="w-4 h-4 mr-1" />Histori</Button>
        </div>
      </div>

      {loading ? <div className="p-8 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-orange-500" /></div> : tab === 'stock' ? (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Stok Saat Ini</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(r => (
                <TableRow key={r.id} className={r.is_negative ? 'bg-red-50' : ''}>
                  <TableCell className="font-medium">{r.name}<div className="text-xs text-gray-500">{r.category || '-'}</div></TableCell>
                  <TableCell className={`text-right font-mono ${r.is_negative ? 'text-red-600 font-bold' : ''}`}>{Number(r.current_qty).toFixed(3)}</TableCell>
                  <TableCell>{r.stock_unit?.code || '-'}</TableCell>
                  <TableCell>
                    {r.is_negative ? <Badge variant="destructive"><AlertTriangle className="w-3 h-3 mr-1" />STOK NEGATIF · PERLU DICEK</Badge>
                      : r.below_minimum ? <Badge variant="outline" className="border-orange-500 text-orange-600">Di bawah minimum</Badge>
                      : <Badge variant="secondary">OK</Badge>}
                  </TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    {canMove && <Button size="sm" variant="outline" onClick={() => openMove(r, 'RECEIVING')}><ArrowUpCircle className="w-4 h-4 mr-1" />Terima</Button>}
                    {canMove && <Button size="sm" variant="outline" onClick={() => openMove(r, 'USAGE')}><ArrowDownCircle className="w-4 h-4 mr-1" />Pakai</Button>}
                    {canMove && <Button size="sm" variant="outline" onClick={() => openMove(r, 'WASTE')}><Trash className="w-4 h-4 mr-1" />Waste</Button>}
                    {canOpname && <Button size="sm" variant="outline" onClick={() => openOpname(r)}><ClipboardCheck className="w-4 h-4 mr-1" />Opname</Button>}
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-gray-500 py-8">Belum ada item. Tambahkan item di menu Items.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="whitespace-nowrap">Waktu</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Parent</TableHead>
                <TableHead className="text-right">Aksi</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs whitespace-nowrap">{new Date(m.created_at).toLocaleString('id-ID')}</TableCell>
                  <TableCell className="font-medium">{m.item?.name || '-'}</TableCell>
                  <TableCell><Badge variant={movementColor(m.movement_type)}>{m.movement_type}</Badge></TableCell>
                  <TableCell className={`text-right font-mono ${Number(m.quantity) < 0 ? 'text-red-600' : 'text-green-600'}`}>{Number(m.quantity) > 0 ? '+' : ''}{Number(m.quantity).toFixed(3)}</TableCell>
                  <TableCell>{m.stock_unit?.code || '-'}</TableCell>
                  <TableCell className="text-xs">{m.creator?.employee_code || '-'}</TableCell>
                  <TableCell className="text-xs max-w-[200px] truncate" title={m.reason || ''}>{m.reason || '-'}</TableCell>
                  <TableCell className="font-mono text-xs">{m.parent_transaction_id ? m.parent_transaction_id.slice(0,8) : '-'}</TableCell>
                  <TableCell className="text-right space-x-1 whitespace-nowrap">
                    {canCorrection && ['RECEIVING','USAGE','WASTE'].includes(m.movement_type) && (
                      <Button size="sm" variant="ghost" onClick={() => openCorrection(m)}><RefreshCw className="w-4 h-4" /></Button>
                    )}
                    {canVoid && ['RECEIVING','USAGE','WASTE','OPNAME'].includes(m.movement_type) && (
                      <Button size="sm" variant="ghost" onClick={() => openVoid(m)}><Ban className="w-4 h-4 text-red-500" /></Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {history.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-gray-500 py-8">Belum ada transaksi</TableCell></TableRow>}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}

      {/* Dialog for RECEIVING/USAGE/WASTE */}
      <Dialog open={dialog && ['RECEIVING','USAGE','WASTE'].includes(dialog.type)} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>{dialog?.type} — {dialog?.item?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-gray-500">Stok saat ini: <span className="font-mono font-bold">{dialog?.item?.current_qty} {dialog?.item?.stock_unit?.code}</span></div>
            <div><Label>Quantity ({dialog?.item?.stock_unit?.code})</Label>
              <Input type="number" step="0.001" min="0" value={form.quantity} onChange={e => setForm({...form, quantity: e.target.value})} placeholder="0.000" />
            </div>
            <div><Label>Reason (opsional)</Label>
              <Textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={() => submitMovement(dialog.type)} disabled={submitting || !form.quantity}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog OPNAME */}
      <Dialog open={dialog?.type === 'OPNAME'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Opname — {dialog?.item?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div className="text-sm text-gray-500">Sistem: <span className="font-mono font-bold">{dialog?.item?.current_qty} {dialog?.item?.stock_unit?.code}</span></div>
            <div><Label>Physical Count ({dialog?.item?.stock_unit?.code})</Label>
              <Input type="number" step="0.001" value={form.physical_qty} onChange={e => setForm({...form, physical_qty: e.target.value})} />
            </div>
            {form.physical_qty !== '' && dialog?.item && (
              <div className="text-sm">Delta: <span className={`font-mono font-bold ${(parseFloat(form.physical_qty) - Number(dialog.item.current_qty)) < 0 ? 'text-red-600' : 'text-green-600'}`}>{(parseFloat(form.physical_qty) - Number(dialog.item.current_qty)).toFixed(3)}</span></div>
            )}
            <div><Label>Reason (wajib)</Label>
              <Textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} rows={2} required />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={submitOpname} disabled={submitting || form.physical_qty === '' || !form.reason}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan Opname'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog CORRECTION */}
      <Dialog open={dialog?.type === 'CORRECTION'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Correction — Parent: {dialog?.movement?.id?.slice(0,8)}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div>Parent: <Badge>{dialog?.movement?.movement_type}</Badge> qty <span className="font-mono">{dialog?.movement?.quantity}</span></div>
            <div><Label>Correction quantity (signed, mis: -2 atau +3)</Label>
              <Input type="number" step="0.001" value={form.correction_qty} onChange={e => setForm({...form, correction_qty: e.target.value})} />
            </div>
            <div><Label>Reason (wajib)</Label>
              <Textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} rows={2} required />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button onClick={submitCorrection} disabled={submitting || !form.correction_qty || !form.reason}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Simpan Correction'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog VOID */}
      <Dialog open={dialog?.type === 'VOID'} onOpenChange={(v) => !v && setDialog(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Void — {dialog?.movement?.id?.slice(0,8)}</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="rounded bg-red-50 p-3 text-red-700">Membalikkan transaksi asli. Original tetap ada.</div>
            <div>Parent: <Badge>{dialog?.movement?.movement_type}</Badge> qty <span className="font-mono">{dialog?.movement?.quantity}</span></div>
            <div>Reverse akan mencatat: <span className="font-mono font-bold">{dialog?.movement ? -Number(dialog.movement.quantity) : 0}</span></div>
            <div><Label>Reason (wajib)</Label>
              <Textarea value={form.reason} onChange={e => setForm({...form, reason: e.target.value})} rows={2} required />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialog(null)}>Batal</Button>
            <Button variant="destructive" onClick={submitVoid} disabled={submitting || !form.reason}>{submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Void Transaksi'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const App = () => {  const [session, setSession] = useState(null);
  const [me, setMe] = useState(null);
  const [permissions, setPermissions] = useState([]);
  const [page, setPage] = useState('dashboard');
  const [checking, setChecking] = useState(true);

  const api = useApi(session);

  useEffect(() => {
    (async () => {
      try {
        const supabase = getBrowserSupabase();
        const { data } = await supabase.auth.getSession();
        if (data?.session) setSession(data.session);
      } catch (e) {
        console.error('Session init error:', e);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (!session) { setMe(null); setPermissions([]); return; }
    (async () => {
      try {
        const d = await api('auth/me');
        setMe(d.user); setPermissions(d.permissions || []);
        if (!d.permissions?.includes('view_dashboard')) {
          if (d.permissions?.includes('view_employee')) setPage('employees');
          else if (d.permissions?.includes('view_items')) setPage('items');
          else if (d.permissions?.includes('view_settings')) setPage('settings');
          else if (d.permissions?.includes('view_audit_log')) setPage('audit');
        }
      } catch (e) {
        toast.error(e.message);
        const supabase = getBrowserSupabase();
        await supabase.auth.signOut();
        setSession(null);
      }
    })();
  }, [session, api]);

  const logout = async () => {
    const supabase = getBrowserSupabase();
    await supabase.auth.signOut();
    setSession(null); setMe(null); setPermissions([]);
    toast.success('Berhasil keluar');
  };

  if (checking) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div>;
  if (!session) return (<><Toaster position="top-center" /><LoginScreen onLoggedIn={setSession} /></>);
  if (!me) return (<><Toaster position="top-center" /><div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-orange-500" /></div></>);

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <Toaster position="top-center" />
      <Nav current={page} onNav={setPage} permissions={permissions} onLogout={logout} me={me} />
      <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-x-hidden">
        {page === 'dashboard' && permissions.includes('view_dashboard') && <Dashboard api={api} me={me} />}
        {page === 'employees' && permissions.includes('view_employee') && <Employees api={api} permissions={permissions} />}
        {page === 'items' && permissions.includes('view_items') && <Items api={api} permissions={permissions} />}
        {page === 'stock' && permissions.includes('view_stock') && <Stock api={api} permissions={permissions} />}
        {page === 'settings' && permissions.includes('view_settings') && <SettingsPage api={api} permissions={permissions} />}
        {page === 'audit' && permissions.includes('view_audit_log') && <AuditLogs api={api} />}
      </main>
    </div>
  );
};

export default App;
