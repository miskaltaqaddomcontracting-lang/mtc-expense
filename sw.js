// অ্যাপ হিসেবে ইনস্টলের জন্য service worker।
// সবসময় আগে ইন্টারনেট থেকে নতুন ফাইল আনে; ইন্টারনেট না থাকলে শেষবার রাখা ফাইল দেখায়।
// Supabase-এর ডেটা কখনো জমা রাখে না।
const CACHE = 'mtc-v2';
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
