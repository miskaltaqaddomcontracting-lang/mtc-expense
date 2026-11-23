/**
 * MTC খরচ হিসাব — জিমেইলে স্বয়ংক্রিয় ব্যাকআপ (Google Apps Script)
 *
 * এটি আপনার নিজের Google অ্যাকাউন্টে চলে (script.google.com)।
 * প্রতিদিন নির্দিষ্ট সময়ে Supabase থেকে সব খরচ পড়ে:
 *   ১) Excel-এ খোলা যায় এমন CSV ফাইল, ২) পুরো ডাটার JSON ফাইল
 * আপনার জিমেইলে পাঠায় এবং Google Drive-এর "MTC Backup" ফোল্ডারে রাখে।
 *
 * পাসওয়ার্ড কোডে লিখবেন না — Project Settings → Script Properties-এ রাখুন:
 *   SUPABASE_URL   = https://xxxx.supabase.co
 *   SUPABASE_KEY   = sb_publishable_... (ওয়েবসাইটের config.js-এর একই key)
 *   BACKUP_EMAIL   = backup@mtc.local   (এই কাজের জন্য আলাদা একটি সক্রিয় সদস্য)
 *   BACKUP_PASSWORD= সেই সদস্যের পাসওয়ার্ড
 *   SEND_TO        = (ঐচ্ছিক) কোন জিমেইলে যাবে; খালি থাকলে আপনার নিজের জিমেইলে
 */

var DRIVE_FOLDER = 'MTC Backup';
var TZ = 'Asia/Riyadh';

function props_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  ['SUPABASE_URL', 'SUPABASE_KEY', 'BACKUP_EMAIL', 'BACKUP_PASSWORD'].forEach(function (k) {
    if (!p[k]) throw new Error('Script Property নেই: ' + k);
  });
  p.SUPABASE_URL = p.SUPABASE_URL.replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
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

/** এটাই মূল ব্যাকআপ — হাতে চালাতে চাইলে এটা Run করুন */
function runBackup() {
  var p = props_();
  var token = login_(p);

  var expenses = fetchAll_(p, token,
    'expenses?select=*,category:categories(name),member:profiles(full_name)&order=expense_date.asc,id.asc');
  var categories = fetchAll_(p, token, 'categories?select=*&order=sort_order.asc,id.asc');
  var profiles = fetchAll_(p, token, 'profiles?select=id,full_name,role,active,created_at');

  var stamp = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd');
  var total = 0;
  var lines = [['তারিখ', 'খাত', 'সদস্য', 'বিবরণ', 'টাকা', 'রসিদ আছে', 'ID'].join(',')];
  expenses.forEach(function (e) {
    total += Number(e.amount) || 0;
    lines.push([
      e.expense_date,
      e.category ? e.category.name : '',
      e.member ? e.member.full_name : '',
      e.description,
      e.amount,
      e.receipt_path ? 'হ্যাঁ' : '',
      e.id
    ].map(csvCell_).join(','));
  });
  // ﻿ দিলে Excel বাংলা লেখা ঠিকমতো দেখায়
  var csv = Utilities.newBlob('﻿' + lines.join('\r\n'), 'text/csv', 'MTC-expenses-' + stamp + '.csv');
  var json = Utilities.newBlob(JSON.stringify({
    backup_date: stamp, expenses: expenses, categories: categories, profiles: profiles
  }, null, 1), 'application/json', 'MTC-full-backup-' + stamp + '.json');

  // Google Drive-এ রাখা
  var it = DriveApp.getFoldersByName(DRIVE_FOLDER);
  var folder = it.hasNext() ? it.next() : DriveApp.createFolder(DRIVE_FOLDER);
  folder.createFile(csv);
  folder.createFile(json);

  // জিমেইলে পাঠানো
  var to = p.SEND_TO || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: to,
    subject: 'MTC খরচ ব্যাকআপ — ' + stamp,
    body: 'MTC খরচ হিসাবের স্বয়ংক্রিয় ব্যাকআপ।\n\n' +
      'মোট এন্ট্রি: ' + expenses.length + '\n' +
      'মোট খরচ: ' + total.toFixed(2) + '\n' +
      'খাত: ' + categories.length + ', সদস্য: ' + profiles.length + '\n\n' +
      'CSV ফাইলটি Excel-এ খুলুন। JSON ফাইলটি পুরো ডাটা ফেরত আনার জন্য রেখে দিন।\n' +
      'একই ফাইল Google Drive-এর "' + DRIVE_FOLDER + '" ফোল্ডারেও আছে।',
    attachments: [csv, json]
  });
}

/** একবার Run করুন: প্রতিদিন রাত ১১টার দিকে নিজে থেকে ব্যাকআপ চালু হবে */
function setupDailyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runBackup').timeBased().everyDays(1).atHour(23).inTimezone(TZ).create();
}

/** সাপ্তাহিক চাইলে setupDailyBackup-এর বদলে এটা Run করুন (প্রতি শুক্রবার) */
function setupWeeklyBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'runBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('runBackup').timeBased().onWeekDay(ScriptApp.WeekDay.FRIDAY).atHour(23).inTimezone(TZ).create();
}
