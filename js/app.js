// MTC খরচ হিসাব — প্রতিটি পাতা নিচে আলাদা ফাংশনে (pages.dashboard, pages.expenses ...)
const CFG = window.MTC_CONFIG;
const api = window.MTC_API;
const $app = document.getElementById('app');
let ME = null;           // লগইন করা ইউজারের profile
let FLASH = null;

// ---------- ছোট সাহায্যকারী ----------
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: CFG.TIMEZONE }).format(new Date());
const thisMonth = () => today().slice(0, 7);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const isMonth = s => /^\d{4}-\d{2}$/.test(s || '');
const daysInMonth = m => new Date(+m.slice(0, 4), +m.slice(5, 7), 0).getDate();
const total = rows => rows.reduce((s, r) => s + Number(r.amount), 0);
const isAdmin = () => ME && ME.role === 'admin';
const sumBy = (rows, fn) => {
  const m = new Map();
  rows.forEach(r => m.set(fn(r), (m.get(fn(r)) || 0) + Number(r.amount)));
  return [...m.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
};
const catName = r => r.category?.name || '—';
const userName = r => r.profile?.full_name || '—';
const flash = (type, msg) => { FLASH = { type, msg }; };
const errText = e => {
  const m = e?.message || String(e);
  if (/Invalid login/i.test(m)) return 'ইমেইল/ইউজারনেম বা পাসওয়ার্ড ভুল।';
  if (/row-level security/i.test(m)) return 'এই কাজের অনুমতি আপনার নেই।';
  if (/duplicate key/i.test(m)) return 'এই নাম আগে থেকেই আছে।';
  if (/admin_(create_user|set_password|list_users)/i.test(m)) return NEED_SQL;
  if (/delete_expense|deleted_at|deleted_by/i.test(m)) return NEED_SQL_DEL;
  if (/app_settings|push_subscriptions/i.test(m)) return 'নোটিফিকেশন চালু করতে Supabase SQL Editor-এ "supabase/notifications.sql" ফাইলটা একবার চালাতে হবে।';
  if (/icon/i.test(m) && /column|schema/i.test(m)) return 'আইকন সেভ করতে Supabase-এ একবার এই SQL চালান: alter table public.categories add column if not exists icon text;';
  return m;
};
const go = hash => { if (location.hash === hash) render(); else location.hash = hash; };
const params = () => new URLSearchParams(location.hash.split('?')[1] || '');
const flashHtml = () => { const f = FLASH; FLASH = null; return f ? `<div class="flash ${f.type}">${h(f.msg)}</div>` : ''; };
const hbars = (list, of) => list.map(c => `<div class="hrow"><span>${h(c.name)}</span><b>${money(c.total)}</b>
  <div class="hbar"><i style="width:${of ? (c.total / of * 100).toFixed(1) : 0}%"></i></div></div>`).join('');
const options = (list, sel, label = x => x.name) => list.map(x => `<option value="${x.id}" ${String(sel) === String(x.id) ? 'selected' : ''}>${h(label(x))}</option>`).join('');

// ---------- পাতাগুলো ----------
const pages = {};

pages.login = async () => {
  $app.innerHTML = `<div class="auth">
    <div class="auth-card">
      <div class="auth-brand"><img class="logo-img big" src="icons/logo.png" alt="MTC"><h1>খরচ হিসাব</h1><p>${h(CFG.COMPANY)}</p></div>
      ${flashHtml()}
      <form id="f" class="stack">
        <label class="field"><span>ইউজারনেম বা ইমেইল</span><input name="u" autocomplete="username" autocapitalize="none" required autofocus placeholder="যেমন: rahim"></label>
        <label class="field"><span>পাসওয়ার্ড</span><input name="p" type="password" autocomplete="current-password" required placeholder="••••••"></label>
        <button class="btn btn-lg">লগইন করুন →</button>
      </form>
    </div>
    <p class="auth-foot">দৈনিক খরচের হিসাব · নিরাপদ ও সহজ</p></div>`;
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    let u = fd.get('u').trim().toLowerCase();
    if (!u.includes('@')) u += '@' + CFG.LOGIN_EMAIL_DOMAIN;
    ev.target.querySelector('button').disabled = true;
    try { await api.signIn(u, fd.get('p')); await boot(); }
    catch (e) { flash('err', errText(e)); pages.login(); }
  };
};

// খাতের রং (রঙ-অন্ধ মানুষের জন্যও আলাদা করে বোঝা যায় এমনভাবে বাছাই করা ৮টি রং, ক্রম বদলাবেন না)
const CAT_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
const OTHER_COLOR = '#9a9890';
// খাতের আইকন না দেওয়া থাকলে নাম দেখে আইকন বেছে নেয়
const ICON_GUESS = [
  [/খাবার|food|meal|নাস্তা/i, '🍛'], [/যাতায়াত|transport|taxi|ভাড়া গাড়ি|bus/i, '🚕'], [/জ্বালানি|fuel|petrol|diesel|তেল/i, '⛽'],
  [/সামগ্রী|material|cement|সিমেন্ট|রড|steel/i, '🧱'], [/মজুরি|labou?r|শ্রমিক|salary|বেতন/i, '👷'], [/যন্ত্র|equipment|machine|tool/i, '🚜'],
  [/অফিস|office|stationery/i, '🏢'], [/মেরামত|repair|maintenance/i, '🔧'], [/বিদ্যুৎ|electric|bill|বিল/i, '💡'], [/পানি|water/i, '💧'],
  [/ভাড়া|rent/i, '🏠'], [/মোবাইল|phone|internet/i, '📱'], [/চিকিৎসা|medical|ওষুধ/i, '💊'], [/গাড়ি|vehicle|car/i, '🚚'],
];
const catIcon = c => c?.icon || (ICON_GUESS.find(([re]) => re.test(c?.name || '')) || [0, '📦'])[1];
const catColor = (cats, id) => { const i = cats.findIndex(c => c.id === id); return i >= 0 && i < CAT_COLORS.length ? CAT_COLORS[i] : OTHER_COLOR; };
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const bnDate = d => new Date(d + 'T00:00:00').toLocaleDateString('bn-BD', { day: 'numeric', month: 'long' });
const bnMonth = m => new Date(m + '-01T00:00:00').toLocaleDateString('bn-BD', { month: 'long', year: 'numeric' });
const shiftMonth = (m, n) => { const d = new Date(+m.slice(0, 4), +m.slice(5, 7) - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
const delta = (now, before, label) => {
  if (!before) return `<em class="delta">${label}: —</em>`;
  const d = Math.round((now - before) / before * 100);
  return `<em class="delta ${d > 0 ? 'up' : d < 0 ? 'down' : ''}">${d > 0 ? '▲' : d < 0 ? '▼' : '•'} ${Math.abs(d)}% ${label}</em>`;
};

function donut(slices, total) {
  if (!total) return '<div class="donut-empty muted">এই মাসে কোনো খরচ নেই</div>';
  const R = 70, C = 2 * Math.PI * R, GAP = slices.length > 1 ? 2 : 0;
  let off = 0;
  const arcs = slices.map(s => {
    const len = s.total / total * C, seg = Math.max(len - GAP, 0.5);
    const el = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${s.color}" stroke-width="26" stroke-dasharray="${seg} ${C - seg}" stroke-dashoffset="${-off}"
      data-tip="${h(s.icon + ' ' + s.name)}: ${money(s.total)} ${h(CFG.CURRENCY)} (${pct(s.total, total)}%)"></circle>`;
    off += len; return el;
  }).join('');
  return `<svg viewBox="0 0 180 180" class="donut" role="img" aria-label="খাত অনুযায়ী খরচের ভাগ"><g transform="rotate(-90 90 90)">${arcs}</g>
    <text x="90" y="84" class="donut-k">মোট</text><text x="90" y="106" class="donut-v">${money(total)}</text></svg>`;
}

// মসৃণ রেখা (Catmull-Rom → Bezier), নিচের সীমা ছাড়িয়ে যায় না
function smoothPath(pts, floorY) {
  if (pts.length < 2) return '';
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(floorY, p1[1] + (p2[1] - p0[1]) / 6)];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(floorY, p2[1] - (p3[1] - p1[1]) / 6)];
    d += ` C${c1[0].toFixed(1)},${c1[1].toFixed(1)} ${c2[0].toFixed(1)},${c2[1].toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
  }
  return d;
}

function areaChart(daily, t, C) {
  const W = Math.round(Math.max(300, Math.min(1100, ($app.clientWidth || 720) - 40))), H = innerWidth < 760 ? 190 : 230, L = 8, R = 8, T = 14, B = 26, iw = W - L - R, ih = H - T - B;
  const shown = daily.filter(d => d.date <= t);
  const max = Math.max(1, ...daily.map(d => d.total)) * 1.12;
  const x = i => L + (daily.length === 1 ? iw / 2 : i * iw / (daily.length - 1));
  const y = v => T + ih - v / max * ih;
  const pts = shown.map((d, i) => [x(i), y(d.total)]);
  const line = smoothPath(pts, T + ih);
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1][0]},${T + ih} L${pts[0][0]},${T + ih} Z` : '';
  const ti = daily.findIndex(d => d.date === t);
  const step = iw / Math.max(1, daily.length - 1);
  return `<svg viewBox="0 0 ${W} ${H}" class="area" role="img" aria-label="দৈনিক খরচের চার্ট">
    <defs><linearGradient id="ag" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2a78d6" stop-opacity=".28"/><stop offset="1" stop-color="#2a78d6" stop-opacity="0"/></linearGradient></defs>
    ${[0.25, 0.5, 0.75, 1].map(f => `<line x1="${L}" x2="${W - R}" y1="${y(max / 1.12 * f)}" y2="${y(max / 1.12 * f)}" class="gl"/>`).join('')}
    <line x1="${L}" x2="${W - R}" y1="${T + ih}" y2="${T + ih}" class="base"/>
    ${area ? `<path d="${area}" fill="url(#ag)"/><path d="${line}" class="ln"/>` : ''}
    ${ti >= 0 && pts[ti] ? `<circle cx="${pts[ti][0]}" cy="${pts[ti][1]}" r="5" class="today-dot"/>` : ''}
    ${daily.map((d, i) => `<g class="hit" data-tip="${bnDate(d.date)}: ${money(d.total)} ${C}" data-href="#/expenses?date=${d.date}">
      <rect x="${x(i) - step / 2}" y="${T}" width="${step}" height="${ih}" fill="transparent"/>
      ${d.date <= t ? `<line x1="${x(i)}" x2="${x(i)}" y1="${T}" y2="${T + ih}" class="xh"/><circle cx="${x(i)}" cy="${y(d.total)}" r="4.5" class="hd"/>` : ''}</g>`).join('')}
    ${daily.map((d, i) => (+d.date.slice(8)) % 5 === 0 || i === 0 ? `<text x="${x(i)}" y="${H - 6}" class="xl">${+d.date.slice(8)}</text>` : '').join('')}
  </svg>`;
}

function sparkline(daily, t) {
  let run = 0; const v = daily.filter(d => d.date <= t).map(d => (run += d.total)); // মাসের জমতে থাকা খরচ
  if (v.length < 2) return '';
  const W = 300, H = 60, max = Math.max(1, ...v);
  const pts = v.map((n, i) => [i * W / (v.length - 1), H - 4 - n / max * (H - 10)]);
  const ln = smoothPath(pts, H - 4);
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="spark" aria-hidden="true">
    <defs><linearGradient id="sg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".22"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
    <path d="${ln} L${W},${H} L0,${H} Z" fill="url(#sg)"/><path d="${ln}" fill="none" stroke="rgba(255,255,255,.85)" stroke-width="2" vector-effect="non-scaling-stroke"/></svg>`;
}

const greeting = () => {
  const hr = +new Intl.DateTimeFormat('en-US', { timeZone: CFG.TIMEZONE, hour: 'numeric', hour12: false }).format(new Date()) % 24;
  return hr < 5 ? 'শুভ রাত্রি' : hr < 12 ? 'শুভ সকাল' : hr < 16 ? 'শুভ দুপুর' : hr < 18 ? 'শুভ বিকাল' : hr < 21 ? 'শুভ সন্ধ্যা' : 'শুভ রাত্রি';
};

pages.dashboard = async () => {
  const p = params();
  const month = isMonth(p.get('month')) ? p.get('month') : thisMonth();
  const t = today(), isCur = month === thisMonth();
  const y = new Date(new Date(t + 'T00:00:00').getTime() - 864e5).toLocaleDateString('en-CA');
  const [rows, months, cats] = await Promise.all([api.expenses({ month }), api.monthlyTotals(120), api.categories()]);
  const todayRows = t.startsWith(month) ? rows.filter(r => r.expense_date === t) : await api.expenses({ date: t });
  const yTotal = total(y.startsWith(month) ? rows.filter(r => r.expense_date === y) : await api.expenses({ date: y }));
  const monthTotal = total(rows), todayTotal = total(todayRows);
  const allTime = months.reduce((s, m) => s + Number(m.total), 0);
  const prevMonth = Number(months.find(m => m.month === shiftMonth(month, -1))?.total || 0);
  const daily = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { date: d, total: total(rows.filter(r => r.expense_date === d)) };
  });
  const lastDay = isCur ? t : daily[daily.length - 1].date;
  const pastDays = daily.filter(d => d.date <= lastDay).length;
  const peak = daily.reduce((a, b) => (b.total > a.total ? b : a), daily[0]);
  const C = h(CFG.CURRENCY);
  const mChange = prevMonth ? Math.round((monthTotal - prevMonth) / prevMonth * 100) : null;

  const catStats = cats.filter(c => c.active || rows.some(r => r.category_id === c.id)).map(c => {
    const cr = rows.filter(r => r.category_id === c.id);
    return { id: c.id, name: c.name, icon: catIcon(c), color: catColor(cats, c.id), total: total(cr), count: cr.length,
      today: total(todayRows.filter(r => r.category_id === c.id)) };
  }).sort((a, b) => b.total - a.total);
  const withSpend = catStats.filter(c => c.total > 0);
  let slices = withSpend;
  if (withSpend.length > 8) {
    const rest = withSpend.slice(7);
    slices = [...withSpend.slice(0, 7), { name: 'অন্যান্য খাত', icon: '•', color: OTHER_COLOR, total: rest.reduce((s, c) => s + c.total, 0) }];
  }
  const recent = rows.slice(0, 6);
  const catById = id => cats.find(c => c.id === id);
  const firstName = (ME.full_name || '').split(/[\s(]/)[0];
  const longToday = new Date(t + 'T00:00:00').toLocaleDateString('bn-BD', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  $app.innerHTML = `${flashHtml()}
  <div class="dash-head">
    <div><p class="eyebrow">${longToday}</p><h1>${greeting()}, ${h(firstName)} 👋</h1></div>
    <div class="month-nav">
      <a class="icon-btn" href="#/?month=${shiftMonth(month, -1)}" aria-label="আগের মাস">‹</a>
      <label class="month-pick"><span>${bnMonth(month)}</span><input type="month" id="m" value="${month}"></label>
      <a class="icon-btn ${isCur ? 'disabled' : ''}" href="#/?month=${shiftMonth(month, 1)}" aria-label="পরের মাস">›</a>
    </div>
  </div>

  <section class="hero">
    <div class="hero-top">
      <div>
        <span class="hero-k">${isCur ? 'এই মাসের' : bnMonth(month) + '-এর'} মোট খরচ</span>
        <div class="hero-v">${money(monthTotal)} <small>${C}</small></div>
        ${mChange === null ? '' : `<span class="chip ${mChange > 0 ? 'up' : 'down'}">${mChange > 0 ? '↑' : '↓'} ${Math.abs(mChange)}% আগের মাসের তুলনায়</span>`}
      </div>
      <a class="hero-add" href="#/new" aria-label="খরচ যোগ করুন">＋</a>
    </div>
    ${sparkline(daily, lastDay)}
    <div class="hero-stats">
      <div><span>আজ</span><b>${money(todayTotal)}</b></div>
      <div><span>দৈনিক গড়</span><b>${money(pastDays ? monthTotal / pastDays : 0)}</b></div>
      <div><span>এন্ট্রি</span><b>${rows.length}টি</b></div>
    </div>
  </section>

  <div class="tiles">
    <div class="tile"><span class="tile-ico" style="--c:#eb6834">📅</span><div><span class="tile-k">আজকের খরচ</span><b>${money(todayTotal)} <small>${C}</small></b>${delta(todayTotal, yTotal, 'গতকালের তুলনায়')}</div></div>
    <div class="tile"><span class="tile-ico" style="--c:#1baf7a">🔥</span><div><span class="tile-k">সবচেয়ে বেশি খরচের দিন</span><b>${peak.total ? money(peak.total) : '0.00'} <small>${C}</small></b><em class="delta">${peak.total ? bnDate(peak.date) : '—'}</em></div></div>
    <div class="tile"><span class="tile-ico" style="--c:#6250d6">🏦</span><div><span class="tile-k">শুরু থেকে সর্বমোট</span><b>${money(allTime)} <small>${C}</small></b><em class="delta">${months.length}টি মাসের হিসাব</em></div></div>
  </div>

  <section class="panel">
    <div class="sec-head"><h2>দৈনিক খরচের ধারা</h2><span class="muted small">${bnMonth(month)}</span></div>
    ${areaChart(daily, lastDay, C)}
    <p class="muted small hint">চার্টে আঙুল রাখলে সেই দিনের খরচ দেখাবে, চাপলে সেই দিনের তালিকা খুলবে।</p>
  </section>

  <section class="sec">
    <div class="sec-head"><h2>খাত অনুযায়ী</h2><a href="#/expenses?month=${month}" class="small">সব দেখুন →</a></div>
    <div class="cat-grid">
      ${catStats.map(c => `<a class="cat-card" href="#/expenses?month=${month}&category=${c.id}" style="--c:${c.color}">
        <div class="cat-top"><span class="cat-ico">${h(c.icon)}</span>
          <svg class="ring" viewBox="0 0 36 36" aria-hidden="true"><circle cx="18" cy="18" r="15" class="ring-bg"/><circle cx="18" cy="18" r="15" class="ring-fg" stroke-dasharray="${(pct(c.total, monthTotal) / 100 * 94.25).toFixed(1)} 94.25"/></svg>
          <span class="ring-t">${pct(c.total, monthTotal)}%</span></div>
        <div class="cat-name">${h(c.name)}</div>
        <div class="cat-amt">${money(c.total)} <small>${C}</small></div>
        <div class="cat-meta"><span>আজ ${money(c.today)}</span><span>${c.count}টি</span></div>
      </a>`).join('') || '<p class="muted">কোনো খাত নেই। এডমিন "খাত" পাতা থেকে যোগ করুন।</p>'}
    </div>
  </section>

  <div class="chart-row">
    <section class="panel">
      <div class="sec-head"><h2>সাম্প্রতিক খরচ</h2><a href="#/expenses?month=${month}" class="small">সব দেখুন →</a></div>
      <ul class="recent">${recent.map(r => { const c = catById(r.category_id); return `<li>
        <span class="r-ico" style="--c:${catColor(cats, r.category_id)}">${h(catIcon(c || r.category))}</span>
        <div class="r-mid"><b>${h(r.description || catName(r))}</b><span>${h(catName(r))} · ${h(userName(r))} · ${bnDate(r.expense_date)}</span></div>
        <b class="r-amt">−${money(r.amount)}</b></li>`; }).join('') || '<li class="muted">এই মাসে এখনো কোনো খরচ নেই।</li>'}</ul>
    </section>
    <section class="panel">
      <div class="sec-head"><h2>খরচের ভাগ</h2></div>
      <div class="donut-wrap">${donut(slices, monthTotal)}
        <ul class="legend">${slices.map(s => `<li><i style="background:${s.color}"></i><span>${h(s.icon)} ${h(s.name)}</span><b>${pct(s.total, monthTotal)}%</b></li>`).join('')}</ul>
      </div>
    </section>
  </div>

  <div class="chart-row">
    <section class="panel">
      <div class="sec-head"><h2>মাসভিত্তিক মোট</h2></div>
      ${(() => { const ms = months.slice(0, 6), mx = Math.max(1, ...ms.map(m => Number(m.total)));
        return ms.map(m => `<a class="mrow ${m.month === month ? 'on' : ''}" href="#/?month=${m.month}"><span>${bnMonth(m.month)}</span>
          <div class="mbar"><i style="width:${(Number(m.total) / mx * 100).toFixed(1)}%"></i></div><b>${money(m.total)}</b></a>`).join('') || '<p class="muted">এখনো কোনো খরচ নেই।</p>'; })()}
    </section>
    <section class="panel">
      <div class="sec-head"><h2>সদস্য অনুযায়ী</h2></div>
      ${sumBy(rows, userName).map(c => `<div class="urow"><span class="avatar">${h(c.name.trim().charAt(0))}</span><span>${h(c.name)}</span><b>${money(c.total)}</b></div>`).join('') || '<p class="muted">—</p>'}
    </section>
  </div>`;
  document.getElementById('m').onchange = e => e.target.value && go('#/?month=' + e.target.value);
  $app.querySelectorAll('.hit').forEach(g => g.addEventListener('click', () => go(g.dataset.href)));
  bindTips();
};

// চার্টের উপর আঙুল/মাউস রাখলে ছোট বাক্সে হিসাব দেখায়
function bindTips() {
  let tip = document.getElementById('tip');
  if (!tip) { tip = Object.assign(document.createElement('div'), { id: 'tip', className: 'tip' }); document.body.appendChild(tip); }
  const show = (el, x, y) => { tip.textContent = el.dataset.tip; tip.style.display = 'block';
    const w = tip.offsetWidth; tip.style.left = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8) + 'px'; tip.style.top = (y - 44) + 'px'; };
  $app.querySelectorAll('[data-tip]').forEach(el => {
    el.addEventListener('mousemove', e => show(el, e.clientX, e.clientY));
    el.addEventListener('mouseleave', () => tip.style.display = 'none');
    el.addEventListener('touchstart', e => { const t0 = e.touches[0]; show(el, t0.clientX, t0.clientY); }, { passive: true });
  });
  window.addEventListener('scroll', () => tip.style.display = 'none', { passive: true });
}

const pageHead = (title, sub = '', action = '') => `<div class="page-head"><div><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>${action}</div>`;
const switchEl = (name, on, dis = '') => `<label class="switch"><input type="checkbox" name="${name}" ${on ? 'checked' : ''} ${dis}><span></span></label>`;

pages.expenses = async () => {
  const p = params();
  const f = { date: isDate(p.get('date')) ? p.get('date') : '', month: '', categoryId: p.get('category') || '', userId: p.get('user') || '' };
  if (!f.date) f.month = isMonth(p.get('month')) ? p.get('month') : thisMonth();
  const [rows, cats, users] = await Promise.all([api.expenses(f), api.categories(), api.profiles()]);
  const C = h(CFG.CURRENCY), sum = total(rows);
  const groups = [];
  rows.forEach(r => { let g = groups[groups.length - 1]; if (!g || g.date !== r.expense_date) groups.push(g = { date: r.expense_date, rows: [] }); g.rows.push(r); });
  const activeCat = cats.find(c => String(c.id) === String(f.categoryId));
  const activeUser = users.find(u => u.id === f.userId);
  const periodLabel = f.date ? bnDate(f.date) : bnMonth(f.month);
  const qs = o => { const q = new URLSearchParams(); Object.entries(o).forEach(([k, v]) => v && q.set(k, v)); return '#/expenses?' + q; };
  const base = { date: f.date, month: f.date ? '' : f.month, category: f.categoryId, user: f.userId };

  $app.innerHTML = `${flashHtml()}
  ${pageHead('সব খরচ', 'খাত, সদস্য বা সময় দিয়ে খুঁজুন', '<a class="btn" href="#/new">＋ খরচ যোগ</a>')}
  <section class="sum-hero">
    <div><span>${periodLabel}${activeCat ? ' · ' + h(activeCat.name) : ''}${activeUser ? ' · ' + h(activeUser.full_name) : ''}</span>
      <b>${money(sum)} <small>${C}</small></b></div>
    <div class="sum-meta"><span>${rows.length}</span>টি এন্ট্রি</div>
  </section>
  <details class="filter-box" ${f.categoryId || f.userId || f.date ? 'open' : ''}>
    <summary><span>🔍 ফিল্টার</span><span class="muted small">${f.categoryId || f.userId || f.date ? 'চালু আছে' : 'তারিখ, মাস, খাত, সদস্য'}</span></summary>
    <form id="flt" class="filter-grid">
      <label class="field"><span>তারিখ</span><input type="date" name="date" value="${f.date}"></label>
      <label class="field"><span>অথবা মাস</span><input type="month" name="month" value="${f.month}"></label>
      <label class="field"><span>খাত</span><select name="category"><option value="">সব খাত</option>${options(cats, f.categoryId)}</select></label>
      <label class="field"><span>সদস্য</span><select name="user"><option value="">সবাই</option>${options(users, f.userId, u => u.full_name)}</select></label>
      <div class="row"><button class="btn">দেখুন</button><a class="btn ghost" href="#/expenses">মুছে দিন</a></div>
    </form>
  </details>
  <div class="chips">
    <a class="chip-f ${!f.categoryId ? 'on' : ''}" href="${qs({ ...base, category: '' })}">সব</a>
    ${cats.filter(c => c.active).map(c => `<a class="chip-f ${String(c.id) === String(f.categoryId) ? 'on' : ''}" style="--c:${catColor(cats, c.id)}" href="${qs({ ...base, category: c.id })}">${h(catIcon(c))} ${h(c.name)}</a>`).join('')}
  </div>
  ${groups.map(g => `<section class="day-group">
    <div class="day-head"><b>${bnDate(g.date)}</b><span>${money(total(g.rows))} ${C}</span></div>
    <ul class="tx-list">${g.rows.map(r => { const c = cats.find(x => x.id === r.category_id); const mine = isAdmin() || r.user_id === ME.id; return `<li class="tx">
      <span class="r-ico" style="--c:${catColor(cats, r.category_id)}">${h(catIcon(c || r.category))}</span>
      <div class="r-mid"><b>${h(r.description || catName(r))}</b><span>${h(catName(r))} · ${h(userName(r))}</span></div>
      <div class="tx-right"><b class="r-amt">${money(r.amount)}</b>
        <div class="tx-actions">
          ${r.receipt_path ? `<button class="ia" data-receipt="${h(r.receipt_path)}" title="রসিদ দেখুন">🧾</button>` : ''}
          ${mine ? `<a class="ia" href="#/edit/${r.id}" title="এডিট">✏️</a><button class="ia" data-del="${r.id}" title="মুছুন">🗑️</button>` : ''}
        </div></div></li>`; }).join('')}</ul></section>`).join('')
    || `<div class="empty"><span>🗂️</span><b>এই সময়ে কোনো খরচ নেই</b><a class="btn" href="#/new">＋ খরচ যোগ করুন</a></div>`}`;
  document.getElementById('flt').onsubmit = ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target), q = new URLSearchParams();
    if (fd.get('date')) q.set('date', fd.get('date')); else if (fd.get('month')) q.set('month', fd.get('month'));
    if (fd.get('category')) q.set('category', fd.get('category'));
    if (fd.get('user')) q.set('user', fd.get('user'));
    go('#/expenses?' + q);
  };
  $app.querySelectorAll('[data-receipt]').forEach(b => b.onclick = async () => {
    const w = window.open('', '_blank');
    try { w.location = await api.receiptUrl(b.dataset.receipt); } catch (e) { w.close(); alert(errText(e)); }
  });
  $app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm('এই খরচটি মুছে ফেলবেন?')) return;
    const r = rows.find(x => String(x.id) === b.dataset.del);
    try {
      await api.deleteExpense(r.id);
      flash('ok', isAdmin() ? 'খরচটি "মুছে ফেলা খরচ" তালিকায় সরানো হয়েছে।' : 'খরচ মুছে ফেলা হয়েছে।');
    } catch (e) { flash('err', errText(e)); }
    render();
  });
};

pages.form = async (id) => {
  const [cats, old] = await Promise.all([api.categories(), id ? api.expense(id) : null]);
  if (id && (!old || !(isAdmin() || old.user_id === ME.id))) { flash('err', 'আপনি শুধু নিজের খরচ এডিট করতে পারবেন।'); return go('#/expenses'); }
  const e = old || { expense_date: today(), amount: '', description: '', category_id: '' };
  const usable = cats.filter(c => c.active || c.id === e.category_id);
  $app.innerHTML = `<div class="form-wrap">
    ${pageHead(id ? 'খরচ এডিট করুন' : 'নতুন খরচ', id ? 'তথ্য বদলে সেভ করুন' : 'খাত বেছে নিয়ে টাকার পরিমাণ লিখুন')}
    ${flashHtml()}<div id="err"></div>
    <form id="f" class="stack">
      <div class="amount-box"><span>টাকার পরিমাণ</span>
        <div class="amount-in"><input name="amount" inputmode="decimal" value="${e.amount}" placeholder="0.00" required autocomplete="off"><em>${h(CFG.CURRENCY)}</em></div></div>
      <div class="panel">
        <div class="field"><span>খাত বেছে নিন</span></div>
        <div class="cat-pick">${usable.map(c => `<label style="--c:${catColor(cats, c.id)}"><input type="radio" name="category_id" value="${c.id}" ${+e.category_id === c.id ? 'checked' : ''} required>
          <span class="cp-ico">${h(catIcon(c))}</span><span class="cp-name">${h(c.name)}</span></label>`).join('')}</div>
      </div>
      <div class="panel stack">
        <label class="field"><span>📅 তারিখ</span><input type="date" name="expense_date" value="${e.expense_date}" max="${today()}" required></label>
        <label class="field"><span>📝 বিবরণ</span><textarea name="description" rows="2" maxlength="500" placeholder="কী বাবদ খরচ, কোথায়, কার জন্য">${h(e.description)}</textarea></label>
        <label class="drop"><input type="file" name="receipt" accept="image/*,application/pdf">
          <span class="drop-ico">📷</span><span><b id="fname">রসিদের ছবি যোগ করুন</b><small>${e.receipt_path ? 'আগের রসিদ আছে — নতুন দিলে বদলে যাবে' : 'ঐচ্ছিক · ৮ MB পর্যন্ত'}</small></span></label>
      </div>
      <div class="form-actions"><button class="btn btn-lg" name="go" value="list">✓ সেভ করুন</button>
        ${id ? '' : '<button class="btn ghost" name="go" value="again">সেভ করে আরেকটি</button>'}
        <a href="#/expenses" class="btn plain">বাতিল</a></div>
    </form></div>`;
  const form = document.getElementById('f');
  form.receipt.onchange = () => { document.getElementById('fname').textContent = form.receipt.files[0]?.name || 'রসিদের ছবি যোগ করুন'; };
  form.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(form), btns = form.querySelectorAll('button');
    const showErr = m => { document.getElementById('err').innerHTML = `<div class="flash err">${h(m)}</div>`; btns.forEach(b => b.disabled = false); scrollTo(0, 0); };
    const amount = Number(String(fd.get('amount')).replace(/,/g, ''));
    const rec = { expense_date: fd.get('expense_date'), category_id: Number(fd.get('category_id')), amount, description: fd.get('description').trim() };
    if (!isDate(rec.expense_date)) return showErr('সঠিক তারিখ দিন।');
    if (rec.expense_date > today()) return showErr('ভবিষ্যতের তারিখে খরচ দেওয়া যাবে না।');
    if (!(amount > 0) || amount > 1e9) return showErr('সঠিক টাকার পরিমাণ দিন।');
    if (!rec.category_id) return showErr('একটি খাত বেছে নিন।');
    const file = fd.get('receipt');
    if (file && file.size > 8 * 1024 * 1024) return showErr('ফাইল ৮ MB এর বেশি বড়।');
    btns.forEach(b => b.disabled = true);
    try {
      if (file && file.size) rec.receipt_path = await api.uploadReceipt(file, ME.id);
      if (id) {
        await api.updateExpense(id, rec);
        if (rec.receipt_path && old.receipt_path) api.removeReceipt(old.receipt_path);
        flash('ok', 'খরচ আপডেট হয়েছে।');
      } else {
        await api.addExpense(rec);
        flash('ok', `খরচ যোগ হয়েছে: ${money(amount)} ${CFG.CURRENCY}`);
      }
      go(ev.submitter?.value === 'again' ? '#/new' : '#/expenses?date=' + rec.expense_date);
    } catch (e) { showErr(errText(e)); }
  };
};

pages.password = async () => {
  $app.innerHTML = `<div class="form-wrap">${pageHead('পাসওয়ার্ড পরিবর্তন', 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন')}
    ${flashHtml()}<div id="err"></div>
    <form id="f" class="panel stack">
      <div class="big-ico">🔑</div>
      <label class="field"><span>নতুন পাসওয়ার্ড</span><input type="password" name="a" minlength="6" required autocomplete="new-password"></label>
      <label class="field"><span>আবার নতুন পাসওয়ার্ড</span><input type="password" name="b" minlength="6" required autocomplete="new-password"></label>
      <button class="btn btn-lg">পরিবর্তন করুন</button></form></div>`;
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    if (fd.get('a') !== fd.get('b')) return document.getElementById('err').innerHTML = '<div class="flash err">দুইটি পাসওয়ার্ড মিলছে না।</div>';
    try { await api.changePassword(fd.get('a')); flash('ok', 'পাসওয়ার্ড পরিবর্তন হয়েছে।'); go('#/'); }
    catch (e) { document.getElementById('err').innerHTML = `<div class="flash err">${h(errText(e))}</div>`; }
  };
};

// ---------- এডমিন: রিপোর্ট ----------
function reportFilter(q) {
  const type = q.get('type');
  if (type === 'month') { const m = isMonth(q.get('month')) ? q.get('month') : thisMonth(); return { type, f: { month: m }, label: `মাসিক রিপোর্ট: ${m}`, slug: `month-${m}` }; }
  if (type === 'range' && isDate(q.get('from')) && isDate(q.get('to'))) return { type, f: { from: q.get('from'), to: q.get('to') }, label: `রিপোর্ট: ${q.get('from')} থেকে ${q.get('to')}`, slug: `${q.get('from')}_to_${q.get('to')}` };
  const d = isDate(q.get('date')) ? q.get('date') : today();
  return { type: 'day', f: { date: d }, label: `দৈনিক রিপোর্ট: ${d}`, slug: `day-${d}` };
}
async function reportData(q) {
  const r = reportFilter(q);
  if (q.get('category')) r.f.categoryId = q.get('category');
  r.rows = (await api.expenses(r.f)).reverse();
  r.total = total(r.rows);
  r.byCategory = sumBy(r.rows, catName);
  r.byUser = sumBy(r.rows, userName);
  r.byDate = sumBy(r.rows, x => x.expense_date).sort((a, b) => a.name.localeCompare(b.name));
  return r;
}

pages.reports = async () => {
  const cats = await api.categories();
  const catSel = `<label class="field"><span>খাত</span><select name="category"><option value="">সব খাত</option>${options(cats, '')}</select></label>`;
  const btns = `<div class="rep-btns"><button class="btn xl-btn" name="out" value="excel">⬇ Excel</button><button class="btn pdf-btn" name="out" value="pdf">📄 PDF</button></div>`;
  const card = (ico, c, title, sub, body) => `<form class="rep-card" style="--c:${c}"><div class="rep-head"><span class="rep-ico">${ico}</span><div><b>${title}</b><small>${sub}</small></div></div>${body}${catSel}${btns}</form>`;
  $app.innerHTML = `${flashHtml()}${pageHead('রিপোর্ট', 'Excel বা PDF হিসেবে ডাউনলোড করুন')}
  <div class="rep-grid">
    ${card('📅', '#2a78d6', 'দৈনিক রিপোর্ট', 'একটি দিনের সব খরচ', `<input type="hidden" name="type" value="day"><label class="field"><span>তারিখ</span><input type="date" name="date" value="${today()}" required></label>`)}
    ${card('🗓️', '#1baf7a', 'মাসিক রিপোর্ট', 'পুরো মাসের হিসাব', `<input type="hidden" name="type" value="month"><label class="field"><span>মাস</span><input type="month" name="month" value="${thisMonth()}" required></label>`)}
    ${card('📆', '#6250d6', 'নির্দিষ্ট সময়', 'যেকোনো তারিখ থেকে তারিখ', `<input type="hidden" name="type" value="range"><div class="two"><label class="field"><span>শুরু</span><input type="date" name="from" value="${thisMonth()}-01" required></label><label class="field"><span>শেষ</span><input type="date" name="to" value="${today()}" required></label></div>`)}
  </div>
  <div class="tip-box">💡 Excel ফাইলে সব খরচ, খাত অনুযায়ী, দিন অনুযায়ী ও সদস্য অনুযায়ী আলাদা শিট থাকবে। PDF চাপলে রিপোর্ট খুলবে, সেখান থেকে "PDF হিসেবে সেভ করুন" চাপুন।</div>`;
  $app.querySelectorAll('form').forEach(form => form.onsubmit = async ev => {
    ev.preventDefault();
    const q = new URLSearchParams(new FormData(form));
    const out = ev.submitter?.value || 'excel';
    q.delete('out'); if (!q.get('category')) q.delete('category');
    if (out === 'pdf') return go('#/print?' + q);
    try { await downloadExcel(await reportData(q)); } catch (e) { alert(errText(e)); }
  });
};

async function downloadExcel(r) {
  const wb = new ExcelJS.Workbook();
  wb.creator = CFG.COMPANY;
  const head = (ws, title, cols) => {
    ws.columns = cols;
    ws.spliceRows(1, 0, [CFG.COMPANY], [title], []);
    ws.getRow(1).font = { bold: true, size: 14 };
    ws.getRow(2).font = { bold: true, size: 12 };
    const hr = ws.getRow(4);
    hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hr.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F5F8B' } }; });
  };
  const ws = wb.addWorksheet('Expenses');
  head(ws, r.label, [
    { header: 'Date / তারিখ', key: 'date', width: 14 },
    { header: 'Category / খাত', key: 'cat', width: 28 },
    { header: 'Description / বিবরণ', key: 'desc', width: 40 },
    { header: 'Entered by / যিনি দিয়েছেন', key: 'user', width: 22 },
    { header: `Amount (${CFG.CURRENCY})`, key: 'amount', width: 16 },
  ]);
  r.rows.forEach(x => ws.addRow({ date: x.expense_date, cat: catName(x), desc: x.description, user: userName(x), amount: Number(x.amount) }));
  ws.addRow({ desc: 'TOTAL / মোট', amount: r.total }).font = { bold: true };
  ws.getColumn('amount').numFmt = '#,##0.00';
  const sheet = (name, title, list) => {
    const s = wb.addWorksheet(name);
    head(s, `${r.label} — ${title}`, [{ header: title, key: 'name', width: 32 }, { header: `Total (${CFG.CURRENCY})`, key: 'total', width: 18 }]);
    list.forEach(x => s.addRow(x));
    s.addRow({ name: 'TOTAL / মোট', total: r.total }).font = { bold: true };
    s.getColumn('total').numFmt = '#,##0.00';
  };
  sheet('By Category', 'খাত অনুযায়ী', r.byCategory);
  if (r.type !== 'day') sheet('By Day', 'দিন অনুযায়ী', r.byDate);
  sheet('By Member', 'সদস্য অনুযায়ী', r.byUser);
  const blob = new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `MTC-expenses-${r.slug}.xlsx` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

pages.print = async () => {
  const q = params();
  const r = await reportData(q);
  const C = h(CFG.CURRENCY);
  const sumTable = (title, label, list) => `<h3>${title}</h3><table><thead><tr><th>${label}</th><th class="r">মোট (${C})</th></tr></thead><tbody>
    ${list.map(c => `<tr><td>${h(c.name)}</td><td class="r">${money(c.total)}</td></tr>`).join('')}
    <tr class="tot"><td>মোট</td><td class="r">${money(r.total)}</td></tr></tbody></table>`;
  $app.innerHTML = `<div class="noprint row"><button class="btn" onclick="window.print()">PDF হিসেবে সেভ / প্রিন্ট করুন</button>
      <button class="btn ghost" id="xl">Excel ডাউনলোড</button><a href="#/reports">← রিপোর্ট পাতা</a></div>
    <header class="phead"><img class="logo-img" src="icons/logo.png" alt="MTC"><div><h1>${h(CFG.COMPANY)}</h1><h2>${h(r.label)}</h2>
      <p class="muted">মোট খরচ: <b>${money(r.total)} ${C}</b> · ${r.rows.length}টি এন্ট্রি</p></div></header>
    ${sumTable('খাত অনুযায়ী সারাংশ', 'খাত', r.byCategory)}
    ${r.type !== 'day' && r.byDate.length ? sumTable('দিন অনুযায়ী সারাংশ', 'তারিখ', r.byDate) : ''}
    <h3>বিস্তারিত খরচ</h3><table><thead><tr><th>তারিখ</th><th>খাত</th><th>বিবরণ</th><th>যিনি দিয়েছেন</th><th class="r">টাকা (${C})</th></tr></thead><tbody>
    ${r.rows.map(x => `<tr><td class="nw">${x.expense_date}</td><td>${h(catName(x))}</td><td>${h(x.description)}</td><td>${h(userName(x))}</td><td class="r">${money(x.amount)}</td></tr>`).join('')
      || '<tr><td colspan="5" class="muted">কোনো খরচ নেই।</td></tr>'}
    <tr class="tot"><td colspan="4">মোট</td><td class="r">${money(r.total)}</td></tr></tbody></table>
    <div class="sign"><div>প্রস্তুতকারী</div><div>অনুমোদনকারী</div></div>`;
  document.getElementById('xl').onclick = () => downloadExcel(r);
};

// ---------- এডমিন: সদস্য ও খাত ----------
const toLoginEmail = u => { u = u.trim().toLowerCase(); return u.includes('@') ? u : u + '@' + CFG.LOGIN_EMAIL_DOMAIN; };
const shortLogin = e => e && e.endsWith('@' + CFG.LOGIN_EMAIL_DOMAIN) ? e.slice(0, -CFG.LOGIN_EMAIL_DOMAIN.length - 1) : (e || '');
const NEED_SQL_DEL = 'এই সুবিধা চালু করতে Supabase SQL Editor-এ "supabase/deleted-history.sql" ফাইলটা একবার চালাতে হবে।';
const NEED_SQL = 'এই সুবিধা চালু করতে Supabase SQL Editor-এ "supabase/admin-users.sql" ফাইলটা একবার চালাতে হবে।';

pages.members = async () => {
  const users = await api.profiles();
  let emails = {}, sqlReady = true;
  try { (await api.adminListUsers()).forEach(u => emails[u.id] = u); } catch (e) { sqlReady = false; }
  const dis = sqlReady ? '' : 'disabled';
  $app.innerHTML = `${flashHtml()}${pageHead('সদস্য', `${users.filter(u => u.active).length} জন সক্রিয় · মোট ${users.length} জন`)}
  ${sqlReady ? '' : `<div class="flash err">${NEED_SQL}</div>`}
  <details class="add-box" ${users.length < 2 ? 'open' : ''}>
    <summary><span class="add-ico">＋</span><span><b>নতুন সদস্য যোগ করুন</b><small>নাম, ইউজারনেম আর পাসওয়ার্ড দিন</small></span></summary>
    <form id="add" class="add-form">
      <label class="field"><span>নাম</span><input name="full_name" required placeholder="যেমন: রহিম উদ্দিন"></label>
      <label class="field"><span>ইউজারনেম</span><input name="login" required autocomplete="off" autocapitalize="none" placeholder="যেমন: rahim"></label>
      <label class="field"><span>পাসওয়ার্ড</span><input name="password" required minlength="6" autocomplete="new-password" placeholder="কমপক্ষে ৬ অক্ষর"></label>
      <label class="field"><span>ভূমিকা</span><select name="role"><option value="member">সদস্য</option><option value="admin">এডমিন</option></select></label>
      <button class="btn" ${dis}>যোগ করুন</button>
      <p class="muted small full">ইউজারনেম ইংরেজি ছোট অক্ষরে, ফাঁকা জায়গা ছাড়া। চাইলে পুরো ইমেইলও দিতে পারেন।</p>
    </form>
  </details>
  <div class="m-list">${users.map(u => { const me = u.id === ME.id, em = emails[u.id]; return `<div class="m-card ${u.active ? '' : 'off'}" data-id="${u.id}">
    <div class="m-top"><span class="avatar lg">${h((u.full_name || '?').trim().charAt(0))}</span>
      <div class="m-id"><input name="full_name" value="${h(u.full_name)}" aria-label="নাম">
        <small>@${h(shortLogin(em?.email)) || '—'} ${em && !em.last_sign_in_at ? '· <i>এখনো লগইন করেননি</i>' : ''}</small></div>
      <span class="badge ${u.role === 'admin' ? 'admin' : ''}">${u.role === 'admin' ? 'এডমিন' : 'সদস্য'}</span></div>
    <div class="m-row">
      <label class="field inline"><span>ভূমিকা</span><select name="role" ${me ? 'disabled' : ''}><option value="member">সদস্য</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>এডমিন</option></select></label>
      <div class="sw-wrap"><span>সক্রিয়</span>${switchEl('active', u.active, me ? 'disabled' : '')}</div>
      <button class="btn sm" data-save>সেভ</button></div>
    <div class="m-row pw"><input name="newpw" placeholder="🔒 নতুন পাসওয়ার্ড" autocomplete="new-password" ${dis}><button class="btn sm ghost" data-pw ${dis}>বদলান</button></div>
  </div>`; }).join('')}</div>
  <div class="tip-box">💡 কাউকে বাদ দিতে "সক্রিয়" বন্ধ করে সেভ করুন। তিনি আর লগইন করতে পারবেন না, কিন্তু আগের খরচের হিসাব থেকে যাবে।</div>`;

  document.getElementById('add').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target), login = String(fd.get('login')).trim();
    if (/\s/.test(login)) { flash('err', 'ইউজারনেমে ফাঁকা জায়গা দেওয়া যাবে না।'); return render(); }
    const name = String(fd.get('full_name')).trim();
    try {
      await api.adminCreateUser(toLoginEmail(login), String(fd.get('password')), name, fd.get('role'));
      flash('ok', `${name} যোগ হয়েছে। লগইন: ইউজারনেম "${login}" আর আপনার দেওয়া পাসওয়ার্ড।`);
    } catch (e) { flash('err', errText(e)); }
    render();
  };
  $app.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const card = b.closest('.m-card'), id = card.dataset.id;
    const fields = { full_name: card.querySelector('[name=full_name]').value.trim() };
    if (id !== ME.id) { fields.role = card.querySelector('[name=role]').value; fields.active = card.querySelector('[name=active]').checked; }
    try { await api.updateProfile(id, fields); flash('ok', `${fields.full_name} আপডেট হয়েছে।`); } catch (e) { flash('err', errText(e)); }
    render();
  });
  $app.querySelectorAll('[data-pw]').forEach(b => b.onclick = async () => {
    const card = b.closest('.m-card'), pw = card.querySelector('[name=newpw]').value, name = card.querySelector('[name=full_name]').value;
    if (pw.length < 6) { flash('err', 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return render(); }
    try { await api.adminSetPassword(card.dataset.id, pw); flash('ok', `${name}-এর পাসওয়ার্ড বদলানো হয়েছে।`); } catch (e) { flash('err', errText(e)); }
    render();
  });
};

pages.categories = async () => {
  const cats = await api.categories();
  $app.innerHTML = `${flashHtml()}${pageHead('খরচের খাত', `${cats.filter(c => c.active).length}টি সক্রিয় খাত`)}
  <form id="add" class="add-inline"><span class="add-ico">＋</span><input name="name" required placeholder="নতুন খাতের নাম"><button class="btn">যোগ করুন</button></form>
  <div class="c-list">${cats.map(c => `<div class="c-card ${c.active ? '' : 'off'}" data-id="${c.id}" style="--c:${catColor(cats, c.id)}">
    <input class="c-ico" name="icon" value="${h(catIcon(c))}" maxlength="8" aria-label="আইকন">
    <input class="c-name" name="name" value="${h(c.name)}" aria-label="খাতের নাম">
    <div class="c-actions">${switchEl('active', c.active)}<button class="btn sm" data-save>সেভ</button><button class="ia" data-delcat title="মুছুন">🗑️</button></div>
  </div>`).join('')}</div>
  <div class="tip-box">💡 আইকনের ঘরে চাপ দিয়ে মোবাইলের কীবোর্ড থেকে যেকোনো ইমোজি দিন (যেমন 🍛 ⛽ 🧱 👷 🚜 🏢 🔧 💡 🚚), তারপর সেভ চাপুন।<br>
    যে খাতে আগে খরচ লেখা হয়েছে সেটা মোছা যায় না — সুইচ বন্ধ করে সেভ করুন, নতুন খরচে আর দেখাবে না।</div>`;
  $app.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const tr = b.closest('.c-card');
    try {
      await api.updateCategory(tr.dataset.id, { name: tr.querySelector('[name=name]').value.trim(), icon: tr.querySelector('[name=icon]').value.trim() || null, active: tr.querySelector('[name=active]').checked });
      flash('ok', 'খাত আপডেট হয়েছে।');
    } catch (e) { flash('err', errText(e)); }
    render();
  });
  $app.querySelectorAll('[data-delcat]').forEach(b => b.onclick = async () => {
    const tr = b.closest('.c-card'), name = tr.querySelector('[name=name]').value;
    if (!confirm(`"${name}" খাতটি মুছে ফেলবেন?`)) return;
    try { await api.deleteCategory(tr.dataset.id); flash('ok', `খাত মুছে ফেলা হয়েছে: ${name}`); }
    catch (e) {
      flash('err', /foreign key|violates/i.test(e?.message || '') ? `"${name}" খাতে আগে খরচ লেখা আছে, তাই মোছা যাবে না। এর বদলে সুইচ বন্ধ করে সেভ করুন।` : errText(e));
    }
    render();
  });
  document.getElementById('add').onsubmit = async ev => {
    ev.preventDefault();
    const name = new FormData(ev.target).get('name').trim();
    try { await api.addCategory(name); flash('ok', `খাত যোগ হয়েছে: ${name}`); } catch (e) { flash('err', errText(e)); }
    render();
  };
};

// ---------- রাউটার ----------
const ROUTES = [
  [/^\/?$/, () => pages.dashboard()],
  [/^\/expenses$/, () => pages.expenses()],
  [/^\/new$/, () => pages.form(null)],
  [/^\/edit\/(\d+)$/, m => pages.form(Number(m[1]))],
  [/^\/password$/, () => pages.password()],
  [/^\/more$/, () => pages.more()],
  [/^\/reports$/, () => pages.reports(), true],
  [/^\/print$/, () => pages.print(), true],
  [/^\/members$/, () => pages.members(), true],
  [/^\/categories$/, () => pages.categories(), true],
  [/^\/deleted$/, () => pages.deleted(), true],
];

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  list: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
};
const svgI = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg>`;

function renderNav(route) {
  const link = (href, text, cls = '') => `<a href="${href}" class="${cls} ${route === href.slice(1) ? 'on' : ''}">${text}</a>`;
  document.getElementById('nav').innerHTML = link('#/', 'ড্যাশবোর্ড') + link('#/expenses', 'সব খরচ') + link('#/new', '+ খরচ যোগ', 'btn-nav') +
    (isAdmin() ? link('#/reports', 'রিপোর্ট') + link('#/members', 'সদস্য') + link('#/categories', 'খাত') + link('#/deleted', 'মুছে ফেলা') : '');
  document.getElementById('me-name').innerHTML = h(ME.full_name) + (isAdmin() ? ' <span class="tag">এডমিন</span>' : '');
  const tab = (href, icon, text, on) => `<a href="${href}" class="${on ? 'on' : ''}">${svgI(icon)}<span>${text}</span></a>`;
  const moreOn = ['/more', '/members', '/categories', '/password', '/deleted'].includes(route);
  document.getElementById('tabbar').innerHTML =
    tab('#/', 'home', 'হোম', route === '/') + tab('#/expenses', 'list', 'খরচ', route === '/expenses') +
    `<a href="#/new" class="tab-add ${route === '/new' ? 'on' : ''}" aria-label="খরচ যোগ">${svgI('plus')}</a>` +
    (isAdmin() ? tab('#/reports', 'chart', 'রিপোর্ট', route === '/reports' || route === '/print') : tab('#/password', 'chart', 'পাসওয়ার্ড', route === '/password')) +
    tab('#/more', 'more', 'আরও', moreOn);
}

pages.deleted = async () => {
  let rows;
  try { rows = await api.deletedExpenses(); }
  catch (e) { $app.innerHTML = `${pageHead('মুছে ফেলা খরচ', 'সদস্যরা যেসব খরচ মুছেছে')}<div class="flash err">${h(errText(e))}</div>`; return; }
  const cats = await api.categories(), C = h(CFG.CURRENCY);
  const when = ts => { const d = new Date(ts); return bnDate(d.toLocaleDateString('en-CA', { timeZone: CFG.TIMEZONE })) + ', ' + d.toLocaleTimeString('bn-BD', { timeZone: CFG.TIMEZONE, hour: 'numeric', minute: '2-digit' }); };
  $app.innerHTML = `${flashHtml()}
  ${pageHead('মুছে ফেলা খরচ', 'এগুলো কোনো হিসাব বা রিপোর্টে গোনা হয় না। শুধু এডমিন দেখতে পান।')}
  <section class="sum-hero"><div><span>মুছে ফেলা মোট</span><b>${money(total(rows))} <small>${C}</small></b></div>
    <div class="sum-meta"><span>${rows.length}</span>টি এন্ট্রি</div></section>
  ${rows.length ? `<ul class="tx-list">${rows.map(r => { const c = cats.find(x => x.id === r.category_id); return `<li class="tx del-tx">
    <span class="r-ico" style="--c:${catColor(cats, r.category_id)}">${h(catIcon(c || r.category))}</span>
    <div class="r-mid"><b>${h(r.description || catName(r))}</b><span>${bnDate(r.expense_date)} · ${h(catName(r))} · ${h(userName(r))}</span>
      <span class="del-by">🗑️ ${h(r.deleter?.full_name || '?')} মুছেছেন · ${when(r.deleted_at)}</span></div>
    <div class="tx-right"><b class="r-amt">${money(r.amount)}</b>
      <div class="tx-actions">
        ${r.receipt_path ? `<button class="ia" data-receipt="${h(r.receipt_path)}" title="রসিদ দেখুন">🧾</button>` : ''}
        <button class="ia" data-restore="${r.id}" title="ফেরত আনুন">↩️</button>
        <button class="ia" data-purge="${r.id}" title="স্থায়ীভাবে মুছুন">❌</button>
      </div></div></li>`; }).join('')}</ul>`
  : `<div class="empty"><span>✅</span><b>কেউ কোনো খরচ মোছেনি</b></div>`}`;
  $app.querySelectorAll('[data-receipt]').forEach(b => b.onclick = async () => {
    const w = window.open('', '_blank');
    try { w.location = await api.receiptUrl(b.dataset.receipt); } catch (e) { w.close(); alert(errText(e)); }
  });
  $app.querySelectorAll('[data-restore]').forEach(b => b.onclick = async () => {
    try { await api.restoreExpense(Number(b.dataset.restore)); flash('ok', 'খরচটি আবার হিসাবে ফেরত আনা হয়েছে।'); }
    catch (e) { flash('err', errText(e)); }
    render();
  });
  $app.querySelectorAll('[data-purge]').forEach(b => b.onclick = async () => {
    if (!confirm('স্থায়ীভাবে মুছে ফেলবেন? এটা আর ফেরত আনা যাবে না।')) return;
    const r = rows.find(x => String(x.id) === b.dataset.purge);
    try {
      await api.purgeExpense(r.id);
      if (r.receipt_path) api.removeReceipt(r.receipt_path);
      flash('ok', 'খরচটি স্থায়ীভাবে মুছে ফেলা হয়েছে।');
    } catch (e) { flash('err', errText(e)); }
    render();
  });
};

// ---------- রাতের রিমাইন্ডার (push notification) ----------
const b64ToU8 = s => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, c => c.charCodeAt(0)); };
const PUSH = {
  supported: () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,
  iosNeedsInstall: () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !navigator.standalone && !matchMedia('(display-mode: standalone)').matches,
  async current() {
    if (!PUSH.supported()) return null;
    const r = await navigator.serviceWorker.getRegistration();
    return r ? r.pushManager.getSubscription() : null;
  },
  async enable() {
    if (PUSH.iosNeedsInstall()) throw new Error('iPhone-এ আগে Safari-র শেয়ার বাটন → "Add to Home Screen" দিয়ে অ্যাপটা যোগ করুন, তারপর সেখান থেকে খুলে চালু করুন।');
    if (!PUSH.supported()) throw new Error('এই ব্রাউজারে নোটিফিকেশন চলে না। Chrome দিয়ে খুলুন।');
    const key = await api.pushPublicKey();
    if (!key) throw new Error('নোটিফিকেশন এখনো সেটআপ হয়নি। এডমিনকে GitHub-এ "Nightly reminder" একবার setup মোডে চালাতে হবে।');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('নোটিফিকেশনের অনুমতি দেওয়া হয়নি। ব্রাউজারের ঠিকানার পাশের 🔒 চিহ্ন → Notifications → Allow করুন।');
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    await api.savePush(sub);
  },
  async disable() {
    const sub = await PUSH.current();
    if (sub) { await api.deletePush(sub.endpoint).catch(() => {}); await sub.unsubscribe(); }
  },
};
async function bindPushCard() {
  const st = document.getElementById('push-st'), btn = document.getElementById('push-btn');
  if (!st) return;
  const on = !!(await PUSH.current().catch(() => null)) && Notification.permission === 'granted';
  st.textContent = on ? 'চালু আছে · প্রতিদিন রাত ১১টায়' : 'বন্ধ · চালু করলে প্রতিদিন রাত ১১টায় মনে করিয়ে দেবে';
  btn.textContent = on ? 'বন্ধ করুন' : 'চালু করুন';
  btn.className = 'btn sm' + (on ? ' ghost' : '');
  btn.disabled = false;
  btn.onclick = async () => {
    btn.disabled = true;
    try { on ? await PUSH.disable() : await PUSH.enable(); flash('ok', on ? 'রিমাইন্ডার বন্ধ করা হয়েছে।' : 'রিমাইন্ডার চালু হয়েছে। প্রতিদিন রাত ১১টায় নোটিফিকেশন আসবে।'); }
    catch (e) { flash('err', errText(e)); }
    render();
  };
}
const pushCardHtml = () => `<div class="push-card"><span class="more-ico">🔔</span><span><b>রাতের রিমাইন্ডার</b><small id="push-st">দেখা হচ্ছে…</small></span><button class="btn sm" id="push-btn" disabled>…</button></div>`;
function pushBanner() {
  let dismissed = false;
  try { dismissed = localStorage.getItem('mtc-push-dismiss') === '1'; } catch (_) {}
  if (dismissed || !PUSH.supported() || Notification.permission !== 'default' || document.querySelector('.push-card')) return;
  const d = document.createElement('div');
  d.className = 'push-banner';
  d.innerHTML = pushCardHtml() + '<button class="x" aria-label="বন্ধ">×</button>';
  $app.prepend(d);
  d.querySelector('.x').onclick = () => { try { localStorage.setItem('mtc-push-dismiss', '1'); } catch (_) {} d.remove(); };
  bindPushCard();
}

pages.more = async () => {
  const item = (href, ico, title, sub) => `<a class="more-item" href="${href}"><span class="more-ico">${ico}</span><span><b>${title}</b><small>${sub}</small></span><span class="chev">›</span></a>`;
  $app.innerHTML = `${flashHtml()}
  <div class="profile-card"><span class="avatar lg">${h((ME.full_name || '?').trim().charAt(0))}</span>
    <div><b>${h(ME.full_name)}</b><small>${isAdmin() ? 'এডমিন' : 'সদস্য'} · ${h(CFG.COMPANY)}</small></div></div>
  <div class="more-list">
    ${isAdmin() ? item('#/reports', '📊', 'রিপোর্ট', 'দৈনিক/মাসিক Excel ও PDF') + item('#/members', '👥', 'সদস্য', 'সদস্য যোগ, পাসওয়ার্ড বদল') + item('#/categories', '🏷️', 'খাত', 'খাত যোগ, আইকন, বন্ধ করা') + item('#/deleted', '🗑️', 'মুছে ফেলা খরচ', 'কে কী মুছেছে, ফেরত আনুন') : ''}
    ${item('#/password', '🔑', 'পাসওয়ার্ড পরিবর্তন', 'নিজের পাসওয়ার্ড বদলান')}
  </div>
  <div class="more-list">${pushCardHtml()}</div>
  <button class="btn ghost full" id="lo">লগআউট</button>`;
  bindPushCard();
  document.getElementById('lo').onclick = () => document.getElementById('logout').click();
};

async function render() {
  if (!ME) return;
  const route = (location.hash.slice(1) || '/').split('?')[0] || '/';
  renderNav(route);
  for (const [re, fn, adminOnly] of ROUTES) {
    const m = route.match(re);
    if (!m) continue;
    if (adminOnly && !isAdmin()) { $app.innerHTML = '<div class="card"><h2>শুধু এডমিন এই পাতা দেখতে পারবেন।</h2></div>'; return; }
    try { await fn(m); window.scrollTo(0, 0); if (route === '/') pushBanner(); }
    catch (e) { console.error(e); $app.innerHTML = `<div class="card"><h2>সমস্যা হয়েছে</h2><p>${h(errText(e))}</p><p><a href="#/">ড্যাশবোর্ডে ফিরে যান</a></p></div>`; }
    return;
  }
  $app.innerHTML = '<div class="card"><h2>পাতাটি পাওয়া যায়নি।</h2><p><a href="#/">ড্যাশবোর্ডে ফিরে যান</a></p></div>';
}

async function boot() {
  const top = document.getElementById('top');
  if (CFG.SUPABASE_URL.includes('YOUR-PROJECT')) {
    $app.innerHTML = '<div class="card narrow"><h2>সেটআপ বাকি</h2><p><code>config.js</code> ফাইলে আপনার Supabase URL আর anon key বসান। README.md দেখুন।</p></div>';
    return;
  }
  const s = await api.session();
  ME = s ? await api.me() : null;
  if (s && (!ME || !ME.active)) {
    await api.signOut(); ME = null;
    flash('err', 'আপনার অ্যাকাউন্ট সক্রিয় নেই। এডমিনের সাথে যোগাযোগ করুন।');
  }
  top.classList.toggle('hidden', !ME);
  document.getElementById('tabbar').classList.toggle('hidden', !ME);
  document.body.classList.toggle('authed', !!ME);
  if (!ME) return pages.login();
  // এই ফোনে নোটিফিকেশন চালু থাকলে বর্তমান ইউজারের নামে আবার সেভ (ইউজার বদলালেও নাম ঠিক থাকে)
  if (PUSH.supported() && Notification.permission === "granted") PUSH.current().then(s => s && api.savePush(s)).catch(() => {});
  render();
}

document.getElementById('logout').onclick = async () => {
  const ps = await PUSH.current().catch(() => null);
  if (ps) await api.deletePush(ps.endpoint).catch(() => {}); // অন্য কেউ এই ফোনে লগইন করলে তার নামে নোটিফিকেশন যাবে
  await api.signOut(); ME = null; location.hash = '#/'; boot(); };
window.addEventListener('hashchange', render);
boot();
