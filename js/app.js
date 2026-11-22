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
  $app.innerHTML = `<div class="login"><div class="card">
    <div class="login-brand"><span class="logo big">MTC</span><h1>খরচ হিসাব</h1><p class="muted">${h(CFG.COMPANY)}</p></div>
    ${flashHtml()}
    <form id="f" class="stack">
      <label>ইউজারনেম বা ইমেইল<input name="u" autocomplete="username" required autofocus></label>
      <label>পাসওয়ার্ড<input name="p" type="password" autocomplete="current-password" required></label>
      <button class="btn">লগইন</button>
    </form></div></div>`;
  document.getElementById('f').onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    let u = fd.get('u').trim().toLowerCase();
    if (!u.includes('@')) u += '@' + CFG.LOGIN_EMAIL_DOMAIN;
    try { await api.signIn(u, fd.get('p')); await boot(); }
    catch (e) { flash('err', errText(e)); pages.login(); }
  };
};

pages.dashboard = async () => {
  const p = params();
  const month = isMonth(p.get('month')) ? p.get('month') : thisMonth();
  const t = today();
  const [rows, months] = await Promise.all([api.expenses({ month }), api.monthlyTotals()]);
  const todayRows = t.startsWith(month) ? rows.filter(r => r.expense_date === t) : await api.expenses({ date: t });
  const monthTotal = total(rows), todayTotal = total(todayRows);
  const daily = Array.from({ length: daysInMonth(month) }, (_, i) => {
    const d = `${month}-${String(i + 1).padStart(2, '0')}`;
    return { date: d, total: total(rows.filter(r => r.expense_date === d)) };
  });
  const maxDaily = Math.max(1, ...daily.map(d => d.total));
  const pastDays = daily.filter(d => d.date <= t).length;
  $app.innerHTML = `${flashHtml()}
  <div class="pagehead"><h1>ড্যাশবোর্ড</h1>
    <label>মাস <input type="month" id="m" value="${month}"></label></div>
  <div class="stats">
    <div class="stat"><span>আজকের খরচ (${t})</span><b>${money(todayTotal)} <small>${h(CFG.CURRENCY)}</small></b><em>${todayRows.length}টি এন্ট্রি</em></div>
    <div class="stat accent"><span>এই মাসের মোট (${month})</span><b>${money(monthTotal)} <small>${h(CFG.CURRENCY)}</small></b><em>${rows.length}টি এন্ট্রি</em></div>
    <div class="stat"><span>দৈনিক গড় (${month})</span><b>${money(pastDays ? monthTotal / pastDays : 0)} <small>${h(CFG.CURRENCY)}</small></b><em>আজ পর্যন্ত দিনের হিসাবে</em></div>
  </div>
  <section class="card"><h2>দৈনিক খরচ — ${month}</h2>
    <div class="bars">${daily.map(d => `<a class="bar ${d.date === t ? 'today' : ''}" href="#/expenses?date=${d.date}" title="${d.date}: ${money(d.total)} ${h(CFG.CURRENCY)}">
      <i style="height:${(d.total / maxDaily * 100).toFixed(1)}%"></i><span>${+d.date.slice(8)}</span></a>`).join('')}</div>
    <p class="muted small">যেকোনো দিনের বারে ক্লিক করলে সেই দিনের সব খরচ দেখা যাবে।</p></section>
  <div class="grid2">
    <section class="card"><h2>খাত অনুযায়ী — ${month}</h2>
      ${rows.length ? hbars(sumBy(rows, catName), monthTotal) : '<p class="muted">এই মাসে কোনো খরচ নেই।</p>'}</section>
    <section class="card"><h2>আজ খাত অনুযায়ী</h2>
      ${todayRows.length ? hbars(sumBy(todayRows, catName), todayTotal) : '<p class="muted">আজ এখনো কোনো খরচ যোগ হয়নি।</p>'}
      <h2 class="mt">সদস্য অনুযায়ী — ${month}</h2>
      ${sumBy(rows, userName).map(c => `<div class="hrow"><span>${h(c.name)}</span><b>${money(c.total)}</b></div>`).join('') || '<p class="muted">—</p>'}</section>
  </div>
  <section class="card"><h2>মাসভিত্তিক মোট</h2><table>
    <thead><tr><th>মাস</th><th class="r">এন্ট্রি</th><th class="r">মোট (${h(CFG.CURRENCY)})</th></tr></thead><tbody>
    ${months.map(m => `<tr><td><a href="#/?month=${m.month}">${m.month}</a></td><td class="r">${m.entries}</td><td class="r">${money(m.total)}</td></tr>`).join('')
      || '<tr><td colspan="3" class="muted">এখনো কোনো খরচ নেই।</td></tr>'}</tbody></table></section>`;
  document.getElementById('m').onchange = e => go('#/?month=' + e.target.value);
};

pages.expenses = async () => {
  const p = params();
  const f = { date: isDate(p.get('date')) ? p.get('date') : '', month: '', categoryId: p.get('category') || '', userId: p.get('user') || '' };
  if (!f.date) f.month = isMonth(p.get('month')) ? p.get('month') : thisMonth();
  const [rows, cats, users] = await Promise.all([api.expenses(f), api.categories(), api.profiles()]);
  $app.innerHTML = `${flashHtml()}
  <div class="pagehead"><h1>সব খরচ</h1><a class="btn" href="#/new">+ খরচ যোগ করুন</a></div>
  <form id="flt" class="card filters">
    <label>তারিখ<input type="date" name="date" value="${f.date}"></label><span class="or">অথবা</span>
    <label>মাস<input type="month" name="month" value="${f.month}"></label>
    <label>খাত<select name="category"><option value="">সব খাত</option>${options(cats, f.categoryId)}</select></label>
    <label>সদস্য<select name="user"><option value="">সবাই</option>${options(users, f.userId, u => u.full_name)}</select></label>
    <button class="btn">দেখুন</button></form>
  <div class="card">
    <div class="sumline"><span>${f.date ? 'তারিখ: ' + f.date : 'মাস: ' + f.month} · ${rows.length}টি এন্ট্রি</span><b>মোট: ${money(total(rows))} ${h(CFG.CURRENCY)}</b></div>
    <div class="tablewrap"><table>
      <thead><tr><th>তারিখ</th><th>খাত</th><th>বিবরণ</th><th>যিনি দিয়েছেন</th><th class="r">টাকা (${h(CFG.CURRENCY)})</th><th>রসিদ</th><th></th></tr></thead>
      <tbody>${rows.map(r => `<tr>
        <td class="nw">${r.expense_date}</td><td>${h(catName(r))}</td><td>${h(r.description)}</td><td>${h(userName(r))}</td>
        <td class="r nw"><b>${money(r.amount)}</b></td>
        <td>${r.receipt_path ? `<button class="link" data-receipt="${h(r.receipt_path)}">দেখুন</button>` : ''}</td>
        <td class="nw">${isAdmin() || r.user_id === ME.id ? `<a href="#/edit/${r.id}">এডিট</a> <button class="link danger" data-del="${r.id}">মুছুন</button>` : ''}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">এই সময়ে কোনো খরচ নেই।</td></tr>'}</tbody>
    </table></div></div>`;
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
      if (r.receipt_path) api.removeReceipt(r.receipt_path);
      flash('ok', 'খরচ মুছে ফেলা হয়েছে।');
    } catch (e) { flash('err', errText(e)); }
    render();
  });
};

pages.form = async (id) => {
  const [cats, old] = await Promise.all([api.categories(), id ? api.expense(id) : null]);
  if (id && (!old || !(isAdmin() || old.user_id === ME.id))) { flash('err', 'আপনি শুধু নিজের খরচ এডিট করতে পারবেন।'); return go('#/expenses'); }
  const e = old || { expense_date: today(), amount: '', description: '', category_id: '' };
  const usable = cats.filter(c => c.active || c.id === e.category_id);
  $app.innerHTML = `<div class="card narrow">
    <h1>${id ? 'খরচ এডিট করুন' : 'নতুন খরচ যোগ করুন'}</h1>${flashHtml()}<div id="err"></div>
    <form id="f" class="stack">
      <label>তারিখ<input type="date" name="expense_date" value="${e.expense_date}" max="${today()}" required></label>
      <label>খাত<select name="category_id" required><option value="">— খাত বেছে নিন —</option>${options(usable, e.category_id)}</select></label>
      <label>টাকার পরিমাণ (${h(CFG.CURRENCY)})<input name="amount" inputmode="decimal" value="${e.amount}" placeholder="যেমন 150.00" required></label>
      <label>বিবরণ<textarea name="description" rows="3" maxlength="500" placeholder="কী বাবদ খরচ, কোথায়, কার জন্য">${h(e.description)}</textarea></label>
      <label>রসিদ / ছবি (ঐচ্ছিক, ৮ MB পর্যন্ত)<input type="file" name="receipt" accept="image/*,application/pdf"></label>
      ${e.receipt_path ? '<p class="small">আগের রসিদ আছে। নতুন ফাইল দিলে বদলে যাবে।</p>' : ''}
      <div class="row"><button class="btn" name="go" value="list">সেভ করুন</button>
        ${id ? '' : '<button class="btn ghost" name="go" value="again">সেভ করে আরেকটি যোগ করুন</button>'}
        <a href="#/expenses" class="muted">বাতিল</a></div>
    </form></div>`;
  const form = document.getElementById('f');
  form.onsubmit = async ev => {
    ev.preventDefault();
    const fd = new FormData(form), btns = form.querySelectorAll('button');
    const showErr = m => { document.getElementById('err').innerHTML = `<div class="flash err">${h(m)}</div>`; btns.forEach(b => b.disabled = false); };
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
  $app.innerHTML = `<div class="card narrow"><h1>পাসওয়ার্ড পরিবর্তন</h1>${flashHtml()}<div id="err"></div>
    <form id="f" class="stack">
      <label>নতুন পাসওয়ার্ড<input type="password" name="a" minlength="6" required autocomplete="new-password"></label>
      <label>আবার নতুন পাসওয়ার্ড<input type="password" name="b" minlength="6" required autocomplete="new-password"></label>
      <button class="btn">পরিবর্তন করুন</button></form></div>`;
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
  const catSel = `<label>খাত<select name="category"><option value="">সব খাত</option>${options(cats, '')}</select></label>`;
  const btns = `<button class="btn" name="out" value="excel">Excel ডাউনলোড</button><button class="btn ghost" name="out" value="pdf">PDF / প্রিন্ট</button>`;
  $app.innerHTML = `${flashHtml()}<h1>রিপোর্ট ডাউনলোড</h1><div class="grid3">
    <form class="card stack"><h2>দৈনিক রিপোর্ট</h2><input type="hidden" name="type" value="day">
      <label>তারিখ<input type="date" name="date" value="${today()}" required></label>${catSel}${btns}</form>
    <form class="card stack"><h2>মাসিক রিপোর্ট</h2><input type="hidden" name="type" value="month">
      <label>মাস<input type="month" name="month" value="${thisMonth()}" required></label>${catSel}${btns}</form>
    <form class="card stack"><h2>নির্দিষ্ট সময়ের রিপোর্ট</h2><input type="hidden" name="type" value="range">
      <label>শুরু<input type="date" name="from" value="${thisMonth()}-01" required></label>
      <label>শেষ<input type="date" name="to" value="${today()}" required></label>${catSel}${btns}</form>
  </div><p class="muted small">Excel ফাইলে সব খরচ, খাত অনুযায়ী, দিন অনুযায়ী ও সদস্য অনুযায়ী আলাদা শিট থাকবে। PDF এর জন্য "PDF / প্রিন্ট" চাপুন, তারপর "PDF হিসেবে সেভ করুন"।</p>`;
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
    <header class="phead"><span class="logo">MTC</span><div><h1>${h(CFG.COMPANY)}</h1><h2>${h(r.label)}</h2>
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
pages.members = async () => {
  const users = await api.profiles();
  $app.innerHTML = `${flashHtml()}<h1>সদস্য ব্যবস্থাপনা</h1>
  <div class="card"><div class="tablewrap"><table>
    <thead><tr><th>নাম</th><th>ভূমিকা</th><th>সক্রিয়</th><th></th></tr></thead><tbody>
    ${users.map(u => `<tr data-id="${u.id}">
      <td><input name="full_name" value="${h(u.full_name)}"></td>
      <td><select name="role" ${u.id === ME.id ? 'disabled' : ''}><option value="member">সদস্য</option><option value="admin" ${u.role === 'admin' ? 'selected' : ''}>এডমিন</option></select></td>
      <td><input type="checkbox" name="active" ${u.active ? 'checked' : ''} ${u.id === ME.id ? 'disabled' : ''}></td>
      <td><button class="btn sm" data-save>সেভ</button></td></tr>`).join('')}
    </tbody></table></div></div>
  <div class="card note">
    <b>নতুন সদস্য যোগ করতে:</b> Supabase Dashboard → Authentication → Users → <b>Add user → Create new user</b>।
    ইমেইল দিন যেমন <code>member4@${h(CFG.LOGIN_EMAIL_DOMAIN)}</code> (তাহলে সে শুধু <code>member4</code> লিখে লগইন করতে পারবে), পাসওয়ার্ড দিন, আর <b>Auto Confirm User</b> টিক দিন।
    তারপর এই পাতা রিফ্রেশ করে নাম ঠিক করুন আর <b>"সক্রিয়" টিক দিয়ে সেভ করুন</b> (নিরাপত্তার জন্য নতুন ইউজার শুরুতে নিষ্ক্রিয় থাকে)।<br><br>
    <b>কারো পাসওয়ার্ড ভুলে গেলে:</b> একই জায়গায় ইউজারের পাশে "…" → <b>Reset password / Update user</b>।
    কাউকে বাদ দিতে চাইলে এখানে "সক্রিয়" টিক তুলে দিন, তার পুরনো হিসাব থেকে যাবে।</div>`;
  $app.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr'), id = tr.dataset.id;
    const fields = { full_name: tr.querySelector('[name=full_name]').value.trim() };
    if (id !== ME.id) { fields.role = tr.querySelector('[name=role]').value; fields.active = tr.querySelector('[name=active]').checked; }
    try { await api.updateProfile(id, fields); flash('ok', `${fields.full_name} আপডেট হয়েছে।`); } catch (e) { flash('err', errText(e)); }
    render();
  });
};

pages.categories = async () => {
  const cats = await api.categories();
  $app.innerHTML = `${flashHtml()}<h1>খরচের খাত</h1>
  <div class="card"><table><thead><tr><th>খাতের নাম</th><th>সক্রিয়</th><th></th></tr></thead><tbody>
    ${cats.map(c => `<tr data-id="${c.id}"><td><input name="name" value="${h(c.name)}"></td>
      <td><input type="checkbox" name="active" ${c.active ? 'checked' : ''}></td><td><button class="btn sm" data-save>সেভ</button></td></tr>`).join('')}
  </tbody></table>
  <p class="muted small">কোনো খাত বন্ধ (নিষ্ক্রিয়) করলে নতুন খরচে আর দেখাবে না, তবে পুরনো হিসাব ঠিক থাকবে।</p></div>
  <form id="add" class="card filters"><label>নতুন খাত<input name="name" required placeholder="যেমন: গাড়ি মেরামত"></label><button class="btn">যোগ করুন</button></form>`;
  $app.querySelectorAll('[data-save]').forEach(b => b.onclick = async () => {
    const tr = b.closest('tr');
    try {
      await api.updateCategory(tr.dataset.id, { name: tr.querySelector('[name=name]').value.trim(), active: tr.querySelector('[name=active]').checked });
      flash('ok', 'খাত আপডেট হয়েছে।');
    } catch (e) { flash('err', errText(e)); }
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
  [/^\/reports$/, () => pages.reports(), true],
  [/^\/print$/, () => pages.print(), true],
  [/^\/members$/, () => pages.members(), true],
  [/^\/categories$/, () => pages.categories(), true],
];

function renderNav(route) {
  const link = (href, text, cls = '') => `<a href="${href}" class="${cls} ${route === href.slice(1) ? 'on' : ''}">${text}</a>`;
  document.getElementById('nav').innerHTML = link('#/', 'ড্যাশবোর্ড') + link('#/expenses', 'সব খরচ') + link('#/new', '+ খরচ যোগ', 'btn-nav') +
    (isAdmin() ? link('#/reports', 'রিপোর্ট') + link('#/members', 'সদস্য') + link('#/categories', 'খাত') : '');
  document.getElementById('me-name').innerHTML = h(ME.full_name) + (isAdmin() ? ' <span class="tag">এডমিন</span>' : '');
}

async function render() {
  if (!ME) return;
  const route = (location.hash.slice(1) || '/').split('?')[0] || '/';
  renderNav(route);
  for (const [re, fn, adminOnly] of ROUTES) {
    const m = route.match(re);
    if (!m) continue;
    if (adminOnly && !isAdmin()) { $app.innerHTML = '<div class="card"><h2>শুধু এডমিন এই পাতা দেখতে পারবেন।</h2></div>'; return; }
    try { await fn(m); window.scrollTo(0, 0); }
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
  if (!ME) return pages.login();
  render();
}

document.getElementById('logout').onclick = async () => { await api.signOut(); ME = null; location.hash = '#/'; boot(); };
window.addEventListener('hashchange', render);
boot();
