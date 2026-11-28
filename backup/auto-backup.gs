/**
 * MTC খরচ হিসাব — Google Drive ও জিমেইলে স্বয়ংক্রিয় ফাইল (Google Apps Script)
 *
 * এটি আপনার নিজের Google অ্যাকাউন্টে চলে (script.google.com)। দুটি কাজ করে:
 *
 * ১) দৈনিক খরচের ফাইল — প্রতিদিন রাত ১১:৩০-এর দিকে সেদিনের সব খরচ একটি Google Sheet-এ
 *    তারিখের নামে Drive-এ সেভ করে:  MTC খরচ / 2026-11 / MTC খরচ 2026-11-28
 *    আর একই ফাইল Excel হিসেবে আপনার জিমেইলে পাঠায় (EMAIL_DAILY = no দিলে পাঠাবে না)।
 *
 * ২) সাপ্তাহিক পূর্ণ ব্যাকআপ — প্রতি শুক্রবার সব খরচের CSV ও পুরো ডাটার JSON
 *    Drive-এর "MTC খরচ / Backup" ফোল্ডারে রাখে ও জিমেইলে পাঠায়।
 *
 * চালু করতে: কোড পেস্ট → Script Properties ঠিক করুন → setupAutomatic একবার Run।
 *
 * পাসওয়ার্ড কোডে লিখবেন না — Project Settings → Script Properties-এ রাখুন:
 *   SUPABASE_URL   = https://xxxx.supabase.co
 *   SUPABASE_KEY   = sb_publishable_... (ওয়েবসাইটের config.js-এর একই key)
 *   BACKUP_EMAIL   = backup@mtc.local   (এই কাজের জন্য আলাদা একটি সক্রিয় সদস্য)
 *   BACKUP_PASSWORD= সেই সদস্যের পাসওয়ার্ড
 *   SEND_TO        = (ঐচ্ছিক) কোন জিমেইলে যাবে; খালি থাকলে আপনার নিজের জিমেইলে
 *   EMAIL_DAILY    = (ঐচ্ছিক) no লিখলে দৈনিক ফাইল শুধু Drive-এ থাকবে, ইমেইল যাবে না
 */

var ROOT_FOLDER = 'MTC খরচ';
var TZ = 'Asia/Riyadh';
var CURRENCY = 'SAR';

function props_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  ['SUPABASE_URL', 'SUPABASE_KEY', 'BACKUP_EMAIL', 'BACKUP_PASSWORD'].forEach(function (k) {
    if (!p[k]) throw new Error('Script Property নেই: ' + k);
  });
  p.SUPABASE_URL = p.SUPABASE_URL.trim().replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
  return p;
}

function login_(p) {
  var res = UrlFetchApp.fetch(p.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
    method: 'post',
    contentType: 'application/json',
    headers: { apikey: p.SUPABASE_KEY },
    payload: JSON.stringify({ email: p.BACKUP_EMAIL, password: p.BACKUP_PASSWORD }),
    muteHttpExceptions: true
  });
  if (res.getResponseCode() !== 200) throw new Error('লগইন ব্যর্থ: ' + res.getContentText());
  return JSON.parse(res.getContentText()).access_token;
}

// একবারে ১০০০ সারি করে সব ডাটা আনে
function fetchAll_(p, token, path) {
  var out = [], step = 1000, from = 0;
  while (true) {
    var res = UrlFetchApp.fetch(p.SUPABASE_URL + '/rest/v1/' + path, {
      headers: {
        apikey: p.SUPABASE_KEY,
        Authorization: 'Bearer ' + token,
        Range: from + '-' + (from + step - 1)
      },
      muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code !== 200 && code !== 206) throw new Error(path + ' পড়া যায়নি: ' + res.getContentText());
    var rows = JSON.parse(res.getContentText());
    out = out.concat(rows);
    if (rows.length < step) break;
    from += step;
  }
  return out;
}

function csvCell_(v) {
  v = v == null ? '' : String(v);
  return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

// ফোল্ডার খোঁজে, না থাকলে তৈরি করে:  folder_(['MTC খরচ', '2026-11'])
function folder_(names) {
  var f = DriveApp.getRootFolder();
  names.forEach(function (n) {
    var it = f.getFoldersByName(n);
    f = it.hasNext() ? it.next() : f.createFolder(n);
  });
  return f;
}

function sendTo_(p) { return p.SEND_TO || Session.getEffectiveUser().getEmail(); }

/** ১) দৈনিক খরচের ফাইল। হাতে চালালে আজকের (দুপুর ১২টার আগে চালালে গতকালের) ফাইল তৈরি হবে। */
function dailyReport() {
  var now = new Date();
  var hour = Number(Utilities.formatDate(now, TZ, 'H'));
  // মাঝরাতের পরে চালু হলেও আগের দিনের হিসাব ধরবে
  var day = hour < 12 ? new Date(now.getTime() - 24 * 3600 * 1000) : now;
  makeDailyFile_(Utilities.formatDate(day, TZ, 'yyyy-MM-dd'));
}

/** নির্দিষ্ট তারিখের ফাইল বানাতে: makeDailyFileFor() ফাংশনে তারিখ বদলে Run করুন */
function makeDailyFileFor() { makeDailyFile_('2026-11-28'); }

function makeDailyFile_(date) {
  var p = props_();
  var token = login_(p);
  var rows = fetchAll_(p, token, 'expenses?select=*,category:categories(name),member:profiles!user_id(full_name)' +
    '&expense_date=eq.' + date + '&order=id.asc');
  var name = function (r, k) { return r[k] ? r[k][k === 'category' ? 'name' : 'full_name'] : ''; };
  var total = rows.reduce(function (t, r) { return t + Number(r.amount); }, 0);

  var folder = folder_([ROOT_FOLDER, date.slice(0, 7)]);
  var title = 'MTC খরচ ' + date;
  // একই দিনের পুরোনো ফাইল থাকলে সরিয়ে নতুনটা রাখে
  var old = folder.getFilesByName(title);
  while (old.hasNext()) old.next().setTrashed(true);

  var ss = SpreadsheetApp.create(title);
  var sh = ss.getActiveSheet().setName('খরচ');
  sh.getRange('A1').setValue('Misk Al Taqaddom Contracting (MTC) — দৈনিক খরচ').setFontWeight('bold').setFontSize(14);
  sh.getRange('A2').setValue('তারিখ: ' + date + '   ·   মোট এন্ট্রি: ' + rows.length).setFontWeight('bold');
  var data = [['#', 'খাত', 'বিবরণ', 'সদস্য', 'টাকা (' + CURRENCY + ')', 'রসিদ']];
  rows.forEach(function (r, i) {
    data.push([i + 1, name(r, 'category'), r.description || '', name(r, 'member'), Number(r.amount), r.receipt_path ? 'আছে' : '']);
  });
  data.push(['', '', 'মোট', '', total, '']);
  sh.getRange(4, 1, data.length, 6).setValues(data);
  sh.getRange(4, 1, 1, 6).setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f5f8b');
  sh.getRange(4 + data.length - 1, 1, 1, 6).setFontWeight('bold').setBackground('#eef4fb');
  sh.getRange(5, 5, data.length - 1, 1).setNumberFormat('#,##0.00');
  sh.setColumnWidth(1, 40); sh.setColumnWidth(2, 180); sh.setColumnWidth(3, 260); sh.setColumnWidth(4, 140); sh.setColumnWidth(5, 110);
  sh.setFrozenRows(4);

  // খাত ও সদস্য অনুযায়ী মোট
  var sum = function (key) {
    var m = {};
    rows.forEach(function (r) { var k = name(r, key) || '—'; m[k] = (m[k] || 0) + Number(r.amount); });
    return Object.keys(m).sort(function (a, b) { return m[b] - m[a]; }).map(function (k) { return [k, m[k]]; });
  };
  var s2 = ss.insertSheet('সারাংশ');
  var cat = [['খাত অনুযায়ী', 'টাকা']].concat(sum('category'));
  var mem = [['সদস্য অনুযায়ী', 'টাকা']].concat(sum('member'));
  s2.getRange(1, 1, cat.length, 2).setValues(cat);
  s2.getRange(1, 4, mem.length, 2).setValues(mem);
  s2.getRange('A1:B1').setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f5f8b');
  s2.getRange('D1:E1').setFontWeight('bold').setFontColor('#ffffff').setBackground('#1f5f8b');
  s2.getRange('B:B').setNumberFormat('#,##0.00'); s2.getRange('E:E').setNumberFormat('#,##0.00');
  s2.setColumnWidth(1, 200); s2.setColumnWidth(4, 160);
  SpreadsheetApp.flush();
  DriveApp.getFileById(ss.getId()).moveTo(folder);

  if (String(p.EMAIL_DAILY || '').toLowerCase() !== 'no') {
    var xlsx = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=xlsx', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }
    }).getBlob().setName(title + '.xlsx');
    MailApp.sendEmail({
      to: sendTo_(p),
      subject: title + ' — মোট ' + total.toFixed(2) + ' ' + CURRENCY,
      body: 'তারিখ: ' + date + '\nমোট এন্ট্রি: ' + rows.length + '\nমোট খরচ: ' + total.toFixed(2) + ' ' + CURRENCY +
        '\n\nফাইলটি আপনার Google Drive-এ আছে: ' + ROOT_FOLDER + ' / ' + date.slice(0, 7) + ' / ' + title +
        '\n' + ss.getUrl(),
      attachments: [xlsx]
    });
  }
}

/** ২) পূর্ণ ব্যাকআপ — সব খরচের CSV ও পুরো ডাটার JSON (হাতে চালাতে চাইলে এটা Run করুন) */
function runBackup() {
  var p = props_();
  var token = login_(p);

  var expenses = fetchAll_(p, token,
    'expenses?select=*,category:categories(name),member:profiles!user_id(full_name)&order=expense_date.asc,id.asc');
  var categories = fetchAll_(p, token, 'categories?select=*&order=sort_order.asc,id.asc');
  var profiles = fetchAll_(p, token, 'profiles?select=id,full_name,role,active,created_at');

  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var total = 0;
  var lines = [['তারিখ', 'খাত', 'সদস্য', 'বিবরণ', 'টাকা', 'রসিদ আছে', 'ID'].join(',')];
  expenses.forEach(function (e) {
    total += Number(e.amount) || 0;
    lines.push([e.expense_date, e.category ? e.category.name : '', e.member ? e.member.full_name : '',
      e.description, e.amount, e.receipt_path ? 'হ্যাঁ' : '', e.id].map(csvCell_).join(','));
  });
  // \uFEFF দিলে Excel বাংলা লেখা ঠিকমতো দেখায়
  var csv = Utilities.newBlob('\uFEFF' + lines.join('\r\n'), 'text/csv', 'MTC-expenses-' + stamp + '.csv');
  var json = Utilities.newBlob(JSON.stringify({
    backup_date: stamp, expenses: expenses, categories: categories, profiles: profiles
  }, null, 1), 'application/json', 'MTC-full-backup-' + stamp + '.json');

  var folder = folder_([ROOT_FOLDER, 'Backup']);
  folder.createFile(csv);
  folder.createFile(json);

  MailApp.sendEmail({
    to: sendTo_(p),
    subject: 'MTC পূর্ণ ব্যাকআপ — ' + stamp,
    body: 'MTC খরচ হিসাবের সাপ্তাহিক পূর্ণ ব্যাকআপ।\n\n' +
      'মোট এন্ট্রি: ' + expenses.length + '\nমোট খরচ: ' + total.toFixed(2) + ' ' + CURRENCY + '\n' +
      'খাত: ' + categories.length + ', সদস্য: ' + profiles.length + '\n\n' +
      'CSV ফাইলটি Excel-এ খুলুন। JSON ফাইলটি পুরো ডাটা ফেরত আনার জন্য রেখে দিন।\n' +
      'একই ফাইল Google Drive-এর "' + ROOT_FOLDER + ' / Backup" ফোল্ডারেও আছে।',
    attachments: [csv, json]
  });
}

/** একবার Run করুন: প্রতিদিন রাত ১১:৩০-এর দিকে দৈনিক ফাইল, আর প্রতি শুক্রবার পূর্ণ ব্যাকআপ চালু হবে */
function setupAutomatic() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyReport').timeBased().everyDays(1).atHour(23).nearMinute(30).inTimezone(TZ).create();
  ScriptApp.newTrigger('runBackup').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(22).inTimezone(TZ).create();
}

/** সব স্বয়ংক্রিয় কাজ বন্ধ করতে এটা Run করুন */
function stopAutomatic() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
}
