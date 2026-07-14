const STATUS_COLORS = {
  'แจ้งซ่อม': '#fbbf24',
  'ดำเนินการ': '#60a5fa',
  'ส่งซ่อม / รออะไหล่': '#a78bfa',
  'สำเร็จ': '#34d399',
  'ปิดงาน': '#16a34a',
  'ยกเลิก': '#f87171',
};
const PRI_COLORS = { 'ปกติ': '#34d399', 'เร่งด่วน': '#fbbf24', 'วิกฤต (หยุดการผลิต)': '#f87171' };
// แผนกผู้แจ้ง (ต้องตรงกับ dropdown ในฟอร์มแจ้งซ่อม index.html)
const REQ_DEPTS = ['Printing', 'ฝ่ายผลิต เป่า', 'ฝ่ายผลิต กรอ', 'ทรัพยากรบุคคล', 'QC', 'R&D', 'Safety', 'การตลาด', 'ขนส่ง', 'ขาย', 'คลังสินค้า', 'จัดซื้อ', 'ซ่อมบำรุง', 'บัญชี', 'วางแผน'];

// อนุญาตเปลี่ยนสถานะแบบเดินหน้าเท่านั้น (forward-only workflow)
const TRANSITIONS = {
  'แจ้งซ่อม': ['ดำเนินการ', 'ส่งซ่อม / รออะไหล่', 'สำเร็จ', 'ยกเลิก'],
  'ดำเนินการ': ['ส่งซ่อม / รออะไหล่', 'สำเร็จ', 'ยกเลิก'],
  'ส่งซ่อม / รออะไหล่': ['สำเร็จ', 'ยกเลิก'],
  'สำเร็จ': ['ปิดงาน'],
  'ปิดงาน': [],
  'ยกเลิก': [],
};

// Chart.js dark-theme defaults
if (window.Chart) {
  Chart.defaults.color = '#9aa0b4';
  Chart.defaults.borderColor = 'rgba(255,255,255,.06)';
  Chart.defaults.font.family = 'Sarabun';
}

let META = { statuses: [], priorities: [], pmTypes: [], roles: {}, equipment: [], channels: {} };
let ME = null;
let TOKEN = localStorage.getItem('mtd_token') || '';
let statusChart, typeChart;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s = '') => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const canEdit = () => ME && (ME.role === 'admin' || ME.role === 'technician');

const BLD_PREFIX = 'BLD::';
// build the asset <select> options: buildings first, then machines grouped by type
function fillEquipSelect(sel) {
  const buildings = [...new Set(META.equipment.map((e) => e.building).filter(Boolean))].sort();
  let opts = buildings.length
    ? `<optgroup label="🏢 อาคาร / สถานที่">${buildings.map((b) =>
        `<option value="${BLD_PREFIX}${esc(b)}">🏢 ${esc(b)}</option>`).join('')}</optgroup>`
    : '';
  const groups = {};
  META.equipment.forEach((e) => { (groups[e.type] ||= []).push(e); });
  opts += Object.entries(groups).map(([t, items]) =>
    `<optgroup label="${esc(t)}">${items.map((e) => `<option value="${e.id}">${e.id} — ${esc(e.name)}</option>`).join('')}</optgroup>`).join('');
  opts += '<option value="OTHER">❓ อื่นๆ (ไม่มีในรายการ)</option>';
  sel.innerHTML = '<option value="">— เลือกเครื่องจักร / อาคาร —</option>' + opts;
}

async function api(url, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (opts.body) headers['Content-Type'] = 'application/json';
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  const res = await fetch(url, { ...opts, headers });
  if (res.status === 401) { doLogout(); throw new Error('unauthorized'); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'error'); }
  return res.status === 204 ? null : res.json();
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3400);
}

// ---------- AUTH ----------
$('#loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) { $('#loginErr').textContent = data.error || 'เข้าสู่ระบบไม่สำเร็จ'; return; }
    TOKEN = data.token; localStorage.setItem('mtd_token', TOKEN);
    ME = data.user; e.target.reset();
    enterApp();
  } catch { $('#loginErr').textContent = 'เชื่อมต่อไม่ได้'; }
});

function doLogout() {
  TOKEN = ''; ME = null; localStorage.removeItem('mtd_token');
  $('#appShell').hidden = true;
  $('#loginScreen').style.display = 'flex';
}
$('#btnLogout').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch {}
  doLogout();
});

async function enterApp() {
  $('#loginScreen').style.display = 'none';
  $('#appShell').hidden = false;
  $('#uName').textContent = ME.name;
  $('#uRole').textContent = ME.roleLabel;
  $('#uAvatar').textContent = (ME.name || 'U').slice(0, 1).toUpperCase();
  const hr = new Date().getHours();
  const greet = hr < 12 ? 'อรุณสวัสดิ์' : hr < 17 ? 'สวัสดีตอนบ่าย' : 'สวัสดีตอนเย็น';
  $('#greetTitle').textContent = `${greet}, ${ME.name} 👋`;
  document.body.classList.toggle('is-admin', ME.role === 'admin');
  document.body.classList.toggle('is-staff', ME.role === 'admin' || ME.role === 'technician');
  const reporter = ME.role === 'reporter';
  $('#listTabLabel').textContent = reporter ? 'งานของฉัน' : 'งานซ่อม';
  $('#greetSub').textContent = reporter ? 'ติดตามสถานะงานซ่อมที่คุณแจ้งไว้' : 'ภาพรวมระบบแจ้งซ่อมและบำรุงรักษา';
  $('#search').placeholder = reporter ? '🔎 ค้นหางานที่ฉันแจ้ง' : '🔎 ค้นหา เลขที่ / ผู้แจ้ง / เครื่องจักร / อาการ';
  await init();
}

// ---------- navigation ----------
$$('.tab').forEach((b) => b.addEventListener('click', () => {
  $$('.tab').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  $$('.view').forEach((v) => v.classList.remove('active'));
  $('#view-' + b.dataset.view).classList.add('active');
  if (b.dataset.view === 'dashboard') loadDashboard();
  if (b.dataset.view === 'list') loadTickets();
  if (b.dataset.view === 'summary') { loadSummary(); loadKB(); }
  if (b.dataset.view === 'buildings') loadBuildings();
  if (b.dataset.view === 'overview') loadOverview();
  if (b.dataset.view === 'pm') loadPM();
  if (b.dataset.view === 'users') loadUsers();
}));

// ---------- init ----------
async function init() {
  META = await fetch('/api/meta').then((r) => r.json());
  $('#selPriority').innerHTML = META.priorities.map((p) => `<option>${p}</option>`).join('');
  fillEquipSelect($('#selEquipment'));
  fillEquipSelect($('#pmEquipment'));
  $('#pmType').innerHTML = META.pmTypes.map((t) => `<option>${t}</option>`).join('');
  $('#userRole').innerHTML = Object.entries(META.roles).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  $('#filterStatus').insertAdjacentHTML('beforeend', META.statuses.map((s) => `<option>${s}</option>`).join(''));
  // building filters (distinct, sorted)
  const buildings = [...new Set(META.equipment.map((e) => e.building).filter(Boolean))].sort();
  const bOpts = buildings.map((b) => `<option value="${esc(b)}">${esc(b)}</option>`).join('');
  $('#buildingOv').insertAdjacentHTML('beforeend', bOpts);
  // add-equipment form: building/type/dept option lists
  $('#equipBuilding').insertAdjacentHTML('beforeend', bOpts);
  $('#equipTypes').innerHTML = [...new Set(META.equipment.map((e) => e.type).filter(Boolean))].sort().map((t) => `<option value="${esc(t)}"></option>`).join('');
  $('#equipDepts').innerHTML = [...new Set(META.equipment.map((e) => e.dept).filter(Boolean))].sort().map((d) => `<option value="${esc(d)}"></option>`).join('');
  $('#btnNewEquip').style.display = canEdit() ? '' : 'none';
  // hide "+ แจ้งซ่อม" for nobody (all can report); hide PM "+" for reporters
  $('#btnNewPm').style.display = canEdit() ? '' : 'none';
  loadDashboard();
  renderEquipment();
}

// ---------- dashboard date filter ----------
let DASH_RANGE = { type: 'all', from: null, to: null };
const fmtD = (d) => d.toISOString().slice(0, 10);
function computeRange(type) {
  const now = new Date(); const today = fmtD(now);
  if (type === 'today') return { from: today, to: today };
  if (type === '7d') { const f = new Date(now); f.setDate(f.getDate() - 6); return { from: fmtD(f), to: today }; }
  if (type === 'month') return { from: today.slice(0, 8) + '01', to: today };
  return { from: null, to: null }; // all
}
const rangeLabel = () => {
  if (DASH_RANGE.type === 'all') return 'แสดงข้อมูลทั้งหมด';
  if (!DASH_RANGE.from && !DASH_RANGE.to) return '';
  return `ช่วง ${DASH_RANGE.from || '...'} ถึง ${DASH_RANGE.to || '...'}`;
};
$$('.df-chip').forEach((b) => b.addEventListener('click', () => {
  $$('.df-chip').forEach((x) => x.classList.remove('active'));
  b.classList.add('active');
  const type = b.dataset.range;
  $('#dfCustom').hidden = type !== 'custom';
  if (type === 'custom') {
    const r = DASH_RANGE.from ? DASH_RANGE : computeRange('month');
    $('#dfFrom').value = r.from || ''; $('#dfTo').value = r.to || '';
    return; // wait for ดูข้อมูล
  }
  DASH_RANGE = { type, ...computeRange(type) };
  loadDashboard();
}));
$('#dfApply').addEventListener('click', () => {
  const from = $('#dfFrom').value, to = $('#dfTo').value;
  if (from && to && from > to) return toast('⚠️ วันที่เริ่มต้องไม่เกินวันสิ้นสุด');
  DASH_RANGE = { type: 'custom', from: from || null, to: to || null };
  loadDashboard();
});

// ---------- dashboard ----------
async function loadDashboard() {
  const params = new URLSearchParams();
  if (DASH_RANGE.from) params.set('from', DASH_RANGE.from);
  if (DASH_RANGE.to) params.set('to', DASH_RANGE.to);
  const s = await api('/api/stats?' + params);
  $('#dfLabel').textContent = rangeLabel();
  const order = META.statuses;
  $('#statGrid').innerHTML = order.map((st) =>
    `<div class="stat" style="--c:${STATUS_COLORS[st]}" data-st="${esc(st)}">
       <div class="num">${s.counts[st] || 0}</div><div class="lbl">${st}</div></div>`
  ).join('') + `<div class="stat" style="--c:#475569"><div class="num">${s.total}</div><div class="lbl">ทั้งหมด</div></div>`;
  $$('#statGrid .stat[data-st]').forEach((el) => el.addEventListener('click', () => {
    $('.tab[data-view="list"]').click();
    $('#filterStatus').value = el.dataset.st; loadTickets();
  }));

  // PM due alert
  const due = s.pmDue || [];
  const alert = $('#pmAlert');
  if (due.length) {
    const overdue = due.filter((d) => d.overdue).length;
    alert.hidden = false;
    alert.innerHTML = `🛠️ <b>มีงาน PM ที่ใกล้ครบกำหนด/เกินกำหนด ${due.length} รายการ</b>` +
      (overdue ? ` <span class="ov">(เกินกำหนดแล้ว ${overdue})</span>` : '') +
      ' — ' + due.slice(0, 4).map((d) => `${esc(d.equipmentId)} (${d.nextDue})`).join(', ');
    alert.style.cursor = 'pointer';
    alert.onclick = () => $('.tab[data-view="pm"]').click();
  } else alert.hidden = true;

  drawStatusChart(order, s.counts);
  drawTypeChart(s.byType);

  // full summary block (respects the same date filter)
  const showSum = ME?.role !== 'reporter';
  $('#dashSummary').style.display = showSum ? '' : 'none';
  if (showSum) await loadDashSummary(params);

  let recent = await api('/api/tickets');
  if (DASH_RANGE.from) recent = recent.filter((t) => (t.createdAt || '').slice(0, 10) >= DASH_RANGE.from);
  if (DASH_RANGE.to) recent = recent.filter((t) => (t.createdAt || '').slice(0, 10) <= DASH_RANGE.to);
  $('#recentList').innerHTML = recent.slice(0, 6).map(ticketRow).join('') ||
    '<p style="color:var(--muted)">ไม่มีรายการในช่วงเวลานี้</p>';
  bindTicketRows('#recentList');
}

// dashboard summary block (same data as the สรุปปัญหา page, filtered by date)
let dProblemChart, dPriorityChart, dDeptChart;
async function loadDashSummary(params) {
  const s = await api('/api/summary?' + params);
  $('#dashSumKpi').innerHTML = [
    ['ทั้งหมด', s.total, '#475569'], ['กำลังดำเนินการ', s.open, '#fbbf24'],
    ['ปิดงานแล้ว', s.closed, '#34d399'], ['เวลาซ่อมเฉลี่ย (ชม.)', s.avgResolveHours, '#8b5cf6'],
  ].map(([l, n, c]) => `<div class="stat" style="--c:${c}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
  const mkBar = (canvas, obj, color, horizontal) => {
    const labels = Object.keys(obj), data = labels.map((k) => obj[k]);
    return new Chart($(canvas), { type: 'bar', data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6 }] },
      options: { indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } }, scales: { x: { ticks: { precision: 0 } }, y: { ticks: { precision: 0, font: { family: 'Sarabun' } } } } } });
  };
  if (dProblemChart) dProblemChart.destroy();
  if (dPriorityChart) dPriorityChart.destroy();
  if (dDeptChart) dDeptChart.destroy();
  dProblemChart = mkBar('#dashProblemChart', s.byProblemType, '#6366f1', true);
  const pl = Object.keys(s.byPriority);
  dPriorityChart = new Chart($('#dashPriorityChart'), { type: 'doughnut',
    data: { labels: pl, datasets: [{ data: pl.map((k) => s.byPriority[k]), backgroundColor: pl.map((k) => PRI_COLORS[k] || '#94a3b8') }] },
    options: { plugins: { legend: { position: 'right', labels: { font: { family: 'Sarabun' } } } }, cutout: '60%' } });
  dDeptChart = mkBar('#dashDeptChart', s.byDept, '#2dd4bf', false);
  const max = s.topEquipment[0]?.count || 1;
  $('#dashTopEquip').innerHTML = s.topEquipment.map((e, i) =>
    `<div class="te-row" data-id="${esc(e.equipmentId)}"><span class="te-rank">${i + 1}</span>
      <div class="te-info"><b>${esc(e.equipmentId)}</b> <span class="te-name">${esc(e.equipmentName || '')}</span>
        <div class="te-bar"><span style="width:${(e.count / max * 100).toFixed(0)}%"></span></div></div>
      <span class="te-count">${e.count} ครั้ง${e.open ? ` · ค้าง ${e.open}` : ''}</span></div>`).join('')
    || '<p style="color:var(--muted)">ไม่มีข้อมูลในช่วงนี้</p>';
  $$('#dashTopEquip .te-row').forEach((el) => el.addEventListener('click', () => openEquip(el.dataset.id)));
}

function drawStatusChart(labels, counts) {
  const data = labels.map((l) => counts[l] || 0);
  if (statusChart) statusChart.destroy();
  statusChart = new Chart($('#statusChart'), {
    type: 'doughnut',
    data: { labels, datasets: [{ data, backgroundColor: labels.map((l) => STATUS_COLORS[l]) }] },
    options: { plugins: { legend: { position: 'right', labels: { font: { family: 'Sarabun' } } } }, cutout: '62%' },
  });
}
function drawTypeChart(byType) {
  const labels = Object.keys(byType);
  if (typeChart) typeChart.destroy();
  if (!labels.length) { $('#typeChart').getContext('2d').clearRect(0, 0, 9999, 9999); typeChart = null; return; }
  typeChart = new Chart($('#typeChart'), {
    type: 'bar',
    data: { labels, datasets: [{ data: labels.map((l) => byType[l]), backgroundColor: '#7c3aed', borderRadius: 6 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } },
  });
}

// ---------- ticket list ----------
function ticketRow(t) {
  return `<div class="ticket" style="--sc:${STATUS_COLORS[t.status]}" data-id="${t.id}">
    <div><div class="no">${esc(t.no)}</div><div class="meta">${new Date(t.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</div></div>
    <div>
      <div class="det"><b>${esc(t.equipmentId)}</b> ${esc(t.equipmentName)}</div>
      <div class="meta">ผู้แจ้ง: ${esc(t.reporter || '-')} · ${esc(t.detail || '').slice(0, 60)}</div>
      <span class="pri" style="color:${PRI_COLORS[t.priority]}">● ${esc(t.priority)}</span>
    </div>
    <div class="ticket-end">
      <span class="badge" style="background:${STATUS_COLORS[t.status]}">${esc(t.status)}</span>
      ${ME?.role === 'admin' ? `<button class="row-del" data-del="${t.id}" title="ลบใบแจ้งซ่อม">🗑️</button>` : ''}
    </div>
  </div>`;
}
async function loadTickets() {
  const q = $('#search').value.trim();
  const status = $('#filterStatus').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (status) params.set('status', status);
  const rows = await api('/api/tickets?' + params);
  $('#ticketList').innerHTML = rows.map(ticketRow).join('') || '<p style="color:var(--muted)">ไม่พบรายการ</p>';
  bindTicketRows('#ticketList');
}
function bindTicketRows(sel) {
  $$(sel + ' .ticket').forEach((el) => el.addEventListener('click', () => openDetail(el.dataset.id)));
  $$(sel + ' .row-del').forEach((b) => b.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm('ลบใบแจ้งซ่อมนี้?\nการลบเป็นการถาวร กู้คืนไม่ได้')) return;
    try {
      await api('/api/tickets/' + b.dataset.del, { method: 'DELETE' });
      toast('🗑️ ลบใบแจ้งซ่อมแล้ว');
      loadDashboard(); if ($('#view-list').classList.contains('active')) loadTickets();
    } catch (err) { toast('⚠️ ' + err.message); }
  }));
}
$('#search').addEventListener('input', debounce(loadTickets, 300));
$('#filterStatus').addEventListener('change', loadTickets);
// global header search -> jump to list view, filter
$('#headSearch').addEventListener('input', debounce((e) => {
  $('.tab[data-view="list"]').click();
  $('#search').value = e.target.value;
  loadTickets();
}, 350));
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

// ---------- equipment ----------
function renderEquipment() {
  const draw = (list) => {
    $('#equipmentGrid').innerHTML = list.map((e) =>
      `<div class="eq-card" data-id="${esc(e.id)}"><div class="id">${esc(e.id)}</div>
        <div class="nm">${esc(e.name)}</div>
        <div class="sm">S/N: ${esc(e.sn)} · ${esc(e.dept)}</div>
        <div class="sm">📍 ${esc(e.location)}</div>
        <div class="eq-chips"><span class="chip">${esc(e.type)}</span></div>
        <span class="eq-more">ดูประวัติ ›</span></div>`).join('') || '<p style="color:var(--muted)">ไม่พบเครื่องจักร</p>';
    $$('#equipmentGrid .eq-card').forEach((el) => el.addEventListener('click', () => openEquip(el.dataset.id)));
  };
  const apply = () => {
    const q = $('#searchEq').value.toLowerCase();
    draw(META.equipment.filter((x) => [x.id, x.name, x.type, x.dept, x.building].join(' ').toLowerCase().includes(q)));
  };
  draw(META.equipment);
  $('#searchEq').oninput = apply;
}

// ---------- add equipment ----------
$('#btnNewEquip').addEventListener('click', () => $('#modalEquipNew').classList.add('open'));
$('#formEquip').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const eq = await api('/api/equipment', { method: 'POST', body: JSON.stringify(body) });
    META.equipment.push(eq);
    e.target.reset(); $('#modalEquipNew').classList.remove('open');
    toast(`✅ เพิ่มเครื่องจักรแล้ว: ${eq.id}`);
    renderEquipment();
    fillEquipSelect($('#selEquipment')); fillEquipSelect($('#pmEquipment'));
  } catch (err) { toast('⚠️ ' + err.message); }
});

// ---------- equipment history modal ----------
async function openEquip(id) {
  const d = await api('/api/equipment/' + encodeURIComponent(id) + '/history');
  const e = d.equipment, s = d.summary;
  $('#eqTitle').textContent = `${e.id} · ${e.name || ''}`;
  const kpi = (n, l, c) => `<div class="eq-kpi" style="--c:${c}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const tline = d.tickets.map((t) => `<div class="ticket" style="--sc:${STATUS_COLORS[t.status] || '#94a3b8'};cursor:pointer" data-tid="${t.id}">
      <div><div class="no">${esc(t.no)}</div><div class="meta">${new Date(t.createdAt).toLocaleDateString('th-TH')}</div></div>
      <div><div class="det">${esc(t.problemType || 'ไม่ระบุ')} · <span style="color:${PRI_COLORS[t.priority]}">${esc(t.priority)}</span></div>
        <div class="meta">${esc(t.detail || '')}</div>${t.solution ? `<div class="meta">🛠️ ${esc(t.solution)}</div>` : ''}</div>
      <span class="badge" style="background:${STATUS_COLORS[t.status] || '#94a3b8'}">${esc(t.status)}</span></div>`).join('') || '<p style="color:var(--muted)">ยังไม่มีประวัติการซ่อม</p>';
  const pline = d.pm.map((p) => `<div class="ticket" style="--sc:#0d9488">
      <div><div class="no">${esc(p.no)}</div><div class="meta">${esc(p.date)}</div></div>
      <div><div class="det">${esc(p.type)} · ผล: ${esc(p.result)}</div><div class="meta">โดย ${esc(p.performedBy || '-')}${p.detail ? ' · ' + esc(p.detail) : ''}</div>
        ${p.nextDue ? `<span class="pri" style="color:#0d9488">⏰ ครั้งถัดไป: ${esc(p.nextDue)}</span>` : ''}</div><span></span></div>`).join('') || '<p style="color:var(--muted)">ยังไม่มีประวัติ PM</p>';
  $('#eqBody').innerHTML = `
    <div style="text-align:right;margin-bottom:12px"><button class="btn-primary" id="eqExportBtn">📄 Export PDF</button></div>
    <div class="d-section">
      <div class="d-row"><span class="k">ประเภท</span><span>${esc(e.type || '-')}</span></div>
      <div class="d-row"><span class="k">แผนก / สถานที่</span><span>${esc(e.dept || '-')} · ${esc(e.location || '-')}</span></div>
      <div class="d-row"><span class="k">S/N</span><span>${esc(e.sn || '-')}</span></div>
    </div>
    <div class="eq-kpis">
      ${kpi(s.repairs, 'ครั้งที่ซ่อม', '#4f46e5')}
      ${kpi(s.openRepairs, 'กำลังค้าง', '#f59e0b')}
      ${kpi(s.pmCount, 'ครั้งที่ PM', '#0d9488')}
      ${kpi(s.nextDue || '—', 'PM ครั้งถัดไป', '#7c3aed')}
    </div>
    <div class="d-section"><h3 style="font-size:14px;margin-bottom:8px">🔧 ประวัติการแจ้งซ่อม (${d.tickets.length})</h3><div class="ticket-list">${tline}</div></div>
    <div class="d-section"><h3 style="font-size:14px;margin-bottom:8px">🛠️ ประวัติการบำรุงรักษา PM (${d.pm.length})</h3><div class="ticket-list">${pline}</div></div>`;
  $('#modalEquip').classList.add('open');
  $('#eqExportBtn').addEventListener('click', () => exportEquipPDF(d));
  $$('#eqBody .ticket[data-tid]').forEach((el) => el.addEventListener('click', () => { $('#modalEquip').classList.remove('open'); openDetail(el.dataset.tid); }));
}

// สร้างรายงานประวัติเครื่องจักรเป็น PDF (ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์)
function exportEquipPDF(d) {
  const e = d.equipment, s = d.summary;
  const td = (v) => `<td>${esc(v ?? '-')}</td>`;
  const ticketRows = d.tickets.map((t) => `<tr>
      ${td(t.no)}${td(new Date(t.createdAt).toLocaleDateString('th-TH'))}${td(t.problemType)}${td(t.priority)}
      ${td(t.detail)}${td(t.solution)}${td(t.assignee)}${td(t.status)}</tr>`).join('') || '<tr><td colspan="8" style="text-align:center">ไม่มีประวัติ</td></tr>';
  const pmRows = d.pm.map((p) => `<tr>${td(p.no)}${td(p.date)}${td(p.type)}${td(p.result)}${td(p.performedBy)}${td(p.nextDue)}</tr>`).join('')
    || '<tr><td colspan="6" style="text-align:center">ไม่มีประวัติ PM</td></tr>';
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>ประวัติเครื่องจักร ${esc(e.id)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      *{font-family:'Sarabun',sans-serif}body{color:#1a1a1a;padding:28px;margin:0}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #6d28d9;padding-bottom:10px;margin-bottom:14px}
      .hd h1{font-size:20px;margin:0;color:#6d28d9}.hd .sub{color:#666;font-size:12px}
      .hd .org{text-align:right;font-size:12px;color:#444}
      .info{display:grid;grid-template-columns:1fr 1fr;gap:2px 24px;font-size:13px;margin-bottom:14px}
      .info b{color:#555}
      .kpis{display:flex;gap:10px;margin:10px 0 18px}
      .kpi{flex:1;border:1px solid #ddd;border-top:3px solid #6d28d9;border-radius:8px;padding:8px;text-align:center}
      .kpi .n{font-size:20px;font-weight:700;color:#6d28d9}.kpi .l{font-size:11px;color:#666}
      h2{font-size:14px;margin:18px 0 6px;color:#333}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}
      th{background:#f3effe;color:#4c1d95}
      .foot{margin-top:24px;font-size:11px;color:#888;text-align:right}
      @media print{body{padding:0}}
    </style></head><body>
    <div class="hd">
      <div><h1>🔧 รายงานประวัติเครื่องจักร</h1><div class="sub">ระบบแจ้งซ่อม MTD — Maintenance Request System</div></div>
      <div class="org">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
    </div>
    <div class="info">
      <div><b>รหัสเครื่องจักร:</b> ${esc(e.id)}</div><div><b>ชื่อ:</b> ${esc(e.name || '-')}</div>
      <div><b>ประเภท:</b> ${esc(e.type || '-')}</div><div><b>แผนก:</b> ${esc(e.dept || '-')}</div>
      <div><b>สถานที่:</b> ${esc(e.location || '-')}</div><div><b>S/N:</b> ${esc(e.sn || '-')}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="n">${s.repairs}</div><div class="l">ครั้งที่ซ่อม</div></div>
      <div class="kpi"><div class="n">${s.openRepairs}</div><div class="l">กำลังค้าง</div></div>
      <div class="kpi"><div class="n">${s.pmCount}</div><div class="l">ครั้งที่ PM</div></div>
      <div class="kpi"><div class="n">${esc(s.nextDue || '—')}</div><div class="l">PM ครั้งถัดไป</div></div>
    </div>
    <h2>🔧 ประวัติการแจ้งซ่อม (${d.tickets.length})</h2>
    <table><thead><tr><th>เลขที่</th><th>วันที่</th><th>หมวด</th><th>เร่งด่วน</th><th>อาการ</th><th>วิธีแก้ไข</th><th>ผู้ดำเนินการ</th><th>สถานะ</th></tr></thead><tbody>${ticketRows}</tbody></table>
    <h2>🛠️ ประวัติการบำรุงรักษา PM (${d.pm.length})</h2>
    <table><thead><tr><th>เลขที่</th><th>วันที่</th><th>ประเภท</th><th>ผล</th><th>ผู้ดำเนินการ</th><th>PM ครั้งถัดไป</th></tr></thead><tbody>${pmRows}</tbody></table>
    <div class="foot">ออกโดยระบบแจ้งซ่อม MTD</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('⚠️ เบราว์เซอร์บล็อกป๊อปอัพ — อนุญาตป๊อปอัพแล้วลองใหม่');
  w.document.write(html); w.document.close();
}

// ---------- knowledge base: ปัญหา & สาเหตุ ----------
const KB_CAT_COLORS = { 'ไฟฟ้า': '#fbbf24', 'เครื่องกล': '#60a5fa', 'ระบบลม': '#34d399', 'ระบบทำความเย็น': '#2dd4bf', 'หน้าจอควบคุม': '#a78bfa', 'งานอาคาร': '#f472b6' };
let KB_CACHE = [];
async function loadKB() {
  $('#btnNewKb').style.display = canEdit() ? '' : 'none';
  KB_CACHE = await api('/api/kb');
  // category filter + datalist
  const cats = [...new Set(KB_CACHE.map((k) => k.category).filter(Boolean))].sort();
  const cur = $('#filterKbCat').value;
  $('#filterKbCat').innerHTML = '<option value="">ทุกหมวด</option>' + cats.map((c) => `<option${c === cur ? ' selected' : ''}>${esc(c)}</option>`).join('');
  $('#kbCats').innerHTML = cats.map((c) => `<option value="${esc(c)}"></option>`).join('');
  renderKB();
}
let KB_SORT = { key: 'category', dir: 1 };
function renderKB() {
  const q = $('#searchKb').value.trim().toLowerCase();
  const cat = $('#filterKbCat').value;
  let rows = KB_CACHE.filter((k) => (!cat || k.category === cat) &&
    (!q || [k.category, k.problem, k.cause, k.solution].filter(Boolean).some((v) => v.toLowerCase().includes(q))));
  rows.sort((a, b) => ((a[KB_SORT.key] || '').localeCompare(b[KB_SORT.key] || '', 'th') * KB_SORT.dir) ||
    (a.problem || '').localeCompare(b.problem || '', 'th'));
  const arrow = (k) => (KB_SORT.key === k ? (KB_SORT.dir > 0 ? ' ▲' : ' ▼') : '');
  const th = (k, label) => `<th data-sort="${k}" class="kb-sortable">${label}${arrow(k)}</th>`;
  const body = rows.map((k) => `<tr>
      <td><span class="kb-cat" style="background:${KB_CAT_COLORS[k.category] || '#8b5cf6'}">${esc(k.category)}</span></td>
      <td class="kb-prob-cell">⚠️ ${esc(k.problem)}</td>
      <td>${esc(k.cause || '-')}</td>
      <td>${esc(k.solution || '-')}</td>
      ${canEdit() ? `<td class="num"><button class="kb-del" data-id="${k.id}" title="ลบ">🗑️</button></td>` : ''}
    </tr>`).join('') || `<tr><td colspan="${canEdit() ? 5 : 4}" style="text-align:center;color:var(--muted);padding:20px">ไม่พบรายการ</td></tr>`;
  $('#kbList').innerHTML = `<div class="ov-table-wrap"><table class="ov-table kb-table"><thead><tr>
      ${th('category', 'หมวด')}${th('problem', 'อาการ / ปัญหา')}<th>สาเหตุ</th><th>วิธีแก้ไข</th>${canEdit() ? '<th class="num">ลบ</th>' : ''}
    </tr></thead><tbody>${body}</tbody></table></div>`;
  $$('#kbList th[data-sort]').forEach((el) => el.addEventListener('click', () => {
    const k = el.dataset.sort;
    if (KB_SORT.key === k) KB_SORT.dir *= -1; else { KB_SORT.key = k; KB_SORT.dir = 1; }
    renderKB();
  }));
  $$('#kbList .kb-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('ลบรายการนี้?')) return;
    try { await api('/api/kb/' + b.dataset.id, { method: 'DELETE' }); toast('ลบแล้ว'); loadKB(); }
    catch (e) { toast('⚠️ ' + e.message); }
  }));
}
$('#searchKb').addEventListener('input', debounce(renderKB, 200));
$('#filterKbCat').addEventListener('change', renderKB);
$('#btnNewKb').addEventListener('click', () => $('#modalKb').classList.add('open'));
$('#formKb').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/kb', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset(); $('#modalKb').classList.remove('open');
    toast('✅ เพิ่มปัญหา & สาเหตุแล้ว'); loadKB();
  } catch (err) { toast('⚠️ ' + err.message); }
});

// ---------- buildings ----------
async function loadBuildings() {
  $('#btnNewBuilding').style.display = ME?.role === 'admin' ? '' : 'none';
  const rows = await api('/api/building-overview');
  $('#buildingGrid').innerHTML = rows.map((b) => {
    return `<div class="bld-card" data-name="${esc(b.name)}">
      <div class="bld-head"><div class="bld-icon">🏢</div>
        <div><div class="bld-name">${esc(b.name)}</div><div class="bld-note">${esc(b.note || '')}</div></div>
        ${ME?.role === 'admin' ? `<button class="bld-del" data-name="${esc(b.name)}" title="ลบอาคาร">🗑️</button>` : ''}
      </div>
      <div class="bld-stats">
        <div class="bs"><div class="bs-n">${b.repairs}</div><div class="bs-l">ครั้งที่ซ่อม</div></div>
        <div class="bs"><div class="bs-n" style="color:${b.open ? '#f59e0b' : 'inherit'}">${b.open}</div><div class="bs-l">งานค้าง</div></div>
        <div class="bs"><div class="bs-n" style="color:${b.pmOverdue ? '#dc2626' : 'inherit'}">${b.pmOverdue}</div><div class="bs-l">PM เกิน</div></div>
      </div>
      <div class="bld-more">ดูประวัติการซ่อม ›</div>
    </div>`;
  }).join('') || '<p style="color:var(--muted)">ยังไม่มีอาคาร</p>';
  $$('#buildingGrid .bld-card').forEach((el) => el.addEventListener('click', (ev) => {
    if (ev.target.closest('.bld-del')) return;
    openBuildingMachines(el.dataset.name);
  }));
  $$('#buildingGrid .bld-del').forEach((el) => el.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    if (!confirm(`ลบ "${el.dataset.name}" ?`)) return;
    try { await api('/api/buildings/' + encodeURIComponent(el.dataset.name), { method: 'DELETE' }); toast('ลบอาคารแล้ว'); loadBuildings(); }
    catch (e) { toast('⚠️ ' + e.message); }
  }));
}

async function openBuildingMachines(name) {
  const d = await api('/api/building/' + encodeURIComponent(name) + '/history');
  $('#bTitle').textContent = `🏢 ${name} · ประวัติการซ่อม`;
  const kpi = (n, l, c) => `<div class="eq-kpi" style="--c:${c}"><div class="n">${n}</div><div class="l">${l}</div></div>`;
  const tline = d.tickets.map((t) => `<div class="ticket" style="--sc:${STATUS_COLORS[t.status] || '#94a3b8'};cursor:pointer" data-tid="${t.id}">
      <div><div class="no">${esc(t.no)}</div><div class="meta">${new Date(t.createdAt).toLocaleDateString('th-TH')}</div></div>
      <div><div class="det"><b>${esc(t.equipmentName || t.equipmentId)}</b></div>
        <div class="meta">${esc(t.problemType || 'ไม่ระบุ')} · ${esc(t.detail || '')}</div>${t.solution ? `<div class="meta">🛠️ ${esc(t.solution)}</div>` : ''}</div>
      <span class="badge" style="background:${STATUS_COLORS[t.status] || '#94a3b8'}">${esc(t.status)}</span></div>`).join('')
    || '<p style="color:var(--muted)">ยังไม่มีประวัติการซ่อมในอาคารนี้</p>';
  const pline = d.pm.map((p) => `<div class="ticket" style="--sc:#2dd4bf">
      <div><div class="no">${esc(p.no)}</div><div class="meta">${esc(p.date)}</div></div>
      <div><div class="det">${esc(p.equipmentName || p.equipmentId)} · ${esc(p.type)}</div><div class="meta">ผล: ${esc(p.result)} · โดย ${esc(p.performedBy || '-')}</div></div><span></span></div>`).join('')
    || '<p style="color:var(--muted)">ยังไม่มีประวัติ PM</p>';
  $('#bBody').innerHTML = `
    <div style="text-align:right;margin-bottom:12px"><button class="btn-primary" id="bExportBtn">📄 Export PDF</button></div>
    <div class="eq-kpis">
      ${kpi(d.repairs, 'ครั้งที่ซ่อม', '#8b5cf6')}
      ${kpi(d.openRepairs, 'กำลังค้าง', '#fbbf24')}
      ${kpi(d.pmCount, 'ครั้งที่ PM', '#2dd4bf')}
    </div>
    <div class="d-section"><h3 style="font-size:14px;margin-bottom:8px">🔧 ประวัติการแจ้งซ่อม (${d.tickets.length})</h3><div class="ticket-list">${tline}</div></div>
    <div class="d-section"><h3 style="font-size:14px;margin-bottom:8px">🛠️ ประวัติการบำรุงรักษา PM (${d.pm.length})</h3><div class="ticket-list">${pline}</div></div>`;
  $('#modalBuilding').classList.add('open');
  $('#bExportBtn').addEventListener('click', () => exportBuildingPDF(name, d));
  $$('#bBody .ticket[data-tid]').forEach((el) => el.addEventListener('click', () => { $('#modalBuilding').classList.remove('open'); openDetail(el.dataset.tid); }));
}

// สร้างรายงานประวัติการซ่อมของอาคารเป็น PDF (ผ่านหน้าต่างพิมพ์ของเบราว์เซอร์)
function exportBuildingPDF(name, d) {
  const td = (v) => `<td>${esc(v ?? '-')}</td>`;
  const ticketRows = d.tickets.map((t) => `<tr>
      ${td(t.no)}${td(new Date(t.createdAt).toLocaleDateString('th-TH'))}${td(t.equipmentName || t.equipmentId)}${td(t.problemType)}
      ${td(t.priority)}${td(t.detail)}${td(t.solution)}${td(t.assignee)}${td(t.status)}</tr>`).join('')
    || '<tr><td colspan="9" style="text-align:center">ไม่มีประวัติ</td></tr>';
  const pmRows = d.pm.map((p) => `<tr>${td(p.no)}${td(p.date)}${td(p.equipmentName || p.equipmentId)}${td(p.type)}${td(p.result)}${td(p.performedBy)}</tr>`).join('')
    || '<tr><td colspan="6" style="text-align:center">ไม่มีประวัติ PM</td></tr>';
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8">
    <title>ประวัติการซ่อม ${esc(name)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>
      *{font-family:'Sarabun',sans-serif}body{color:#1a1a1a;padding:28px;margin:0}
      .hd{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #6d28d9;padding-bottom:10px;margin-bottom:14px}
      .hd h1{font-size:20px;margin:0;color:#6d28d9}.hd .sub{color:#666;font-size:12px}
      .hd .org{text-align:right;font-size:12px;color:#444}
      .kpis{display:flex;gap:10px;margin:10px 0 18px}
      .kpi{flex:1;border:1px solid #ddd;border-top:3px solid #6d28d9;border-radius:8px;padding:8px;text-align:center}
      .kpi .n{font-size:20px;font-weight:700;color:#6d28d9}.kpi .l{font-size:11px;color:#666}
      h2{font-size:14px;margin:18px 0 6px;color:#333}
      table{width:100%;border-collapse:collapse;font-size:11px}
      th,td{border:1px solid #ccc;padding:5px 6px;text-align:left;vertical-align:top}
      th{background:#f3effe;color:#4c1d95}
      .foot{margin-top:24px;font-size:11px;color:#888;text-align:right}
      @media print{body{padding:0}}
    </style></head><body>
    <div class="hd">
      <div><h1>🏢 รายงานประวัติการซ่อม · ${esc(name)}</h1><div class="sub">ระบบแจ้งซ่อม MTD — Maintenance Request System</div></div>
      <div class="org">พิมพ์เมื่อ ${new Date().toLocaleString('th-TH')}</div>
    </div>
    <div class="kpis">
      <div class="kpi"><div class="n">${d.repairs}</div><div class="l">ครั้งที่ซ่อม</div></div>
      <div class="kpi"><div class="n">${d.openRepairs}</div><div class="l">กำลังค้าง</div></div>
      <div class="kpi"><div class="n">${d.pmCount}</div><div class="l">ครั้งที่ PM</div></div>
    </div>
    <h2>🔧 ประวัติการแจ้งซ่อม (${d.tickets.length})</h2>
    <table><thead><tr><th>เลขที่</th><th>วันที่</th><th>เครื่องจักร</th><th>หมวด</th><th>เร่งด่วน</th><th>อาการ</th><th>วิธีแก้ไข</th><th>ผู้ดำเนินการ</th><th>สถานะ</th></tr></thead><tbody>${ticketRows}</tbody></table>
    <h2>🛠️ ประวัติการบำรุงรักษา PM (${d.pm.length})</h2>
    <table><thead><tr><th>เลขที่</th><th>วันที่</th><th>เครื่องจักร</th><th>ประเภท</th><th>ผล</th><th>ผู้ดำเนินการ</th></tr></thead><tbody>${pmRows}</tbody></table>
    <div class="foot">ออกโดยระบบแจ้งซ่อม MTD</div>
    <script>window.onload=function(){setTimeout(function(){window.print()},500)}<\/script>
    </body></html>`;
  const w = window.open('', '_blank');
  if (!w) return toast('⚠️ เบราว์เซอร์บล็อกป๊อปอัพ — อนุญาตป๊อปอัพแล้วลองใหม่');
  w.document.write(html); w.document.close();
}

$('#btnNewBuilding').addEventListener('click', () => $('#modalNewBuilding').classList.add('open'));
$('#formBuilding').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/buildings', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset(); $('#modalNewBuilding').classList.remove('open');
    toast('✅ เพิ่มอาคารแล้ว'); loadBuildings();
  } catch (err) { toast('⚠️ ' + err.message); }
});

// ---------- equipment overview dashboard ----------
let OV = [];
const HEALTH = {
  repair: { t: '🔧 ซ่อมค้าง', c: '#f59e0b' },
  pmdue: { t: '⏰ PM เกินกำหนด', c: '#dc2626' },
  ok: { t: '✅ ปกติ', c: '#16a34a' },
  new: { t: '⚪ ยังไม่เคยซ่อม', c: '#94a3b8' },
};
async function loadOverview() {
  const d = await api('/api/equipment-overview');
  OV = d.list;
  $('#ovKpi').innerHTML = [
    ['เครื่องทั้งหมด', d.kpi.machines, '#475569'], ['มีงานซ่อมค้าง', d.kpi.withOpen, '#f59e0b'],
    ['PM เกินกำหนด', d.kpi.pmOverdue, '#dc2626'], ['ยังไม่เคยซ่อม', d.kpi.neverRepaired, '#16a34a'],
  ].map(([l, n, c]) => `<div class="stat" style="--c:${c}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');
  renderOv();
}
function renderOv() {
  const q = $('#searchOv').value.trim().toLowerCase();
  const sort = $('#sortOv').value, filt = $('#filterOv').value, bld = $('#buildingOv').value;
  let rows = OV.filter((m) => (!filt || m.health === filt) && (!bld || m.building === bld));
  if (q) rows = rows.filter((m) => [m.id, m.name, m.type, m.dept, m.building].join(' ').toLowerCase().includes(q));
  rows = [...rows].sort((a, b) =>
    sort === 'id' ? a.id.localeCompare(b.id) :
    sort === 'open' ? b.open - a.open || b.repairs - a.repairs :
    sort === 'pmdue' ? (b.pmOverdue - a.pmOverdue) || (a.nextDue || '9999').localeCompare(b.nextDue || '9999') :
    b.repairs - a.repairs || b.open - a.open);
  $('#ovBody').innerHTML = rows.map((m) => {
    const h = HEALTH[m.health];
    return `<tr data-id="${esc(m.id)}">
      <td><b>${esc(m.id)}</b><div class="ov-name">${esc(m.name)}</div></td>
      <td><span class="chip">${esc(m.type)}</span></td>
      <td class="ov-dept">🏢 ${esc(m.building || '-')}</td>
      <td class="ov-dept">${esc(m.dept)}</td>
      <td class="num">${m.repairs}</td>
      <td class="num">${m.open ? `<span class="ov-open">${m.open}</span>` : '0'}</td>
      <td>${esc(m.lastRepair || '—')}</td>
      <td class="num">${m.pmCount}</td>
      <td class="${m.pmOverdue ? 'ov-overdue' : ''}">${esc(m.nextDue || '—')}${m.pmOverdue ? ' ⚠️' : ''}</td>
      <td><span class="ov-badge" style="background:${h.c}">${h.t}</span></td>
    </tr>`;
  }).join('') || '<tr><td colspan="10" style="text-align:center;color:var(--muted);padding:20px">ไม่พบเครื่องจักร</td></tr>';
  $$('#ovBody tr[data-id]').forEach((el) => el.addEventListener('click', () => openEquip(el.dataset.id)));
}
$('#searchOv').addEventListener('input', debounce(renderOv, 250));
$('#sortOv').addEventListener('change', renderOv);
$('#filterOv').addEventListener('change', renderOv);
$('#buildingOv').addEventListener('change', renderOv);

// ---------- problem summary ----------
let problemChart, priorityChart, deptChart;
async function loadSummary() {
  const s = await api('/api/summary');
  $('#summaryKpi').innerHTML = [
    ['ทั้งหมด', s.total, '#475569'], ['กำลังดำเนินการ', s.open, '#f59e0b'],
    ['ปิดงานแล้ว', s.closed, '#16a34a'], ['เวลาซ่อมเฉลี่ย (ชม.)', s.avgResolveHours, '#4f46e5'],
  ].map(([l, n, c]) => `<div class="stat" style="--c:${c}"><div class="num">${n}</div><div class="lbl">${l}</div></div>`).join('');

  const mkBar = (canvas, obj, color, horizontal) => {
    const labels = Object.keys(obj), data = labels.map((k) => obj[k]);
    return new Chart($(canvas), {
      type: 'bar',
      data: { labels, datasets: [{ data, backgroundColor: color, borderRadius: 6 }] },
      options: { indexAxis: horizontal ? 'y' : 'x', plugins: { legend: { display: false } },
        scales: { x: { ticks: { precision: 0 } }, y: { ticks: { precision: 0, font: { family: 'Sarabun' } } } } },
    });
  };
  if (problemChart) problemChart.destroy();
  if (priorityChart) priorityChart.destroy();
  if (deptChart) deptChart.destroy();
  problemChart = mkBar('#problemTypeChart', s.byProblemType, '#6366f1', true);
  const pl = Object.keys(s.byPriority);
  priorityChart = new Chart($('#priorityChart'), {
    type: 'doughnut',
    data: { labels: pl, datasets: [{ data: pl.map((k) => s.byPriority[k]), backgroundColor: pl.map((k) => PRI_COLORS[k] || '#94a3b8') }] },
    options: { plugins: { legend: { position: 'right', labels: { font: { family: 'Sarabun' } } } }, cutout: '60%' },
  });
  deptChart = mkBar('#deptChart', s.byDept, '#0d9488', false);

  $('#topEquip').innerHTML = s.topEquipment.map((e, i) => {
    const max = s.topEquipment[0].count || 1;
    return `<div class="te-row" data-id="${esc(e.equipmentId)}">
      <span class="te-rank">${i + 1}</span>
      <div class="te-info"><b>${esc(e.equipmentId)}</b> <span class="te-name">${esc(e.equipmentName || '')}</span>
        <div class="te-bar"><span style="width:${(e.count / max * 100).toFixed(0)}%"></span></div></div>
      <span class="te-count">${e.count} ครั้ง${e.open ? ` · ค้าง ${e.open}` : ''}</span></div>`;
  }).join('') || '<p style="color:var(--muted)">ยังไม่มีข้อมูล</p>';
  $$('#topEquip .te-row').forEach((el) => el.addEventListener('click', () => openEquip(el.dataset.id)));
}

// ---------- new ticket ----------
const modalNew = $('#modalNew');
$('#btnNew').addEventListener('click', () => {
  $('#formNew').reporter.value = ME?.name || '';
  $('#formNew').email.value = ME?.email || '';
  $('#eqInfo').hidden = true;
  modalNew.classList.add('open');
});
$('#selEquipment').addEventListener('change', (e) => {
  const val = e.target.value;
  const box = $('#eqInfo');
  if (val.startsWith(BLD_PREFIX)) {
    box.hidden = false;
    box.innerHTML = `ประเภท: <b>อาคาร / สถานที่</b> · 🏢 <b>${esc(val.slice(BLD_PREFIX.length))}</b> · แจ้งซ่อมงานอาคาร (ไฟฟ้า/ประปา/โครงสร้าง ฯลฯ)`;
    return;
  }
  if (val === 'OTHER') {
    box.hidden = false;
    box.innerHTML = 'ประเภท: <b>อื่นๆ</b> · โปรดระบุเครื่องจักร/อาคาร และอาการให้ชัดเจนในช่อง "อาการ / รายละเอียดปัญหา"';
    return;
  }
  const eq = META.equipment.find((x) => x.id === val);
  if (eq) { box.hidden = false; box.innerHTML = `ประเภท: <b>${esc(eq.type)}</b> · 🏢 <b>${esc(eq.building || '-')}</b> · แผนก: <b>${esc(eq.dept)}</b> · สถานที่: ${esc(eq.location)} · S/N: ${esc(eq.sn)}`; }
  else box.hidden = true;
});
// ---------- photo upload (resize to data URL) ----------
let nPhotoData = '';
function resizeImage(file, maxSize = 1280, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxSize) { height = Math.round(height * maxSize / width); width = maxSize; }
      else if (height > maxSize) { width = Math.round(width * maxSize / height); height = maxSize; }
      const cv = document.createElement('canvas');
      cv.width = width; cv.height = height;
      cv.getContext('2d').drawImage(img, 0, 0, width, height);
      resolve(cv.toDataURL('image/jpeg', quality));
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}
$('#nPhoto').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) { nPhotoData = ''; $('#nPhotoPreview').hidden = true; return; }
  try {
    nPhotoData = await resizeImage(file);
    $('#nPhotoImg').src = nPhotoData; $('#nPhotoPreview').hidden = false;
  } catch { toast('⚠️ อ่านรูปไม่สำเร็จ'); nPhotoData = ''; }
});
$('#nPhotoClear').addEventListener('click', () => {
  nPhotoData = ''; $('#nPhoto').value = ''; $('#nPhotoPreview').hidden = true;
});
$('#formNew').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  if (nPhotoData) body.photo = nPhotoData;
  try {
    const t = await api('/api/tickets', { method: 'POST', body: JSON.stringify(body) });
    nPhotoData = ''; $('#nPhotoPreview').hidden = true;
    e.target.reset(); $('#eqInfo').hidden = true; modalNew.classList.remove('open');
    toast(`✅ ส่งใบแจ้งซ่อมแล้ว: ${t.no} (แจ้งเตือนอีเมล/LINE อัตโนมัติ)`);
    loadDashboard();
  } catch (err) { toast('⚠️ ' + err.message); }
});

// ---------- ticket detail ----------
async function openDetail(id) {
  const t = await api('/api/tickets/' + id);
  $('#dTitle').textContent = `${t.no} · ${t.status}`;
  const row = (k, v) => `<div class="d-row"><span class="k">${k}</span><span>${esc(v || '-')}</span></div>`;
  const editBlock = canEdit() ? `
    <div class="d-section">
      <label style="font-weight:600;font-size:13px">ผู้ดำเนินการ
        <input id="dAssignee" value="${esc(t.assignee)}" style="width:100%;margin-top:5px;padding:9px;border:1px solid var(--line);border-radius:8px" /></label>
      <label style="font-weight:600;font-size:13px;display:block;margin-top:10px">สาเหตุ / วิธีการแก้ไข
        <textarea id="dSolution" rows="3" style="width:100%;margin-top:5px;padding:9px;border:1px solid var(--line);border-radius:8px">${esc(t.solution)}</textarea></label>
      <button class="btn-primary" style="margin-top:10px;color:#fff;background:var(--brand)" id="dSave">บันทึกข้อมูล</button>
    </div>
    <div class="d-section">
      <h3 style="font-size:14px;margin-bottom:6px">เปลี่ยนสถานะ (แจ้งเตือนอัตโนมัติ)</h3>
      ${(TRANSITIONS[t.status] || []).length
        ? `<div class="status-actions">
             <select id="dStatusSelect" style="flex:1;margin-top:0">
               <option value="">— เลือกสถานะใหม่ —</option>
               ${(TRANSITIONS[t.status] || []).map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
             </select>
             <button class="btn-primary" id="dStatusApply" style="white-space:nowrap">อัปเดตสถานะ</button>
           </div>
           <label id="dClosedDateWrap" style="display:none;font-size:13px;font-weight:600;margin-top:10px">📅 วันที่ปิดงาน (สำเร็จ / ยกเลิก)
             <input type="date" id="dClosedDate" style="width:100%;margin-top:5px;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)" />
           </label>`
        : `<p style="color:var(--muted);font-size:13px;margin:0">✔️ งานนี้ปิดแล้ว (${esc(t.status)}) — ไม่สามารถเปลี่ยนสถานะต่อได้</p>`}
    </div>` : `<div class="d-section"><div class="d-row"><span class="k">ผู้ดำเนินการ</span><span>${esc(t.assignee || '-')}</span></div>
      <div class="d-row"><span class="k">การแก้ไข</span><span>${esc(t.solution || '-')}</span></div></div>`;
  const inp = 'width:100%;margin-top:5px;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--card2);color:var(--ink)';
  const adminBlock = ME?.role === 'admin' ? `
    <div class="d-section" style="border-top:1px dashed var(--line);padding-top:14px">
      <h3 style="font-size:14px;margin-bottom:8px">✏️ แก้ไขใบแจ้งซ่อม (แอดมิน)</h3>
      <div class="grid2">
        <label style="font-size:13px;font-weight:600">ผู้แจ้ง<input id="eReporter" value="${esc(t.reporter)}" style="${inp}"></label>
        <label style="font-size:13px;font-weight:600">เบอร์โทร<input id="ePhone" value="${esc(t.phone)}" style="${inp}"></label>
      </div>
      <label style="font-size:13px;font-weight:600;display:block;margin-top:10px">แผนกผู้แจ้ง
        <select id="eReqDept" style="${inp}"><option value="">— เลือกแผนก —</option>${REQ_DEPTS.map((d) => `<option${d === t.reqDept ? ' selected' : ''}>${esc(d)}</option>`).join('')}</select></label>
      <label style="font-size:13px;font-weight:600;display:block;margin-top:10px">เครื่องจักร / อาคาร
        <select id="eEquip" style="${inp}"></select></label>
      <div class="grid2" style="margin-top:10px">
        <label style="font-size:13px;font-weight:600">หมวดปัญหา<input id="eProblem" value="${esc(t.problemType)}" style="${inp}"></label>
        <label style="font-size:13px;font-weight:600">ความเร่งด่วน<select id="ePriority" style="${inp}">${META.priorities.map((p) => `<option${p === t.priority ? ' selected' : ''}>${esc(p)}</option>`).join('')}</select></label>
      </div>
      <label style="font-size:13px;font-weight:600;display:block;margin-top:10px">อาการ<textarea id="eDetail" rows="2" style="${inp}">${esc(t.detail)}</textarea></label>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button class="btn-primary" id="eSave">💾 บันทึกการแก้ไข</button>
        <button class="btn-ghost" id="eDelete" style="color:#f87171;border-color:#f87171">🗑️ ลบใบนี้</button>
      </div>
    </div>` : '';
  $('#dBody').innerHTML = `
    <div class="d-section">
      ${row('แผนกผู้แจ้ง', t.reqDept)}
      ${row('เครื่องจักร', `${t.equipmentId} ${t.equipmentName}`)}
      ${row('แผนก / สถานที่', `${t.dept} · ${t.location}`)}
      ${row('หมวดปัญหา', t.problemType)}
      ${row('ความเร่งด่วน', t.priority)}
      ${row('อาการ', t.detail)}
      ${row('ผู้แจ้ง', `${t.reporter} ${t.phone ? '· ' + t.phone : ''} ${t.email ? '· ' + t.email : ''}`)}
      ${t.photo ? `<div class="d-row"><span class="k">รูปภาพ</span><a href="${t.photo}" target="_blank"><img src="${t.photo}" class="ticket-photo" alt="รูปแจ้งซ่อม" /></a></div>` : ''}
    </div>
    ${editBlock}
    ${adminBlock}
    <div class="d-section">
      <h3 style="font-size:14px">ประวัติการดำเนินการ</h3>
      <ul class="timeline">${t.history.map((h) =>
        `<li><b>${esc(h.status)}</b> — ${new Date(h.at).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}${h.note ? ' · ' + esc(h.note) : ''}</li>`).join('')}</ul>
    </div>`;
  $('#modalDetail').classList.add('open');

  if (canEdit()) {
    $('#dSave').addEventListener('click', async () => {
      await api('/api/tickets/' + t.id, { method: 'PATCH', body: JSON.stringify({ assignee: $('#dAssignee').value, solution: $('#dSolution').value }) });
      toast('💾 บันทึกแล้ว');
    });
    // แสดงช่องวันที่เฉพาะเมื่อเลือกสถานะปิดงาน (สำเร็จ / ยกเลิก) — ตั้งค่าเริ่มต้นเป็นวันนี้
    const statusSel = $('#dStatusSelect');
    if (statusSel) statusSel.addEventListener('change', () => {
      const wrap = $('#dClosedDateWrap'); if (!wrap) return;
      const closing = statusSel.value === 'สำเร็จ' || statusSel.value === 'ยกเลิก';
      wrap.style.display = closing ? 'block' : 'none';
      if (closing && !$('#dClosedDate').value) $('#dClosedDate').value = new Date().toISOString().slice(0, 10);
    });
    const applyBtn = $('#dStatusApply');
    if (applyBtn) applyBtn.addEventListener('click', async () => {
      const ns = $('#dStatusSelect').value;
      if (!ns) return toast('⚠️ กรุณาเลือกสถานะใหม่');
      const body = { status: ns, assignee: $('#dAssignee').value, solution: $('#dSolution').value };
      const cd = $('#dClosedDate');
      if ((ns === 'สำเร็จ' || ns === 'ยกเลิก') && cd && cd.value) body.closedDate = cd.value;
      try {
        await api('/api/tickets/' + t.id, { method: 'PATCH', body: JSON.stringify(body) });
        $('#modalDetail').classList.remove('open');
        toast(`📌 อัปเดตสถานะเป็น "${ns}" และแจ้งเตือนแล้ว`);
        loadDashboard(); if ($('#view-list').classList.contains('active')) loadTickets();
      } catch (e) { toast('⚠️ ' + e.message); }
    });
  }

  if (ME?.role === 'admin') {
    fillEquipSelect($('#eEquip'));
    $('#eEquip').value = t.equipmentId;
    $('#eSave').addEventListener('click', async () => {
      try {
        await api('/api/tickets/' + t.id, { method: 'PATCH', body: JSON.stringify({
          reporter: $('#eReporter').value, phone: $('#ePhone').value, reqDept: $('#eReqDept').value, equipmentId: $('#eEquip').value,
          problemType: $('#eProblem').value, priority: $('#ePriority').value, detail: $('#eDetail').value,
        }) });
        $('#modalDetail').classList.remove('open');
        toast('💾 แก้ไขใบแจ้งซ่อมแล้ว');
        loadDashboard(); if ($('#view-list').classList.contains('active')) loadTickets();
      } catch (e) { toast('⚠️ ' + e.message); }
    });
    $('#eDelete').addEventListener('click', async () => {
      if (!confirm(`ลบใบแจ้งซ่อม ${t.no}?\nการลบเป็นการถาวร กู้คืนไม่ได้`)) return;
      try {
        await api('/api/tickets/' + t.id, { method: 'DELETE' });
        $('#modalDetail').classList.remove('open');
        toast('🗑️ ลบใบแจ้งซ่อมแล้ว');
        loadDashboard(); if ($('#view-list').classList.contains('active')) loadTickets();
      } catch (e) { toast('⚠️ ' + e.message); }
    });
  }
}

// ---------- PM ----------
function pmRow(p) {
  const overdue = p.nextDue && p.nextDue < new Date().toISOString().slice(0, 10);
  return `<div class="ticket" style="--sc:#0d9488">
    <div><div class="no">${esc(p.no)}</div><div class="meta">${esc(p.date)}</div></div>
    <div>
      <div class="det"><b>${esc(p.equipmentId)}</b> ${esc(p.equipmentName)}</div>
      <div class="meta">${esc(p.type)} · โดย ${esc(p.performedBy || '-')} · ผล: ${esc(p.result)}</div>
      ${p.detail ? `<div class="meta">${esc(p.detail)}</div>` : ''}
      ${p.nextDue ? `<span class="pri" style="color:${overdue ? '#dc2626' : '#0d9488'}">⏰ PM ครั้งถัดไป: ${esc(p.nextDue)}${overdue ? ' (เกินกำหนด)' : ''}</span>` : ''}
    </div>
    ${canEdit() ? `<button class="btn-ghost pm-del" data-id="${p.id}" style="font-size:13px">🗑️ ลบ</button>` : '<span></span>'}
  </div>`;
}
async function loadPM() {
  const q = $('#searchPm').value.trim();
  const rows = await api('/api/pm' + (q ? '?q=' + encodeURIComponent(q) : ''));
  $('#pmList').innerHTML = rows.map(pmRow).join('') || '<p style="color:var(--muted)">ยังไม่มีประวัติ PM</p>';
  $$('#pmList .pm-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('ลบรายการ PM นี้?')) return;
    await api('/api/pm/' + b.dataset.id, { method: 'DELETE' });
    toast('ลบแล้ว'); loadPM();
  }));
}
$('#searchPm').addEventListener('input', debounce(loadPM, 300));
$('#btnNewPm').addEventListener('click', () => { $('#formPm').date.value = new Date().toISOString().slice(0, 10); $('#modalPm').classList.add('open'); });
$('#formPm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    const rec = await api('/api/pm', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset(); $('#modalPm').classList.remove('open');
    toast(`✅ บันทึก PM แล้ว: ${rec.no}`); loadPM(); loadDashboard();
  } catch (err) { toast('⚠️ ' + err.message); }
});

// ---------- Users (admin) ----------
async function loadUsers() {
  const rows = await api('/api/users');
  $('#userList').innerHTML = rows.map((u) => `<div class="ticket" style="--sc:#6366f1">
    <div><div class="no">${esc(u.name)}</div><div class="meta">@${esc(u.username)}</div></div>
    <div><div class="det">${esc(u.roleLabel)}</div><div class="meta">${esc(u.email || 'ไม่มีอีเมล')}</div></div>
    <div style="display:flex;gap:6px">
      <button class="btn-ghost u-pw" data-u="${esc(u.username)}" style="font-size:13px">🔑 รหัสผ่าน</button>
      <button class="btn-ghost u-del" data-u="${esc(u.username)}" style="font-size:13px">🗑️</button>
    </div></div>`).join('');
  $$('#userList .u-del').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm(`ลบผู้ใช้ ${b.dataset.u}?`)) return;
    try { await api('/api/users/' + b.dataset.u, { method: 'DELETE' }); toast('ลบแล้ว'); loadUsers(); }
    catch (e) { toast('⚠️ ' + e.message); }
  }));
  $$('#userList .u-pw').forEach((b) => b.addEventListener('click', async () => {
    const pw = prompt('ตั้งรหัสผ่านใหม่สำหรับ ' + b.dataset.u);
    if (!pw) return;
    try { await api('/api/users/' + b.dataset.u + '/password', { method: 'POST', body: JSON.stringify({ password: pw }) }); toast('เปลี่ยนรหัสผ่านแล้ว'); }
    catch (e) { toast('⚠️ ' + e.message); }
  }));
}
$('#btnNewUser').addEventListener('click', () => $('#modalUser').classList.add('open'));
$('#formUser').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(e.target));
  try {
    await api('/api/users', { method: 'POST', body: JSON.stringify(body) });
    e.target.reset(); $('#modalUser').classList.remove('open');
    toast('✅ เพิ่มผู้ใช้แล้ว'); loadUsers();
  } catch (err) { toast('⚠️ ' + err.message); }
});

// ---------- modal close ----------
$$('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.modal-bg').classList.remove('open')));
$$('.modal-bg').forEach((m) => m.addEventListener('click', (e) => { if (e.target === m) m.classList.remove('open'); }));

// ---------- bootstrap: resume session if token exists ----------
(async function bootstrap() {
  if (!TOKEN) return;
  try { ME = await api('/api/me'); enterApp(); } catch { doLogout(); }
})();
