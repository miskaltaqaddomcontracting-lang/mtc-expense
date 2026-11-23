// প্রতিদিন রাতে GitHub Actions এই ফাইল চালায়: সব সক্রিয় সদস্যের ফোনে রিমাইন্ডার পাঠায়।
// প্রয়োজন: GitHub Secret "SUPABASE_SECRET_KEY" (Supabase → Project Settings → API Keys → secret key)
// নোটিফিকেশনের লেখা বদলাতে নিচের MESSAGE বদলান। {name} = সদস্যের নাম।
const TITLE = 'MTC খরচ হিসাব';
const MESSAGE = 'শুভ রাত্রী {name}, আজকে খরচ আমাকে দিয়েছেন তো। ভেবে দেখুন কোনটি বাদ পড়লে দ্রুত তুলে দিন।';
const SEND_AT = '23:00';          // সৌদি সময়
const TIMEZONE = 'Asia/Riyadh';

const fs = require('fs'), path = require('path');
const webpush = require('web-push');

const cfgText = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
const URL_ = (process.env.SUPABASE_URL || (cfgText.match(/SUPABASE_URL\s*:\s*['"]([^'"]+)/) || [])[1] || '').replace(/\/+$/, '').replace(/\/rest\/v1$/, '');
const KEY = (process.env.SUPABASE_SECRET_KEY || '').trim();
const SITE = process.env.SITE_URL || 'https://miskaltaqaddomcontracting-lang.github.io/mtc-expense/';
if (!URL_ || !KEY) { console.error('SUPABASE_SECRET_KEY সেট করা নেই (GitHub → Settings → Secrets and variables → Actions)'); process.exit(1); }

const headers = { apikey: KEY, 'Content-Type': 'application/json' };
if (!KEY.startsWith('sb_')) headers.Authorization = 'Bearer ' + KEY; // পুরোনো service_role key
async function rest(method, p, body, extra = {}) {
  const r = await fetch(`${URL_}/rest/v1/${p}`, { method, headers: { ...headers, ...extra }, body: body && JSON.stringify(body) });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${t}`);
  return t ? JSON.parse(t) : null;
}

async function vapidKeys() {
  const rows = await rest('GET', 'app_secrets?key=eq.vapid_private&select=value');
  const pub = await rest('GET', 'app_settings?key=eq.vapid_public&select=value');
  if (rows.length && pub.length) return { publicKey: pub[0].value, privateKey: rows[0].value };
  // প্রথমবার: নতুন key তৈরি করে Supabase-এ রাখা হয়
  const k = webpush.generateVAPIDKeys();
  const up = { Prefer: 'resolution=merge-duplicates' };
  await rest('POST', 'app_secrets', [{ key: 'vapid_private', value: k.privateKey }], up);
  await rest('POST', 'app_settings', [{ key: 'vapid_public', value: k.publicKey }], up);
  console.log('নতুন নোটিফিকেশন key তৈরি হয়েছে।');
  return k;
}

function minutesUntilSend() {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: TIMEZONE }));
  const [h, m] = SEND_AT.split(':').map(Number);
  return (h * 60 + m) - (now.getHours() * 60 + now.getMinutes());
}

(async () => {
  const keys = await vapidKeys();
  webpush.setVapidDetails(SITE, keys.publicKey, keys.privateKey);
  if (process.env.SETUP_ONLY === '1') return console.log('সেটআপ শেষ।');

  // GitHub মাঝে মাঝে একটু আগে চালায় — ঠিক সময় পর্যন্ত অপেক্ষা (সর্বোচ্চ ৩০ মিনিট)
  const wait = minutesUntilSend();
  if (process.env.NO_WAIT !== '1' && wait > 0 && wait <= 30) {
    console.log(`${wait} মিনিট অপেক্ষা…`);
    await new Promise(r => setTimeout(r, wait * 60000));
  }

  const subs = await rest('GET', 'push_subscriptions?select=id,endpoint,p256dh,auth,profile:profiles(full_name,active)');
  let sent = 0, removed = 0;
  for (const s of subs) {
    if (!s.profile?.active) continue;
    const body = MESSAGE.replace('{name}', s.profile.full_name || '');
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title: TITLE, body, url: '#/new' }), { TTL: 6 * 3600, urgency: 'high' });
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) { await rest('DELETE', `push_subscriptions?id=eq.${s.id}`); removed++; }
      else console.error('পাঠানো যায়নি:', e.statusCode, e.body || e.message);
    }
  }
  console.log(`পাঠানো হয়েছে: ${sent}, পুরোনো ডিভাইস বাদ: ${removed}`);
})().catch(e => { console.error(e.message); process.exit(1); });
