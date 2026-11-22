// ===== এখানে আপনার Supabase প্রজেক্টের তথ্য বসান =====
// Supabase Dashboard → Project Settings → API (Data API) থেকে কপি করুন
window.MTC_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',   // "anon public" key (service_role কখনো এখানে দেবেন না!)

  COMPANY: 'Misk Al Taqaddom Contracting (MTC)',
  CURRENCY: 'SAR',
  TIMEZONE: 'Asia/Riyadh',
  // লগইনে শুধু "member1" লিখলে নিজে থেকে "member1@mtc.local" হয়ে যাবে
  LOGIN_EMAIL_DOMAIN: 'mtc.local',
};
