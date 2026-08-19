const fs = require('fs');
const { Client } = require('pg');

const password = 'Sukses3118#';
const encoded = encodeURIComponent(password);
const projectRef = 'vwemvnbemkkqxkanpthy';

// Try connection strings in order (session pooler first — works over IPv4)
const candidates = [
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-east-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-us-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-west-3.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-central-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-eu-north-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ap-south-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-ca-central-1.pooler.supabase.com:5432/postgres`,
  `postgresql://postgres.${projectRef}:${encoded}@aws-0-sa-east-1.pooler.supabase.com:5432/postgres`,
];

async function tryConn(url) {
  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    console.log('Connected to:', url.split('@')[1]);
    return client;
  } catch (e) {
    try { await client.end(); } catch {}
    console.log('Failed:', url.split('@')[1].split('/')[0], '->', e.message);
    return null;
  }
}

(async () => {
  let client = null;
  for (const url of candidates) {
    client = await tryConn(url);
    if (client) break;
  }
  if (!client) { console.error('ALL CONNECTIONS FAILED'); process.exit(1); }

  const sql = fs.readFileSync('/app/supabase/migration.sql', 'utf8');
  try {
    await client.query(sql);
    console.log('Migration applied successfully.');
    const r = await client.query("select count(*) from public.brands");
    console.log('Brands count:', r.rows[0].count);
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(2);
  } finally {
    await client.end();
  }
})();
