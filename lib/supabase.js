// Thin Supabase (PostgREST) client using the service_role key (server-side only).
// Activated when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are present in env.
const URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

export const enabled = Boolean(URL && KEY);

function headers(extra = {}) {
  return {
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function handle(res) {
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Supabase ${res.status}: ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// SELECT with raw PostgREST query string, e.g. select('tickets', 'select=*&order=created_at.desc')
export async function select(table, query = 'select=*') {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, { headers: headers() });
  return handle(res);
}

export async function insert(table, rows) {
  const res = await fetch(`${URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(rows),
  });
  const data = await handle(res);
  return Array.isArray(rows) ? data : data?.[0];
}

export async function update(table, query, patch) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: 'PATCH',
    headers: headers({ Prefer: 'return=representation' }),
    body: JSON.stringify(patch),
  });
  const data = await handle(res);
  return data?.[0];
}

export async function remove(table, query) {
  const res = await fetch(`${URL}/rest/v1/${table}?${query}`, {
    method: 'DELETE',
    headers: headers({ Prefer: 'return=representation' }),
  });
  return handle(res);
}

// Atomic counter via the next_seq() SQL function
export async function nextSeq(key) {
  const res = await fetch(`${URL}/rest/v1/rpc/next_seq`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ p_key: key }),
  });
  return handle(res); // returns a bigint (number)
}

// PostgREST encodes Thai/strings fine; helper to eq-filter
export const eq = (col, val) => `${col}=eq.${encodeURIComponent(val)}`;
