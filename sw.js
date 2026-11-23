// অ্যাপ হিসেবে ইনস্টলের জন্য service worker।
// সবসময় আগে ইন্টারনেট থেকে নতুন ফাইল আনে; ইন্টারনেট না থাকলে শেষবার রাখা ফাইল দেখায়।
// Supabase-এর ডেটা কখনো জমা রাখে না।
const CACHE = 'mtc-v5';
self.addEventListener('install', e => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request).then(r => r || caches.match('./')))
  );
});

// রাতের রিমাইন্ডার নোটিফিকেশন
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'MTC খরচ হিসাব', {
    body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'mtc-daily', renotify: true,
    data: { url: d.url || '' }
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = new URL('./' + (e.notification.data?.url || ''), self.registration.scope).href;
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope)) { c.navigate(target).catch(() => {}); return c.focus(); }
    return clients.openWindow(target);
  }));
});
