# MTC খরচ হিসাব — GitHub + Supabase সংস্করণ

**Misk Al Taqaddom Contracting (MTC)**-এর দৈনিক খরচের হিসাব।
- **Supabase**: লগইন, ডাটাবেস আর রসিদের ছবি রাখে (ফ্রি প্ল্যানেই চলবে)।
- **GitHub Pages**: ওয়েবসাইটটা ফ্রিতে অনলাইনে রাখে। কোড বদলে GitHub-এ পাঠালেই সাইট আপডেট হয়ে যায়।
- কোনো build বা `npm` লাগে না। শুধু HTML, CSS আর JavaScript।

---

## ধাপ ১: Supabase প্রজেক্ট তৈরি (১০ মিনিট)
1. https://supabase.com এ গিয়ে অ্যাকাউন্ট খুলুন → **New project**। নাম দিন `mtc-expense`, region দিন কাছাকাছি কোনোটা (যেমন Middle East / Frankfurt), একটা ডাটাবেস পাসওয়ার্ড দিয়ে সেভ করুন।
2. বাম পাশে **SQL Editor** → **New query** → `supabase/schema.sql` ফাইলের পুরো লেখা পেস্ট করে **Run** চাপুন। (টেবিল, নিরাপত্তা নিয়ম, রসিদের জায়গা আর শুরুর খাত তৈরি হবে।)
3. **Authentication → Sign In / Providers → Email**: **"Allow new users to sign up"** বন্ধ করুন, যাতে বাইরের কেউ নিজে অ্যাকাউন্ট খুলতে না পারে।
4. **Authentication → Users → Add user → Create new user** দিয়ে ৪ জন ইউজার তৈরি করুন, প্রত্যেকবার **Auto Confirm User** টিক দিন:
   - `admin@mtc.local` (আপনি)
   - `member1@mtc.local`, `member2@mtc.local`, `member3@mtc.local`

   ইমেইলের শেষে `@mtc.local` থাকলে লগইনে শুধু `admin`, `member1` লিখলেই হবে। চাইলে আসল ইমেইলও দিতে পারেন।
5. আবার **SQL Editor**-এ এটা চালান (নিজেকে এডমিন বানাতে):
   ```sql
   update public.profiles set role = 'admin', active = true, full_name = 'Admin'
     where id = (select id from auth.users where email = 'admin@mtc.local');
   ```
6. **Project Settings → API** (বা **Data API**) থেকে **Project URL** আর **anon public** key কপি করুন।

## ধাপ ২: কোডে Supabase বসানো
`config.js` খুলে `SUPABASE_URL` আর `SUPABASE_ANON_KEY` বসান। এখানে মুদ্রা (`CURRENCY`), কোম্পানির নাম আর টাইমজোনও বদলানো যায়।

> anon key ওয়েবসাইটে খোলা থাকলেও সমস্যা নেই, কারণ ডাটাবেসের নিরাপত্তা নিয়ম (RLS) সব পাহারা দেয়। কিন্তু **service_role** key কখনো এখানে বা GitHub-এ দেবেন না।

## ধাপ ৩: GitHub-এ তোলা ও অনলাইনে চালু করা
1. https://github.com/new → নাম `mtc-expense` → **Create repository**।
2. **uploading an existing file** লিংকে ক্লিক করে এই ফোল্ডারের সব ফাইল টেনে ছেড়ে দিন → **Commit changes**।
3. রিপোর **Settings → Pages** → Source: **Deploy from a branch** → Branch: `main` / `(root)` → **Save**।
4. ১-২ মিনিট পর সাইট চালু হবে: `https://<আপনার-github-নাম>.github.io/mtc-expense/`
5. **Supabase → Authentication → URL Configuration → Site URL**-এ এই ঠিকানাটা দিন।

## ধাপ ৪: প্রথমবার ব্যবহার
1. `admin` দিয়ে লগইন করুন → **সদস্য** পাতায় member1-3 এর আসল নাম লিখুন, **সক্রিয়** টিক দিয়ে **সেভ** করুন। (নিরাপত্তার জন্য নতুন ইউজার শুরুতে নিষ্ক্রিয় থাকে।)
2. **খাত** পাতায় আপনাদের খাতগুলো ঠিক করুন।
3. সদস্যরা উপরে নিজের নামে ক্লিক করে পাসওয়ার্ড বদলাতে পারবেন।

---

## নিজে কাস্টমাইজ করার জন্য: কোন ফাইলে কী
| ফাইল | কী আছে |
|---|---|
| `config.js` | Supabase তথ্য, মুদ্রা, কোম্পানির নাম, টাইমজোন |
| `css/style.css` | রং ও ডিজাইন। উপরের `--brand` (নীল) ও `--accent` (সোনালি) বদলালেই পুরো সাইটের রং বদলায় |
| `js/app.js` | সব পাতা: `pages.dashboard`, `pages.expenses`, `pages.form` (খরচ যোগ), `pages.reports`, `pages.print` (PDF), `pages.members`, `pages.categories`। নিচে `ROUTES`-এ নতুন পাতা যোগ করুন |
| `js/api.js` | Supabase থেকে ডেটা আনা/রাখার সব ফাংশন |
| `supabase/schema.sql` | ডাটাবেস টেবিল ও নিরাপত্তা নিয়ম |

### উদাহরণ: খরচে নতুন ঘর যোগ করা (যেমন "প্রজেক্ট/সাইটের নাম")
1. Supabase SQL Editor-এ চালান: `alter table public.expenses add column project text not null default '';`
2. `js/app.js`-এ `pages.form`-এর ফর্মে একটা লাইন যোগ করুন:
   `<label>প্রজেক্ট<input name="project" value="${h(e.project || '')}"></label>`
   আর `const rec = { ... }`-এর ভেতরে লিখুন: `project: fd.get('project').trim(),`
3. তালিকায় দেখাতে `pages.expenses`-এর টেবিলে `<th>প্রজেক্ট</th>` আর `<td>${h(r.project)}</td>` যোগ করুন। Excel-এ দেখাতে `downloadExcel`-এর কলাম তালিকায় যোগ করুন।

### নিজের কম্পিউটারে চালিয়ে দেখা
ফোল্ডারে টার্মিনাল খুলে `python -m http.server 8000` চালান → ব্রাউজারে http://localhost:8000 খুলুন। (ফাইলে ডাবল-ক্লিক করে খুললে কাজ করবে না।)

### ব্যাকআপ
Supabase → **Table Editor → expenses → Export to CSV**। অথবা এডমিন প্যানেল থেকে প্রতি মাসের Excel রিপোর্ট নামিয়ে রাখুন।

## কে কী পারে (নিরাপত্তা নিয়ম ডাটাবেসেই বসানো)
- **সদস্য**: খরচ যোগ করতে পারেন, নিজের খরচ এডিট বা মুছতে পারেন, সবার খরচ আর ড্যাশবোর্ড দেখতে পারেন।
- **এডমিন**: সবার খরচ এডিট বা মুছতে পারেন, রিপোর্ট (Excel/PDF) নামাতে পারেন, সদস্য ও খাত ঠিক করতে পারেন।
- নিষ্ক্রিয় সদস্য কিছুই দেখতে বা করতে পারেন না। ভবিষ্যতের তারিখে খরচ দেওয়া যায় না।
