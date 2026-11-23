// Supabase এর সাথে সব যোগাযোগ এই ফাইলে। নতুন ফিচার যোগ করতে এখানে ফাংশন যোগ করুন।
(function () {
  if (window.MTC_API) return; // টেস্টের জন্য অন্য api দেওয়া যায়
  const cfg = window.MTC_CONFIG;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const must = ({ data, error }) => { if (error) throw error; return data; };
  let noSoftDelete = false;
  const EXP_SELECT = '*, category:categories(name), profile:profiles!user_id(full_name)';

  window.MTC_API = {
    async session() { return (await sb.auth.getSession()).data.session; },
    onAuthChange(cb) { sb.auth.onAuthStateChange((_e, s) => cb(s)); },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signOut() { await sb.auth.signOut(); },
    async changePassword(password) { must(await sb.auth.updateUser({ password })); },

    async me() {
      const uid = (await sb.auth.getUser()).data.user?.id;
      return uid ? must(await sb.from('profiles').select('*').eq('id', uid).maybeSingle()) : null;
    },
    async profiles() { return must(await sb.from('profiles').select('*').order('role').order('full_name')); },
    async adminListUsers() { return must(await sb.rpc('admin_list_users')); },
    async adminCreateUser(email, password, fullName, role) { return must(await sb.rpc('admin_create_user', { p_email: email, p_password: password, p_full_name: fullName, p_role: role })); },
    async adminSetPassword(userId, password) { must(await sb.rpc('admin_set_password', { p_user_id: userId, p_password: password })); },
    async updateProfile(id, fields) { must(await sb.from('profiles').update(fields).eq('id', id)); },

    async categories() { return must(await sb.from('categories').select('*').order('sort_order').order('id')); },
    async addCategory(name) {
      const max = must(await sb.from('categories').select('sort_order').order('sort_order', { ascending: false }).limit(1));
      must(await sb.from('categories').insert({ name, sort_order: (max[0]?.sort_order || 0) + 1 }));
    },
    async updateCategory(id, fields) { must(await sb.from('categories').update(fields).eq('id', id)); },
    async deleteCategory(id) { must(await sb.from('categories').delete().eq('id', id)); },

    // f: { date, month, from, to, categoryId, userId } — মুছে ফেলা খরচ বাদ দিয়ে
    async expenses(f = {}) {
      let q = sb.from('expenses').select(EXP_SELECT);
      if (!noSoftDelete) q = q.is('deleted_at', null);
      if (f.date) q = q.eq('expense_date', f.date);
      if (f.month) {
        const [y, m] = f.month.split('-').map(Number);
        q = q.gte('expense_date', `${f.month}-01`).lt('expense_date', m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`);
      }
      if (f.from) q = q.gte('expense_date', f.from);
      if (f.to) q = q.lte('expense_date', f.to);
      if (f.categoryId) q = q.eq('category_id', f.categoryId);
      if (f.userId) q = q.eq('user_id', f.userId);
      if (f.q) { // বিবরণ বা খাতের নামে খোঁজা
        const t = '"%' + f.q.replace(/[\\"%_]/g, '') + '%"';
        const ids = (f.catIds || []).filter(Number.isInteger);
        q = q.or(`description.ilike.${t}` + (ids.length ? `,category_id.in.(${ids.join(',')})` : ''));
      }
      const res = await q.order('expense_date', { ascending: false }).order('id', { ascending: false }).limit(10000);
      // deleted-history.sql এখনো চালানো না হলে আগের মতো চলবে
      if (res.error && !noSoftDelete && /deleted_at/.test(res.error.message)) { noSoftDelete = true; return this.expenses(f); }
      return must(res);
    },
    async expense(id) { return must(await sb.from('expenses').select(EXP_SELECT).eq('id', id).maybeSingle()); },
    async addExpense(e) { must(await sb.from('expenses').insert(e)); },
    async updateExpense(id, e) { must(await sb.from('expenses').update(e).eq('id', id)); },
    // "মুছুন": খরচ মুছে ফেলা তালিকায় যায় (এডমিন দেখতে পান)
    async deleteExpense(id) { must(await sb.rpc('delete_expense', { p_id: id })); },
    // এডমিনের জন্য: মুছে ফেলা খরচ, ফেরত আনা, স্থায়ীভাবে মোছা
    async deletedExpenses() {
      return must(await sb.from('expenses').select(EXP_SELECT + ', deleter:profiles!deleted_by(full_name)')
        .not('deleted_at', 'is', null).order('deleted_at', { ascending: false }).limit(5000));
    },
    async restoreExpense(id) { must(await sb.from('expenses').update({ deleted_at: null }).eq('id', id)); },
    async purgeExpense(id) { must(await sb.from('expenses').delete().eq('id', id)); },
    async monthlyTotals(n = 12) { return must(await sb.rpc('monthly_totals', { max_months: n })); },

    // রাতের নোটিফিকেশন
    async pushPublicKey() { return must(await sb.from('app_settings').select('value').eq('key', 'vapid_public').maybeSingle())?.value || null; },
    async savePush(sub) {
      const j = sub.toJSON();
      must(await sb.from('push_subscriptions').upsert({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth }, { onConflict: 'endpoint' }));
    },
    async deletePush(endpoint) { must(await sb.from('push_subscriptions').delete().eq('endpoint', endpoint)); },

    async uploadReceipt(file, uid) {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${uid}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      must(await sb.storage.from('receipts').upload(path, file, { contentType: file.type }));
      return path;
    },
    async receiptUrl(path) { return must(await sb.storage.from('receipts').createSignedUrl(path, 600)).signedUrl; },
    async removeReceipt(path) { await sb.storage.from('receipts').remove([path]); },
  };
})();
