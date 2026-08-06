/* ════════════════════════════════════════════════════════════════════════════════════
   GARUDA production app — single file, no framework.
   Google Sheet is the SOURCE OF TRUTH. localStorage is only (a) a paint-fast cache and
   (b) an offline write queue. Every save is an UPSERT on a deterministic key, so moving
   between tabs (or editing later) can never create a duplicate row.
   ════════════════════════════════════════════════════════════════════════════════════ */
var API_URL   = 'https://script.google.com/macros/s/AKfycbwPZxZ8QbY-Pm_PzgdvtH0Gp6tYo94_w2Vvy9wNi1tkGMCNoer_xb9OMur4IB8HZlZrbg/exec';
var API_TOKEN = 'GARUDA-2026';                /* ← must match backend.gs */

/* ─────────── tiny helpers ─────────── */
var $ = function (id) { return document.getElementById(id); };
var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
  return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]; }); };
var val = function (id) { var e = $(id); return e ? String(e.value || '').trim() : ''; };
var num = function (v) { v = parseFloat(v); return isNaN(v) ? 0 : v; };
var iso = function (d) { d = d ? new Date(d) : new Date();
  return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); };
var p2 = function (n) { return ('0' + n).slice(-2); };
var today = function () { return iso(); };
var dmy = function (s) { if (!s) return '—'; var t = toISO(s); var a = t.split('-');
  return a.length === 3 ? a[2] + '-' + a[1] + '-' + a[0] : s; };
var MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var monthName = function (m) { var a = String(m || '').split('-'); return a[1] ? MON[+a[1] - 1] + ' ' + a[0] : ''; };
var inr = function (n) { return '₹' + Math.round(num(n)).toLocaleString('en-IN'); };
var lakh = function (n) { return (Math.round(num(n) * 100) / 100).toFixed(2); };
var uid = function (p) { return (p || 'X') + '_' + Date.now() + Math.random().toString(36).slice(2, 6); };
/* every date that touches the sheet goes through this — never DD-MM-YYYY (Sheets reads it as MM-DD) */
function toISO(v) {
  if (!v) return '';
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  var m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return m[3] + '-' + p2(m[2]) + '-' + p2(m[1]);
  var M = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
  var m2 = s.match(/^(\d{1,2})[-\/ ]([A-Za-z]{3})[A-Za-z]*[-\/ ](\d{2,4})$/);
  if (m2) { var mo = M.indexOf(m2[2].toLowerCase()) + 1, y = m2[3].length === 2 ? '20' + m2[3] : m2[3];
    if (mo) return y + '-' + p2(mo) + '-' + p2(m2[1]); }
  var d = new Date(s);
  return isNaN(d.getTime()) ? s : iso(d);
}
function toast(m, ms) { var t = $('toast'); t.textContent = I18n.s(m); t.classList.add('on');
  clearTimeout(t._t); t._t = setTimeout(function () { t.classList.remove('on'); }, ms || 2600); }
/* the chip carries a live spinner while the message is a "still working" one (⏳ or a trailing …) */
function syncChip(m, on) { var s = $('sync');
  s.innerHTML = (/⏳|…/.test(m) ? '<span class="spin"></span> ' : '') + esc(I18n.s(m));
  s.classList.toggle('on', on !== false);
  clearTimeout(s._t); if (on !== false) s._t = setTimeout(function () { s.classList.remove('on'); }, 2800); }
function togglePwd(id, b) { var e = $(id); e.type = e.type === 'password' ? 'text' : 'password'; b.textContent = e.type === 'password' ? '' : ''; }

/* ═══════════════ LANGUAGE ═══════════════
   The app is written in Hinglish, and **English is the default** — so the screens are translated on
   the way out rather than every literal being wrapped at its call site.

   HOW: one pass over the rendered HTML, replacing only the TEXT RUNS between tags (plus the
   placeholder / title / value attributes a user reads). Nothing inside a tag is touched, so markup,
   ids and the JS in an onclick can never be corrupted. All the phrases are compiled into ONE regex,
   longest first, so a render costs a single scan instead of 400 string passes, and a short phrase can
   never eat a longer one it is part of.
   Interpolated values fall out naturally: "29-07-2026 · plan save karke…" matches the sentence and
   leaves the date alone. */
var I18n = {
  lang:'en',
  /* 'hing' is the language the app is WRITTEN in, so it needs no dictionary */
  LANGS:[['en','English'], ['hi','हिंदी — Hindi'], ['hing','Hinglish'], ['bn','বাংলা — Bengali'],
         ['ta','தமிழ் — Tamil'], ['te','తెలుగు — Telugu'], ['or','ଓଡ଼ିଆ — Odia']],
  D:{},                                     /* lang → { Hinglish phrase: translation } */
  EN:{},                                    /* alias of D.en, filled just below */
  _re:null, _reFor:'',
  name: function (l) {
    var f = I18n.LANGS.filter(function (x) { return x[0] === (l || I18n.lang); })[0];
    return f ? f[1] : 'English';
  },
  code: function (l) { l = l || I18n.lang; return l === 'hing' ? 'HIN' : l.toUpperCase(); },
  boot: function () {
    var v = null;
    try { v = localStorage.getItem('g2_lang'); } catch (e) {}
    if (v === 'hi' && !I18n.D.hi) v = 'hing';          /* legacy: 'hi' once meant Hinglish */
    I18n.lang = I18n.LANGS.some(function (x) { return x[0] === v; }) ? v : 'en';
  },
  set: function (l) {
    if (!I18n.LANGS.some(function (x) { return x[0] === l; })) l = 'en';
    I18n.lang = l;
    try { localStorage.setItem('g2_lang', l); } catch (e) {}
    if (typeof UI !== 'undefined') UI.close();
    if (typeof Nav !== 'undefined') Nav.build();
    if (typeof render === 'function') render();
    if (typeof Auth !== 'undefined' && Auth.session()) Auth.chrome();
    toast(I18n.name(l));
  },
  /* one tap from any screen — the chip lives in the topbar */
  pick: function () {
    UI.sheet('Language', I18n.LANGS.map(function (x) {
      return '<button class="btn ' + (x[0] === I18n.lang ? '' : 'ghost') + '" style="margin-bottom:8px" ' +
        'onclick="I18n.set(\'' + x[0] + '\')">' + esc(x[1]) + '</button>'; }).join('') +
      '<div class="hint">Jo phrase abhi translate nahi hua, wo English me dikhega.</div>');
  },
  /* the chosen dictionary, with English as the fallback for anything not translated yet — a screen is
     then "chosen language over English", never "half Hinglish" */
  map: function () { return I18n.D[I18n.lang] || {}; },
  look: function (m) {
    var d = I18n.map();
    if (d[m] != null) return d[m];
    if (I18n.lang !== 'hing' && I18n.D.en && I18n.D.en[m] != null) return I18n.D.en[m];
    return m;
  },
  re: function () {
    if (I18n._re && I18n._reFor === I18n.lang) return I18n._re;
    var seen = {}, keys = [];
    [I18n.map(), (I18n.lang === 'hing' ? {} : I18n.D.en || {})].forEach(function (d) {
      Object.keys(d).forEach(function (k) { if (k && !seen[k]) { seen[k] = 1; keys.push(k); } });
    });
    keys.sort(function (a, b) { return b.length - a.length; });
    var esc2 = keys.map(function (k) { return k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); });
    I18n._re = esc2.length ? new RegExp(esc2.join('|'), 'g') : null;
    I18n._reFor = I18n.lang;
    return I18n._re;
  },
  /* "12 din", "4 store" — a count and its unit are built by concatenation, so the unit alone is the
     only translatable part. Only ever applied right after a number, which is what makes it safe:
     a bare "din" inside another word or sentence is never touched. */
  /* singular and plural: "1 stores" reads like a bug to the person holding the phone */
  RX:[[/(\d+)\s+din\b/g, 'day', 'days'], [/(\d+)\s+DIN\b/g, 'DAY', 'DAYS'],
      [/(\d+)\s+ghante\b/g, 'hour', 'hours'], [/(\d+)\s+minute\b/g, 'min', 'min'],
      [/(\d+)\s+store\b/g, 'store', 'stores'], [/(\d+)\s+audit\b/g, 'audit', 'audits'],
      [/(\d+)\s+dukaan\b/g, 'shop', 'shops'], [/(\d+)\s+request\b/g, 'request', 'requests'],
      [/(\d+)\s+photo\b/g, 'photo', 'photos'], [/(\d+)\s+user\b/g, 'user', 'users'],
      /* the download and delete screens count rows out loud — 1 rows reads like a bug */
      [/(\d+)\s+rows?\b/g, 'row', 'rows'], [/(\d+)\s+draft\b/g, 'draft', 'drafts'],
      [/(\d+)\s+reports?\b/g, 'report', 'reports'], [/(\d+)\s+employees?\b/g, 'employee', 'employees'],
      [/(\d+)\s+line\b/g, 'line', 'lines'], [/(\d+)\s+tab\b/g, 'tab', 'tabs']],
  /* translate a plain string (a toast, a dialog title, a canvas label) */
  s: function (str) {
    if (I18n.lang === 'hing' || str == null) return str;
    var re = I18n.re(); if (!re) return str;
    var out = String(str).replace(re, I18n.look);
    /* the "N din" rules produce English, so they only apply when English is what we are showing */
    if (I18n.lang === 'en') I18n.RX.forEach(function (r) {
      out = out.replace(r[0], function (m, n) { return n + ' ' + (+n === 1 ? r[1] : r[2]); });
    });
    return out;
  },
  /* translate an HTML fragment: text runs and reader-facing attributes only */
  tr: function (html) {
    if (I18n.lang === 'hing' || html == null) return html;
    var re = I18n.re(); if (!re) return html;
    var out = String(html).replace(/>([^<]+)</g, function (all, txt) { return '>' + I18n.s(txt) + '<'; });
    out = out.replace(/(placeholder|title)="([^"]*)"/g, function (all, a, v) { return a + '="' + I18n.s(v) + '"'; });
    return out;
  }
};

/* ── the other languages ──
   Core coverage: nav, headings, every button, the workflow gates and the common toasts — i.e. what a
   rep touches all day. Anything not listed falls back to ENGLISH (never to Hinglish), so a screen
   reads as "this language over English" rather than a mixture. */
I18n.D.hi = {
  'Din ka Report':'दिन की रिपोर्ट',
  'Store visits':'स्टोर विज़िट',
  'Order lines':'ऑर्डर लाइन',
  'Brand split':'ब्रांड वाइज़',
  'POSM':'POSM',
  'Naye outlet':'नए आउटलेट',
  'Home':'होम', 'Plan':'प्लान', 'Field':'फील्ड', 'Orders':'ऑर्डर', 'Summary':'सारांश',
  'Requests':'रिक्वेस्ट', 'More':'और', 'Console':'कंसोल', 'Approvals':'अप्रूवल',
  'Aaj ka Plan':'आज का प्लान', 'PJP approved':'PJP अप्रूव्ड', 'Change PJP':'PJP बदलें',
  'Working With':'किसके साथ काम', 'State':'राज्य', 'Town / City':'शहर', 'Beat / Market':'बीट / मार्केट',
  'Aaj ka target':'आज का टारगेट', 'Save plan':'प्लान सेव करें', 'Send WhatsApp':'WhatsApp पर भेजें',
  'Send again':'दोबारा भेजें', 'Preview':'देखें', 'Cancel':'रद्द करें', 'Send for approval':'अप्रूवल के लिए भेजें',
  'add new…':'नया जोड़ें…', '— master me kuch nahi mila —':'— मास्टर में कुछ नहीं मिला —',
  'Self Working':'खुद काम', 'With ME Sales Team':'ME सेल्स टीम के साथ', 'With BA Supervisor':'BA सुपरवाइज़र के साथ',
  'Meeting / Activity':'मीटिंग / एक्टिविटी', 'Weekly Off':'साप्ताहिक छुट्टी', 'Leave':'छुट्टी',
  'Sick Leave':'बीमारी की छुट्टी', 'HO Holiday':'HO छुट्टी',
  'Reason':'कारण', 'Remark':'रिमार्क', 'Nahi':'नहीं', 'Haan':'हाँ', 'Theek hai':'ठीक है',
  'Store select karo':'दुकान चुनें', 'Product add karo':'प्रोडक्ट जोड़ें', 'Shop ka photo':'दुकान का फोटो',
  'Tracker':'ट्रैकर', 'Performance':'परफॉर्मेंस', 'Summary':'सारांश', 'New outlets':'नए आउटलेट', 'Orders':'ऑर्डर',
  'Naya outlet':'नया आउटलेट', 'Remarks':'रिमार्क्स', 'Aaj':'आज', 'Total':'कुल',
  'Mere orders':'मेरे ऑर्डर', 'Mera performance':'मेरा परफॉर्मेंस', 'Meri requests':'मेरी रिक्वेस्ट',
  'EOD — din close karo':'EOD — दिन बंद करें', 'Aaj ka kaam':'आज का काम', 'Visits':'विज़िट',
  'Order mila':'ऑर्डर मिला', 'Naye outlet':'नए आउटलेट', 'Pending':'पेंडिंग', 'Done':'हो गया',
  '✏️ Bheja nahi':'भेजा नहीं', 'Approve karo':'अप्रूव करें', 'Reject karo':'रिजेक्ट करें',
  'Pehle plan save karo':'पहले प्लान सेव करें', 'Plan save ho gaya':'प्लान सेव हो गया',
  'Sheet se data aa raha hai…':'शीट से डेटा आ रहा है…', 'Load ho raha hai…':'लोड हो रहा है…',
  'Bhej raha hai…':'भेज रहे हैं…', 'Save ho raha hai…':'सेव हो रहा है…',
  'Edit mode chalu hai':'एडिट मोड चालू है', 'Approved plan edit karo':'अप्रूव्ड प्लान एडिट करें',
  'Update publish karo':'अपडेट पब्लिश करें', 'Publish update — rep ko bhejo':'अपडेट पब्लिश करें — रेप को भेजें',
  'Notifications — poori team':'नोटिफिकेशन — पूरी टीम', 'Meri notifications':'मेरी नोटिफिकेशन',
  'Naya':'नया', 'Dekh liya':'देख लिया', 'Dekh liya — band karo':'देख लिया — बंद करें',
  'Kya badla':'क्या बदला', 'Kuch change nahi hua':'कुछ नहीं बदला'
};
I18n.D.bn = {
  'Din ka Report':'দিনের রিপোর্ট',
  'Store visits':'স্টোর ভিজিট',
  'Order lines':'অর্ডার লাইন',
  'Brand split':'ব্র্যান্ড অনুযায়ী',
  'POSM':'POSM',
  'Naye outlet':'নতুন আউটলেট',
  'Home':'হোম', 'Plan':'প্ল্যান', 'Field':'ফিল্ড', 'Orders':'অর্ডার', 'Summary':'সারসংক্ষেপ',
  'Requests':'অনুরোধ', 'More':'আরও', 'Console':'কনসোল', 'Approvals':'অনুমোদন',
  'Aaj ka Plan':'আজকের প্ল্যান', 'PJP approved':'PJP অনুমোদিত', 'Change PJP':'PJP বদলান',
  'Working With':'কার সঙ্গে কাজ', 'State':'রাজ্য', 'Town / City':'শহর', 'Beat / Market':'বিট / মার্কেট',
  'Aaj ka target':'আজকের টার্গেট', 'Save plan':'প্ল্যান সেভ করুন', 'Send WhatsApp':'WhatsApp-এ পাঠান',
  'Send again':'আবার পাঠান', 'Preview':'দেখুন', 'Cancel':'বাতিল', 'Send for approval':'অনুমোদনের জন্য পাঠান',
  'add new…':'নতুন যোগ করুন…', 'Self Working':'নিজে কাজ', 'Leave':'ছুটি', 'Weekly Off':'সাপ্তাহিক ছুটি',
  'Reason':'কারণ', 'Remark':'মন্তব্য', 'Nahi':'না', 'Haan':'হ্যাঁ', 'Theek hai':'ঠিক আছে',
  'Store select karo':'দোকান বাছুন', 'Product add karo':'পণ্য যোগ করুন', 'Shop ka photo':'দোকানের ছবি',
  'Tracker':'ট্র্যাকার', 'Performance':'পারফরম্যান্স', 'Summary':'সারসংক্ষেপ', 'New outlets':'নতুন আউটলেট', 'Orders':'অর্ডার',
  'Naya outlet':'নতুন আউটলেট', 'Remarks':'মন্তব্য', 'Aaj':'আজ', 'Total':'মোট',
  'Mere orders':'আমার অর্ডার', 'Mera performance':'আমার পারফরম্যান্স', 'Meri requests':'আমার অনুরোধ',
  'Visits':'ভিজিট', 'Pending':'বাকি', 'Done':'হয়েছে',
  'Load ho raha hai…':'লোড হচ্ছে…', 'Bhej raha hai…':'পাঠানো হচ্ছে…'
};
I18n.D.ta = {
  'Din ka Report':'நாள் அறிக்கை',
  'Store visits':'கடை வருகைகள்',
  'Order lines':'ஆர்டர் வரிகள்',
  'Brand split':'பிராண்ட் வாரியாக',
  'POSM':'POSM',
  'Naye outlet':'புதிய கடைகள்',
  'Home':'முகப்பு', 'Plan':'திட்டம்', 'Field':'களம்', 'Orders':'ஆர்டர்', 'Summary':'சுருக்கம்',
  'Requests':'கோரிக்கை', 'More':'மேலும்', 'Console':'கன்சோல்', 'Approvals':'ஒப்புதல்',
  'Aaj ka Plan':'இன்றைய திட்டம்', 'PJP approved':'PJP ஒப்புதல்', 'Change PJP':'PJP மாற்று',
  'Working With':'யாருடன் வேலை', 'State':'மாநிலம்', 'Town / City':'நகரம்', 'Beat / Market':'பீட் / மார்க்கெட்',
  'Aaj ka target':'இன்றைய இலக்கு', 'Save plan':'திட்டத்தை சேமி', 'Send WhatsApp':'WhatsApp-ல் அனுப்பு',
  'Send again':'மீண்டும் அனுப்பு', 'Preview':'பார்', 'Cancel':'ரத்து', 'Send for approval':'ஒப்புதலுக்கு அனுப்பு',
  'add new…':'புதிதாக சேர்…', 'Self Working':'தனியாக வேலை', 'Leave':'விடுப்பு', 'Weekly Off':'வார விடுமுறை',
  'Reason':'காரணம்', 'Remark':'குறிப்பு', 'Nahi':'இல்லை', 'Haan':'ஆம்', 'Theek hai':'சரி',
  'Store select karo':'கடையை தேர்வு செய்', 'Product add karo':'பொருள் சேர்', 'Shop ka photo':'கடையின் புகைப்படம்',
  'Tracker':'டிராக்கர்', 'Performance':'செயல்திறன்', 'Summary':'சுருக்கம்', 'New outlets':'புதிய கடைகள்', 'Orders':'ஆர்டர்கள்',
  'Naya outlet':'புதிய கடை', 'Remarks':'குறிப்புகள்', 'Aaj':'இன்று', 'Total':'மொத்தம்',
  'Mere orders':'என் ஆர்டர்கள்', 'Mera performance':'என் செயல்திறன்', 'Meri requests':'என் கோரிக்கைகள்',
  'Visits':'வருகைகள்', 'Pending':'நிலுவை', 'Done':'முடிந்தது',
  'Load ho raha hai…':'ஏற்றுகிறது…', 'Bhej raha hai…':'அனுப்புகிறது…'
};
I18n.D.te = {
  'Din ka Report':'రోజు రిపోర్ట్',
  'Store visits':'స్టోర్ విజిట్లు',
  'Order lines':'ఆర్డర్ లైన్లు',
  'Brand split':'బ్రాండ్ వారీగా',
  'POSM':'POSM',
  'Naye outlet':'కొత్త అవుట్‌లెట్లు',
  'Home':'హోమ్', 'Plan':'ప్లాన్', 'Field':'ఫీల్డ్', 'Orders':'ఆర్డర్లు', 'Summary':'సారాంశం',
  'Requests':'అభ్యర్థనలు', 'More':'మరిన్ని', 'Console':'కన్సోల్', 'Approvals':'ఆమోదాలు',
  'Aaj ka Plan':'ఈరోజు ప్లాన్', 'PJP approved':'PJP ఆమోదం', 'Change PJP':'PJP మార్చు',
  'Working With':'ఎవరితో పని', 'State':'రాష్ట్రం', 'Town / City':'పట్టణం', 'Beat / Market':'బీట్ / మార్కెట్',
  'Aaj ka target':'ఈరోజు టార్గెట్', 'Save plan':'ప్లాన్ సేవ్ చేయి', 'Send WhatsApp':'WhatsApp లో పంపు',
  'Send again':'మళ్ళీ పంపు', 'Preview':'చూడు', 'Cancel':'రద్దు', 'Send for approval':'ఆమోదానికి పంపు',
  'add new…':'కొత్తది జోడించు…', 'Self Working':'స్వయంగా పని', 'Leave':'సెలవు', 'Weekly Off':'వారపు సెలవు',
  'Reason':'కారణం', 'Remark':'వ్యాఖ్య', 'Nahi':'కాదు', 'Haan':'అవును', 'Theek hai':'సరే',
  'Store select karo':'దుకాణం ఎంచుకో', 'Product add karo':'ఉత్పత్తి జోడించు', 'Shop ka photo':'దుకాణం ఫోటో',
  'Tracker':'ట్రాకర్', 'Performance':'పనితీరు', 'Summary':'సారాంశం', 'New outlets':'కొత్త అవుట్‌లెట్‌లు', 'Orders':'ఆర్డర్‌లు',
  'Naya outlet':'కొత్త అవుట్‌లెట్', 'Remarks':'వ్యాఖ్యలు', 'Aaj':'ఈరోజు', 'Total':'మొత్తం',
  'Mere orders':'నా ఆర్డర్లు', 'Mera performance':'నా పనితీరు', 'Meri requests':'నా అభ్యర్థనలు',
  'Visits':'విజిట్లు', 'Pending':'పెండింగ్', 'Done':'పూర్తి',
  'Load ho raha hai…':'లోడ్ అవుతోంది…', 'Bhej raha hai…':'పంపుతోంది…'
};
I18n.D.or = {
  'Din ka Report':'ଦିନର ରିପୋର୍ଟ',
  'Store visits':'ଷ୍ଟୋର ଭିଜିଟ',
  'Order lines':'ଅର୍ଡର ଲାଇନ',
  'Brand split':'ବ୍ରାଣ୍ଡ ଅନୁସାରେ',
  'POSM':'POSM',
  'Naye outlet':'ନୂଆ ଆଉଟଲେଟ',
  'Home':'ହୋମ', 'Plan':'ଯୋଜନା', 'Field':'ଫିଲ୍ଡ', 'Orders':'ଅର୍ଡର', 'Summary':'ସାରାଂଶ',
  'Requests':'ଅନୁରୋଧ', 'More':'ଅଧିକ', 'Console':'କନସୋଲ', 'Approvals':'ଅନୁମୋଦନ',
  'Aaj ka Plan':'ଆଜିର ଯୋଜନା', 'PJP approved':'PJP ଅନୁମୋଦିତ', 'Change PJP':'PJP ବଦଳାନ୍ତୁ',
  'Working With':'କାହା ସହ କାମ', 'State':'ରାଜ୍ୟ', 'Town / City':'ସହର', 'Beat / Market':'ବିଟ / ମାର୍କେଟ',
  'Aaj ka target':'ଆଜିର ଟାର୍ଗେଟ', 'Save plan':'ଯୋଜନା ସେଭ କରନ୍ତୁ', 'Send WhatsApp':'WhatsApp ରେ ପଠାନ୍ତୁ',
  'Send again':'ପୁଣି ପଠାନ୍ତୁ', 'Preview':'ଦେଖନ୍ତୁ', 'Cancel':'ବାତିଲ', 'Send for approval':'ଅନୁମୋଦନ ପାଇଁ ପଠାନ୍ତୁ',
  'add new…':'ନୂଆ ଯୋଡ଼ନ୍ତୁ…', 'Self Working':'ନିଜେ କାମ', 'Leave':'ଛୁଟି', 'Weekly Off':'ସାପ୍ତାହିକ ଛୁଟି',
  'Reason':'କାରଣ', 'Remark':'ମନ୍ତବ୍ୟ', 'Nahi':'ନା', 'Haan':'ହଁ', 'Theek hai':'ଠିକ ଅଛି',
  'Store select karo':'ଦୁକାନ ବାଛନ୍ତୁ', 'Product add karo':'ପ୍ରଡକ୍ଟ ଯୋଡ଼ନ୍ତୁ', 'Shop ka photo':'ଦୁକାନର ଫଟୋ',
  'Tracker':'ଟ୍ରାକର', 'Performance':'ପ୍ରଦର୍ଶନ', 'Summary':'ସାରାଂଶ', 'New outlets':'ନୂଆ ଆଉଟଲେଟ', 'Orders':'ଅର୍ଡର',
  'Naya outlet':'ନୂଆ ଆଉଟଲେଟ', 'Remarks':'ମନ୍ତବ୍ୟ', 'Aaj':'ଆଜି', 'Total':'ମୋଟ',
  'Mere orders':'ମୋର ଅର୍ଡର', 'Mera performance':'ମୋର ପ୍ରଦର୍ଶନ', 'Meri requests':'ମୋର ଅନୁରୋଧ',
  'Visits':'ଭିଜିଟ', 'Pending':'ବାକି', 'Done':'ହୋଇଗଲା',
  'Load ho raha hai…':'ଲୋଡ ହେଉଛି…', 'Bhej raha hai…':'ପଠାଉଛି…'
};

/* Hinglish → English. Keys are the phrases as they appear in the rendered text, longest matched
   first. Sentence fragments are here too (a phrase split by <b>…</b> arrives as two runs). */
I18n.D.en = I18n.EN = {
  /* ── sync / network / auth ── */
  'Load ho raha hai…':'Loading…',
  'Sheet se data aa raha hai…':'Fetching data from the sheet…',
  'Sheet se data aa raha hai…':'Fetching data from the sheet…',
  'Sheet se sync ho gaya':'Synced with the sheet',
  '! Sync fail — offline data':'! Sync failed — showing offline data',
  '! Offline — local data':'! Offline — local data',
  'Queue me — internet aane par jayega':'Queued — will send when you are online',
  'Sheet me save':'Saved to the sheet',
  'Offline — queue me save':'Offline — saved to the queue',
  'pending sync ho gaya':'pending item(s) synced',
  'pending sync':'pending sync',
  'Ruko — pehla request chal raha hai':'Wait — the first request is still running',
  'Bhej raha hai…':'Sending…',
  'Email aur password dono bharo':'Enter both email and password',
  'Ye email register nahi hai':'This email is not registered',
  'Account inactive hai — admin se baat karo':'Account is inactive — talk to your admin',
  'Password galat hai':'Wrong password',
  'Offline ho — pehli baar login ke liye internet chahiye':'You are offline — the first login needs internet',
  'Server se connect nahi hua — API_URL check karo':'Could not reach the server — check API_URL',
  'Network error — dobara try karo':'Network error — please try again',
  'Naya password kam se kam 6 character ka ho':'The new password must be at least 6 characters',
  'Dono password match nahi kar rahe':'The two passwords do not match',
  'Naya password purane se different hona chahiye':'The new password must be different from the old one',
  'Save ho raha hai…':'Saving…',
  'Save nahi hua — dobara try karo':'Not saved — please try again',
  'Password change ho gaya':'Password changed',
  'Email bharo':'Enter your email',
  'Registered mobile number bharo':'Enter your registered mobile number',
  'Check ho raha hai…':'Checking…',
  'Reset nahi hua':'Reset failed',
  'Password reset ho gaya — ab login karo':'Password reset — you can log in now',
  'Employee nahi mila':'Employee not found',
  '! API_URL set karo (index.html me) — backend se connect nahi hoga':'! Set API_URL in index.html — the backend cannot be reached',

  /* ── preview / bypass ── */
  '— unka aaj ka live status. Kuch bhi save nahi hoga.':'— their live status for today. Nothing will be saved.',
  'Preview band':'Preview closed',
  'Preview band karo':'Close preview',
  'Photo compulsory nahi rahegi (gallery se bhi chalega)':'Photos are no longer compulsory (gallery upload allowed)',
  'Tab ka order (PJP → Plan → Notify → Field) nahi rokega':'The tab order (PJP → Plan → Notify → Field) will not block',
  'PJP adhoora bhi bhej sakte ho, window ke bahar bhi':'PJP can be sent incomplete, and outside the window',
  '· photo aur tab-order optional hain':'· photos and tab order are optional',
  'Kya kya?':'What exactly?',
  'Bypass ON hai':'Bypass is ON',
  'Aapke liye ye restrictions hata di gayi hain:':'These restrictions have been lifted for you:',
  'Baaki sab wahi hai — store, distributor, town/beat, order status aur remarks':'Everything else stays — store, distributor, town/beat, order status and remarks',
  'bharna zaroori hai.':'are still required.',
  'Kisne di:':'Granted by:',

  /* ── gate messages ── */
  'PJP HOD ke paas hai (':'Your PJP is with the HOD (',
  ') — approve hone ke baad Plan khulega. Aapka bhara hua plan safe hai.':') — Plan opens once it is approved. What you filled is safe.',
  'PJP reject hua — PJP tab me reason dekho aur dobara bhejo':'PJP was rejected — see the reason in the PJP tab and resend',
  'Pehle is month ka PJP banao aur HOD se approve karwao':'First build this month’s PJP and get the HOD to approve it',
  'Plan HOD ko bhejo (Notify) — tabhi Field khulega':'Send the plan to your HOD — Field opens after that',
  'Pehle aaj ka Plan save karo':'Save today’s plan first',
  'Pehle Field me ek store ka kaam save karo':'Save at least one store in Field first',
  'Locked':'Locked',

  /* ── shell / dialogs ── */
  'Aur options':'More options',
  'Ye field bharna zaroori hai':'This field is required',
  'Nahi':'No',
  'Haan':'Yes',
  'Bhejo':'Send',
  'Theek hai':'OK',
  'Abhi nahi':'Not now',
  'Data load ho raha hai…':'Loading data…',
  '· sheet se aa raha hai':'· coming from the sheet',
  'tab download ho gaye':'tabs downloaded',
  '.csv download ho gaya':'.csv downloaded',
  'Last sync':'Last sync',
  'Sync now':'Sync now',

  /* ── the WhatsApp card ── */
  'Aaj field day nahi —':'Not a field day today —',
  'Order target 0. SC / NSO / MSL bhi 0.':'Order target 0. SC / NSO / MSL are 0 too.',
  'Preview nahi ban paya — image ab bhi bhej sakte ho.':'Preview could not be built — you can still send the image.',
  'Pehle plan save karo':'Save the plan first',
  'Image bhej rahe hain…':'Sending the image…',
  'Image bhej di — Field khul gaya':'Image sent — Field is now open',
  'Bhejna cancel ho gaya':'Sending was cancelled',
  '! Image nahi ban payi — text bhej rahe hain':'! Could not build the image — sending text instead',
  'Image download ho gayi':'Image downloaded',
  'Is device par app seedha image share nahi kar sakta.':'This device cannot share the image directly from the app.',
  'download ho gayi hai':'has been downloaded',
  'aur WhatsApp khul gaya hai — wahan':'and WhatsApp is open — ',
  'karke bhej do.':'it there and send.',
  'Aisi image jayegi':'This is what will be sent',

  /* ── home ── */
  'PJP HOD ke paas hai':'PJP is with the HOD',
  'ka plan bheja hua hai — aapka bhara hua data safe hai, approval ka wait karo':'plan has been sent — your data is safe, wait for approval',
  'PJP tab me reason dekho aur dusra plan bhejo':'See the reason in the PJP tab and send a different plan',
  'PJP adhoora hai':'PJP is incomplete',
  'Bhara hua plan wahin hai — poora karke HOD ko bhejo':'What you filled is still there — complete it and send to the HOD',
  'PJP band hai':'The PJP is shut',
  'PJP banao':'Build your PJP',
  'Is month ka beat plan banao aur HOD ko bhejo':'Build this month’s beat plan and send it to the HOD',
  'Plan HOD ko bhejo':'Send the plan to your HOD',
  'Notify karo — tabhi Field khulega':'Notify — Field opens after that',
  'Aaj ka Plan save karo':'Save today’s plan',
  'Town, beat aur target confirm karo':'Confirm town, beat and target',
  'Field shuru karo':'Start field work',
  'Store select karke order punch karo':'Pick a store and punch the order',
  'Kaam chalu hai':'Work in progress',
  'Store complete karke EOD close karo':'Finish the stores and close EOD',
  'Namaste,':'Hello,',
  'Aaj ka PJP:':'Today’s PJP:',
  'Aaj ka PJP master me nahi mila':'Today’s PJP was not found in the master',
  'Din lock hai — EOD tab se dobara khol sakte ho':'The day is locked — you can reopen it from the EOD tab',
  'Visits':'Visits',
  'Order mila':'Orders won',
  'Naye outlet':'New outlets',
  'request HOD ke paas hai':'request(s) with the HOD',
  'request par decision aa gaya':'request(s) decided',
  'Dekho':'View',
  'Chalo':'Go',
  'aur':'more',
  'Pending orders — ASM se follow-up':'Pending orders — follow up with your ASM',
  'din purana':'days old',
  'Sab dekho':'View all',
  'Aaj ka kaam':'Today’s work',
  'AB YE KARO':'DO THIS NOW',
  'Field visits':'Field visits',
  'EOD close':'Close EOD',
  'Notified':'Notified',
  'Notify pending':'Notify pending',
  'Pending':'Pending',
  'Done':'Done',
  'audit':'audits',

  /* ── PJP ── */
  'Poore month ka beat plan — har din ka town aur beat bharo.':'The whole month’s beat plan — fill town and beat for every day.',
  ', duplicate nahi banega.':', no duplicates are created.',
  'Har change turant':'Every change is saved straight into',
  'tab me save hota hai (ek hi row per month — duplicate nahi banti). Approve hone par har din ki alag row':'(one row per month — never a duplicate). Once approved, one row per day goes into',
  'me chali jayegi.':'.',
  'Ye plan':'This plan',
  'Master_PJP me publish':'published to Master_PJP',
  'ho chuka hai (':'already (',
  'din).':'days).',
  'Joining':'Joined',
  '— usse pehle ke din plan me count nahi hote.':'— days before that are not counted in the plan.',
  'Submit window band hai. PJP':'The submit window is closed. A PJP goes between the',
  'tarikh ke beech bhejna hota hai.':'of the month.',
  'din pehle se bhare hue hain':'days were already filled',
  '— wahi wapas load kiye hain, dobara bharne ki zaroorat nahi.':'— they are loaded back, no need to fill them again.',
  'din pending hai (':'day(s) still pending (',
  '). Har working day me City + Beat bharo ya Off karo.':'). Fill City + Beat on every working day, or mark it Off.',
  'Poora month plan ho gaya — ab HOD ko bhej sakte ho.':'The whole month is planned — you can send it to the HOD now.',
  'Ye PJP':'This PJP is',
  '. Change karna ho to HOD se baat karo.':'. Talk to your HOD if it needs changing.',
  'PJP se auto-fill':'Auto-fill from PJP',
  'Already sent — HOD ke paas hai':'Already sent — with the HOD',
  'Adhoora hi bhej do (bypass)':'Send it incomplete (bypass)',
  'HOD ko bhejo':'Send to HOD',
  'Din-wise plan':'Day-wise plan',
  'Joining se pehle — plan required nahi':'Before joining — no plan needed',
  '! Town aur Beat dono bharo — tabhi ye din complete hoga.':'! Fill both Town and Beat — only then is this day complete.',
  'Master_PJP me is month ka (joining ke baad ka) data nahi hai':'Master_PJP has no data for this month (after your joining date)',
  'din Master PJP se fill ho gaye':'days filled from the master PJP',
  '(joining ke baad ke)':'(the ones after joining)',
  'Kam se kam ek field day plan karo':'Plan at least one field day',
  'Pehle poora month plan karo':'Complete the whole month first',
  'Submit window band hai (27–1)':'The submit window is closed (27th–1st)',
  'PJP HOD ko bhejna hai?':'Send this PJP to the HOD?',
  'ka plan —':'plan —',
  'field din':'field days',
  'bhare hue hain.':'are filled.',
  'Bhejne ke baad aap edit nahi kar paoge.':'You will not be able to edit it after sending.',
  'Haan, bhej do':'Yes, send it',
  'Bhej raha hai…':'Sending…',
  'PJP HOD ko chala gaya':'PJP has gone to the HOD',
  'Field days filled':'Field days filled',
  'Off / Leave':'Off / Leave',
  'Status':'Status',
  'Complete':'Complete',

  /* ── plan (today) ── */
  'Aaj ka Plan':'Today’s Plan',
  '· plan save karke HOD ko notify karo — tabhi Field khulega.':'· save the plan and notify your HOD — Field opens after that.',
  'PJP approved':'PJP approved',
  '*Approved by HOD — ye master se aata hai, edit nahi hota.':'*Approved by HOD — this comes from the master and cannot be edited.',
  'me nahi mila — apne code':'has no entry for your code',
  'ke liye. Admin se master update karwao, ya niche':'. Ask your admin to update the master, or use',
  'karke HOD approval lo.':'below to get the HOD’s approval.',
  'Change PJP':'Change PJP',
  '*PJP cannot be changed without approval — kuch bhi badla to HOD ko request jayegi.':'*PJP cannot be changed without approval — any change sends a request to the HOD.',
  'Working With':'Working With',
  '(aaj kya kar rahe ho?)':'(what are you doing today?)',
  'Self Working':'Self Working',
  'With ME Sales Team':'With ME Sales Team',
  'With BA Supervisor':'With BA Supervisor',
  'Meeting / Activity':'Meeting / Activity',
  'Weekly Off':'Weekly Off',
  'Leave':'Leave',
  'Sick Leave':'Sick Leave',
  'HO Holiday':'HO Holiday',
  'Sales person ka naam':'Sales person’s name',
  'BA Supervisor ka naam':'BA Supervisor’s name',
  'Type chuno…':'Choose a type…',
  'Duration':'Duration',
  'Remark':'Remark',
  'Reason':'Reason',
  'Leave ka reason':'Reason for the leave',
  'Short remark':'Short remark',
  'Town / City & Beat':'Town / City & Beat',
  'Approved PJP':'Approved PJP',
  'Change PJP':'Change PJP',
  '*Approved by HOD':'*Approved by HOD',
  '*Approval ke bina change nahi':'*No change without approval',
  'State':'State',
  '(PJP mapping)':'(PJP mapping)',
  '(as per PJP)':'(as per PJP)',
  '(master se)':'(from the master)',
  'Town / City':'Town / City',
  'Beat / Market':'Beat / Market',
  '— master me kuch nahi mila —':'— nothing found in the master —',
  'Add new…':'Add new…',
  'Ye HOD approval ke baad master me add hoga.':'This is added to the master after the HOD approves.',
  '! PJP se different town/beat = HOD approval zaroori.':'! A town/beat different from the PJP needs the HOD’s approval.',
  'HOD approval pending':'HOD approval pending',
  '— aapne plan change kiya hai (':'— you changed the plan (',
  '). Approve hone ke baad target khulega.':'). The target opens once it is approved.',
  'HOD ne change reject kiya':'The HOD rejected the change',
  '. Dobara bhejo ya PJP wala beat karo.':'. Send again, or work the PJP beat.',
  'Koi order / SC / NSO target nahi. Plan save karke HOD ko bhej do.':'No order / SC / NSO target. Save the plan and send it to your HOD.',
  'Aaj ka target':'Today’s target',
  'SC (calls)':'SC (calls)',
  'NSO (naye outlet)':'NSO (new outlets)',
  'Target ₹L / din':'Target ₹L / day',
  'Plan save karo':'Save plan',
  'Din ki shuruaat — WhatsApp image':'Start of day — WhatsApp image',
  'Yahi image group me jaati hai —':'This exact image goes to the group —',
  'edit nahi ho sakti':'it cannot be edited',
  '. Bhejne ke baad Field tab khul jayega.':'. The Field tab opens once it is sent.',
  'Pehle':'First',
  'plan save':'save the plan',
  'karo — uske baad image ban jayegi.':'— the image is built after that.',
  'Bhej diya — dobara bhejo':'Sent — send again',
  'WhatsApp par image bhejo':'Send the image on WhatsApp',
  'Bada karke dekho':'View it full size',
  'Sales person ka naam bharo':'Enter the sales person’s name',
  'BA Supervisor ka naam bharo':'Enter the BA Supervisor’s name',
  'Meeting / Activity type chuno':'Choose the meeting / activity type',
  'Remark likho':'Write a remark',
  'Leave ka reason likho':'Write the reason for the leave',
  'Town / City chuno':'Choose a town / city',
  'Beat / Market chuno':'Choose a beat / market',
  'Plan save ho gaya':'Plan saved',
  'Plan bhej diya — Field khul gaya':'Plan sent — Field is now open',
  'Reject ho chuke hain:':'Already rejected:',
  '— inme se koi dobara nahi bhej sakte, naya beat likho.':'— none of these can be sent again, pick a new beat.',
  'Request already sent — HOD approval pending':'Request already sent — HOD approval pending',
  'ke liye request bheji hui hai. HOD approve / reject karega tabhi aage badhega.':'has a request pending. It moves once the HOD approves or rejects it.',
  'HOD ne approve kar diya':'The HOD approved it',
  'Change ke liye approval bhejo':'Send the change for approval',
  'Request already sent — HOD approval ka wait karo':'Request already sent — wait for the HOD',
  'HOD ne aaj ka change approve kar diya hai — ab dobara request nahi':'The HOD already approved today’s change — no second request',
  'Ye beat HOD ne reject kiya tha — koi dusra beat chuno':'The HOD rejected this beat — choose a different one',
  'Plan change — reason?':'Plan change — reason?',
  'PJP me':'The PJP had',
  'tha, aap':', you want to go to',
  'jaana chahte ho.':'.',
  'Reason (HOD ko dikhega)':'Reason (the HOD will see it)',
  'Reason likhna zaroori hai':'A reason is required',
  'HOD ko bhejo':'Send to HOD',
  'Bhej raha hai…':'Sending…',
  'HOD ko request chali gayi — ab wait karo':'The request has gone to the HOD — please wait',

  /* ── field ── */
  'Field — store visit':'Field — store visit',
  'Store select karo product add karo submit. Ek store ke baad POSM.':'Pick a store add products submit. POSM comes after each store.',
  'Order punch':'Punch order',
  'Naya outlet':'New outlet',
  'Aaj ka din lock hai':'Today is locked',
  'EOD save ho gaya tha':'EOD was saved',
  'Close Day dabaya gaya tha':'Close Day was pressed',
  ', isliye naya order save nahi hoga.':', so a new order will not be saved.',
  'Aur stores karne hain? Din dobara khol lo — baad me EOD phir save karna hoga.':'More stores to do? Reopen the day — you will have to save EOD again afterwards.',
  'Din dobara kholo':'Reopen the day',
  'Din dobara kholna hai?':'Reopen the day?',
  'Aap aage stores punch kar paoge.':'You will be able to punch more stores.',
  'Dhyan rahe:':'Note:',
  'baaki stores add karne ke baad EOD dobara Save karna hoga — figures phir se calculate honge.':'after adding the remaining stores you must save EOD again — the figures are recalculated.',
  'Haan, kholo':'Yes, reopen',
  'Din khul gaya — aage kaam karo':'The day is open — carry on',
  'Store select karo':'Pick a store',
  'Store name ya code':'Store name or code',
  'Shop ka photo':'Photo of the shop',
  'Dukaan me andar jaane se':'Before you step',
  'pehle':'inside',
  'shop ke bahar ka ek photo lo — board aur entry':'take one photo of the shop front — the board and the entrance',
  'dono dikhne chahiye.':'must both be visible.',
  'Aapke liye ye':'For you this is',
  'optional':'optional',
  'hai (bypass ON) — gallery se bhi chalega.':'(bypass ON) — the gallery works too.',
  'live camera':'live camera',
  'se hi hoga, gallery se nahi.':'only — not from the gallery.',
  'Photo lene ke baad hi product add kar paoge.':'You can add products only after the photo is taken.',
  'Product add karo':'Add products',
  'Sab brand':'All brands',
  'All SKU':'All SKUs',
  'Product name ya code':'Product name or code',
  'Koi store nahi mila':'No store found',
  'Aapke naam par koi store mapped nahi hai':'No store is mapped to your name',
  '— brand/search se narrow karo':'— narrow it with brand / search',
  'Koi product nahi mila':'No product found',
  'Order lines':'Order lines',
  'Abhi koi product add nahi kiya':'No product added yet',
  'Ruko — order save ho raha hai':'Wait — the order is saving',
  'Pehle shop ka photo lo':'Take the shop photo first',
  'Product add karo (ya No Order select karo)':'Add a product (or select No Order)',
  'Reason select karo':'Select a reason',
  'Har product ki units bharo':'Enter units for every product',
  'Status & submit':'Status & submit',
  'Order source':'Order source',
  'Store Visit':'Store visit',
  'Remarks':'Remarks',
  'Submit & aage badho':'Submit & continue',
  'Telephonic — POSM ki zaroorat nahi':'Telephonic — no POSM needed',
  'Naya outlet':'New outlet',
  'Kyun add kar rahe ho?':'Why are you adding it?',
  'Shop ke bahar ka photo':'Photo of the shop front',
  'Andar ka photo':'Photo inside',
  'Outlet save karo':'Save outlet',
  'Distributor select karo':'Select a distributor',
  'Store name bharo':'Enter the store name',
  'Town bharo':'Enter the town',
  'Reason likho':'Write the reason',
  'Outlet save ho gaya —':'Outlet saved —',
  'Camera kholo':'Open the camera',
  'Photo chuno / camera':'Pick a photo / camera',
  'Drive me save':'Saved to Drive',
  '! Upload fail — dobara tap karo':'! Upload failed — tap to retry',
  'Upload…':'Uploading…',

  /* ── orders ── */
  'Mere orders':'My orders',
  'GARUDA — Mere orders':'GARUDA — My orders',
  'Yahan se units/value/status change kar sakte ho — same row update hoti hai, duplicate nahi banti.':'You can change units / value / status here — the same row is updated, never duplicated.',
  'Aaj':'Today',
  'Aaj NSV ₹L':'Today NSV ₹L',
  'Total':'Total',
  'ka POSM pending hai.':'still needs POSM.',
  'POSM karo':'Do POSM',
  'Orders':'Orders',
  'Abhi koi order nahi':'No orders yet',
  'Is order me koi product nahi — neeche se add karo':'This order has no products — add them below',
  '+ Product add':'+ Add product',
  'Ye product hata dein?':'Remove this product?',
  'Order ka total dobara calculate ho jayega.':'The order total will be recalculated.',
  'Haan, hatao':'Yes, remove',
  'hata diya':'removed',
  '— search se narrow karo':'— narrow it with search',
  'Order share karo':'Share the order',
  'Close':'Close',
  'Edit':'Edit',
  'Share':'Share',

  /* ── POSM ── */
  'Aage ki date nahi chal sakti':'A future date is not allowed',
  'Aaj ka beat — live camera':'Today’s beat — live camera',
  'Purana beat — gallery se upload allowed':'Older beat — gallery upload allowed',
  'Kis din ka POSM?':'POSM for which day?',
  'Aaj ka beat hai — photo':'This is today’s beat — the photo must be from the',
  'se hi lena hoga.':'.',
  'Purana beat (':'Older beat (',
  'Visit pehle ho gayi thi, isliye gallery se photo upload kar sakte ho.':'The visit already happened, so you can upload from the gallery.',
  'Store me POSM laga hai ya nahi — dono case me entry karo.':'Whether or not POSM is installed — record it either way.',
  'Field tab me store ka order/visit save karo — wahi store yahan aa jayega.':'Save a store’s order / visit in the Field tab — that store then shows up here.',
  'Field pe jao':'Go to Field',
  'Is store me POSM laga hai?':'Is POSM installed in this store?',
  'Haan — audit karo':'Yes — audit it',
  'Nahi — requirement bhejo':'No — raise a requirement',
  'Aaj koi POSM entry nahi':'No POSM entry today',
  'POSM ka close-up':'Close-up of the POSM',
  'Poori shelf jisme POSM dikhe':'The full shelf with the POSM visible',
  'Ek aur photo':'One more photo',
  'shelf par POSM lagana hai':'POSM is needed on the shelf',
  'uska photo lo — jagah saaf dikhni chahiye.':'photograph it — the spot must be clearly visible.',
  'POSM ki zaroorat nahi hai, to':'If no POSM is needed, take',
  'poore shop ka':'one photo of the whole shop',
  'ek photo lo —':'—',
  'counter aur shelf dono frame me aane chahiye.':'the counter and the shelf must both be in frame.',
  'Poore shop ka photo':'Photo of the whole shop',
  'Shelf ka photo':'Photo of the shelf',
  'Honasa brand':'Honasa brand',
  'Dono compulsory photo lo':'Take both compulsory photos',
  'POSM ka close-up aur poori shelf —':'a close-up of the POSM and the full shelf —',
  'tabhi save hoga.':'only then can it be saved.',
  'Audit save karo':'Save audit',
  'Wapas':'Back',
  'Ruko — POSM save ho raha hai':'Wait — POSM is saving',
  'POSM ke 2 photo compulsory hain':'Both POSM photos are compulsory',
  'POSM element select karo':'Select the POSM element',
  'Brand select karo':'Select a brand',
  'Condition select karo':'Select the condition',
  'POSM audit save — next store karo':'POSM audit saved — on to the next store',
  'Kya POSM chahiye?':'Is POSM needed?',
  'Poore shop ka photo lo':'Take a photo of the whole shop',
  'Shelf ka photo lo':'Take a photo of the shelf',
  'Ye compulsory hai — tabhi save hoga.':'This is compulsory — only then can it be saved.',
  'Requirement save karo':'Save requirement',
  'Ruko — save ho raha hai':'Wait — saving',
  'Remarks likho':'Write remarks',
  'Poore shop ka photo compulsory hai':'A photo of the whole shop is compulsory',
  'Shelf ka photo compulsory hai':'A photo of the shelf is compulsory',
  'Requirement save — next store karo':'Requirement saved — on to the next store',

  /* ── EOD ── */
  'Aaj ka din close karein?':'Close the day?',
  'ka kaam save hua hai.':'has been saved.',
  'Close karne ke baad naya order / POSM save nahi hoga — lekin zaroorat pade to din dobara khol sakte ho.':'After closing, no new order / POSM can be saved — but you can reopen the day if you need to.',
  'Haan, close karo':'Yes, close it',
  'Din close — EOD save karo':'Day closed — now save EOD',
  'EOD — din close karo':'EOD — close the day',
  'Sab figures automatic hain. Check karke save karo, phir report bhejo.':'All the figures are automatic. Check them, save, then send the report.',
  'Din close ho gaya':'The day is closed',
  'Dobara kholo':'Reopen',
  'EOD save & din close':'Save EOD & close the day',
  'Save ho raha hai…':'Saving…',
  'EOD save — din close ho gaya':'EOD saved — the day is closed',
  'GARUDA — Din ka report (EOD)':'GARUDA — Day report (EOD)',
  'Din ka Report':'Day report',
  'Aaj ka plan':'Today’s plan',
  'HOD ko notify':'Notified to HOD',
  'nahi bheja':'not sent',
  'Din close':'Day closed',
  'abhi nahi':'not yet',
  'Kya':'What',
  'Naye outlet (NSO)':'New outlets (NSO)',
  'ORDER STATUS — kitne store kis stage par':'ORDER STATUS — how many stores at each stage',
  'Mere total store':'My total stores',
  'Aaj visit kiye':'Visited today',
  'Visit nahi kiya':'Not visited',
  'Calls (TC/SC)':'Calls (TC/SC)',
  'POSM audit':'POSM audit',
  'POSM req':'POSM req',
  'MSL lines':'MSL lines',
  'Order value':'Order value',
  'Remarks (optional)':'Remarks (optional)',
  'Target vs achievement (₹ lakh)':'Target vs achievement (₹ lakh)',
  'Order status':'Order status',

  /* ── summary ── */
  'GARUDA — Mera performance':'GARUDA — My performance',
  'Mera performance':'My performance',
  '· month-to-date':'· month to date',
  'Working days (order wale)':'Working days (with orders)',
  'Working days':'Working days',
  'Total visits':'Total visits',
  'MTD ach':'MTD ach',
  'EOD filed':'EOD filed',
  'Billed':'Billed',
  'Is month koi order nahi':'No orders this month',
  'Din-wise':'Day-wise',
  'Brand-wise NSV (₹ lakh)':'Brand-wise NSV (₹ lakh)',
  'Month data download':'Download month data',

  /* ── requests / approvals ── */
  'kuch second':'a few seconds',
  'HOD ke paas':'With the HOD',
  'Bheja nahi':'Not sent',
  'Approved':'Approved',
  'Rejected':'Rejected',
  'Field din bhare':'field days filled',
  'din Master_PJP me':'days in Master_PJP',
  'Ye abhi draft hai — PJP tab se HOD ko bhejo.':'This is still a draft — send it to the HOD from the PJP tab.',
  'Approved plan Master_PJP me chala gaya — Plan tab me roz dikhega.':'The approved plan has gone into Master_PJP — it shows in the Plan tab each day.',
  'PJP me tha':'The PJP had',
  'Aapka reason':'Your reason',
  'Ye beat dobara request nahi kar sakte — koi dusra beat chuno.':'You cannot request this beat again — choose a different one.',
  'Naya outlet —':'New outlet —',
  'Kyun chahiye':'Why it is needed',
  'Rep ka remark':'Rep’s remark',
  'Meri requests':'My requests',
  'Jo bhi approval ke liye bheja hai — kab bheja, kab decide hua, sab yahan. Kisi bhi request par tap karo.':'Everything you sent for approval — when it went, when it was decided. Tap any request.',
  'HOD ke paas':'With the HOD',
  'Is filter me kuch nahi hai':'Nothing in this filter',
  'Abhi tak koi request nahi bheji. PJP ya plan change bhejoge to yahan dikhega.':'No request sent yet. A PJP or plan change will show up here.',
  'Refresh karo':'Refresh',
  'Time record nahi hua':'Time was not recorded',
  '· bheja:':'· sent:',
  'Request bheja':'Request sent',
  'HOD ko bheja nahi':'Not sent to the HOD',
  'PJP tab se submit karo':'Submit it from the PJP tab',
  'me decision aaya':'to decide',
  'HOD ke decision ka wait':'Waiting on the HOD’s decision',
  'se pending hai':'pending since',
  'Pending hai':'Pending',
  'HOD ka message':'Message from the HOD',
  'Approve karo':'Approve',
  'Reject karo':'Reject',
  'Sab':'All',
  'Plan change':'Plan change',
  'Store opening':'Store opening',
  'POSM request':'POSM request',
  'Order':'Order',

  /* ── admin console ── */
  'console':'console',
  'Overview aur approvals ke liye. Har employee ka kaam, PJP aur photo yahin se dekho —':'For overview and approvals. See every employee’s work, PJP and photos right here —',
  'sheet kholne ki zaroorat nahi.':'no need to open the sheet.',
  'Employees':'Employees',
  'Aaj plan':'Plans today',
  'Aaj visits':'Visits today',
  'Aaj EOD':'EOD today',
  'Month visits':'Month visits',
  'Month NSO':'Month NSO',
  'Pending orders':'Pending orders',
  'Aaj kaun kaam par hai':'Who is working today',
  'employee wise':'employee wise',
  '· master me':'· in the master',
  'HOD ko bheja':'Sent to the HOD',
  'Approval ke liye bheja hua hai':'Sent for approval',
  'Reject hua — theek karke dobara bhejna hai':'Rejected — fix it and send again',
  'PJP defined':'PJP defined',
  'din Master_PJP me live':'days live in Master_PJP',
  'Approve ho gaya — master me publish hona pending hai':'Approved — publishing to the master is pending',
  'Abhi HOD ko bheja hi nahi':'Not sent to the HOD yet',
  'din Master_PJP me publish':'days published to Master_PJP',
  'Master_PJP me live hain — master me plan approval ke baad hi aata hai. Is month ka':'are live in Master_PJP — a plan only reaches the master after approval. This month’s',
  'draft row app me nahi hai (sheet me seedha load hua tha).':'draft row is not in the app (it was loaded straight into the sheet).',
  'Naya submission HOD ke paas hai. Filhaal master me purane':'A new submission is with the HOD. For now the master still holds the old',
  'live hain — approve karne par overwrite ho jayenge.':'— approving will overwrite them.',
  '‹ Sab employee':'‹ All employees',
  'Is month ka koi PJP nahi — na draft, na master me':'No PJP for this month — neither a draft nor anything in the master',
  'Master me':'In the master',
  'Din':'Day',
  'Working with':'Working with',
  'Employee date shop. Har photo Drive me isi tarah rakha hai.':'Employee date shop. Every photo sits in Drive exactly like this.',
  'Abhi koi photo upload nahi hui':'No photo uploaded yet',
  'Sab employee':'All employees',
  'ko koi photo nahi':'has no photos',
  'Naya outlet approve karein?':'Approve the new outlet?',
  'Approve ke baad ye store enrol ho jayega.':'Once approved, the store is enrolled.',
  'Outlet reject karein?':'Reject the outlet?',
  '— rep ko reason dikhega.':'— the rep will see the reason.',
  'Reject karo':'Reject',
  'Outlet approve ho gaya':'Outlet approved',
  'Outlet reject — rep ko dikh jayega':'Outlet rejected — the rep will see it',
  'POSM request approve karein?':'Approve the POSM request?',
  'Approve ke baad dispatch ke liye bhej sakte ho.':'Once approved you can send it for dispatch.',
  'POSM request reject karein?':'Reject the POSM request?',
  'TA/DA reject karein?':'Reject the TA/DA?',
  'Master_PJP me publish ho raha hai…':'Publishing to Master_PJP…',
  'Approve + publish — Master_PJP me':'Approved and published — in Master_PJP',
  '! Approve ho gaya par publish fail:':'! Approved but publishing failed:',
  '! Publish nahi hua — dobara approve dabao':'! Not published — press approve again',
  'PJP reject karna hai?':'Reject this PJP?',
  '. Reason rep ko dikhega.':'. The rep will see the reason.',
  'e.g. beats repeat ho rahe hain':'e.g. the beats are repeating',
  'Reject ho gaya — rep ko dikh jayega':'Rejected — the rep will see it',
  'Plan change reject karein?':'Reject the plan change?',
  'Maanga tha:':'Asked for:',
  'Reject ke baad rep yahi beat dobara nahi bhej payega.':'After rejection the rep cannot send this beat again.',
  'e.g. PJP wala beat hi karo':'e.g. work the PJP beat instead',
  'Rejected — rep ko dusra beat chunna padega':'Rejected — the rep must pick a different beat',
  'Koi data nahi':'No data',
  'Password reset karne se sab logins':'Resetting passwords makes every login',
  'ho jayenge aur pehli login par change maangega.':'and forces a change on first login.',
  'Reset all passwords':'Reset all passwords',
  'Bypass — per user':'Bypass — per user',
  'Kisi ek user ke liye app ki':'For one user, lift the app’s',
  'restrictions hata do':'restrictions',
  '— sirf zaroori cheezein bharni padengi.':'— only the essentials stay compulsory.',
  'Ye per user hai: X aur Y par ON, Z par OFF. Kya hatta hai:':'This is per user: ON for X and Y, OFF for Z. What is lifted:',
  'Data phir bhi zaroori hai — store, distributor, town/beat,':'Data is still required — store, distributor, town/beat,',
  'order status, remarks. Master tabs read-only rehte hain.':'order status, remarks. Master tabs stay read-only.',
  'user par bypass ON hai':'user(s) have bypass ON',
  'Abhi kisi par bypass ON nahi hai.':'Nobody has bypass ON right now.',
  'Bypass OFF karo':'Turn bypass OFF',
  'Bypass ON karo':'Turn bypass ON',
  'Bypass ON karein?':'Turn bypass ON?',
  'ke liye ye restrictions hat jayengi:':'— these restrictions will be lifted:',
  'Sirf inhi par lagu hoga, baaki team par nahi.':'It applies only to them, not to the rest of the team.',
  'Reason (sheet me save hoga)':'Reason (saved in the sheet)',
  'e.g. camera kharab hai, mid-month joining':'e.g. broken camera, mid-month joining',
  'Haan, ON karo':'Yes, turn it ON',
  'Bypass OFF karein?':'Turn bypass OFF?',
  'par app ki poori restrictions wapas lag jayengi — photo compulsory,':'gets every restriction back — photos compulsory,',
  'tab ka order, poora PJP.':'tab order, the whole PJP.',
  'Haan, OFF karo':'Yes, turn it OFF',
  'ON kar rahe hain…':'Turning it ON…',
  'OFF kar rahe hain…':'Turning it OFF…',
  'Nahi ho paya':'Could not do it',
  'Server se jawab nahi aaya':'No answer from the server',
  'Backend purana ho to':'If the backend is out of date,',
  'dobara paste karke deploy karo.':'paste it again and redeploy.',
  'Sab passwords reset karein?':'Reset every password?',
  'Har login ka password':'Every login’s password becomes',
  'ho jayega aur pehli login par change maanga jayega.':'and a change is forced at first login.',
  'Ye sabhi users par lagu hoga.':'This applies to all users.',
  'Haan, reset karo':'Yes, reset',
  'Reset ho gaya':'Reset done',
  'users ka password':'users now have the password',
  'Master tabs':'Master tabs',
  'hain — app kabhi inme likhta nahi. Sheet me change karo, app':'— the app never writes to them. Change the sheet and the app picks it up on',
  'par utha lega.':'.',
  'Master refresh karo':'Refresh masters',
  'Plan nahi bana':'No plan made',
  'EOD ho gaya':'EOD done',
  'abhi shuru nahi kiya':'not started yet',
  '— employee ka aaj ka':'— the employee’s live status for',
  'Aaj:':'Today:',
  'Preview':'Preview',
  'Console':'Console',
  /* login gate */
  'Logging in…':'Logging in…',
  'LOGIN TO GARUDA':'LOGIN TO GARUDA',
  'Email bharo':'Enter your email',
  'Password bharo':'Enter your password',
  'Poora email likho (jaise name@mamaearth.in)':'Enter the full email (e.g. name@mamaearth.in)',
  'Ye email register nahi hai — spelling check karo ya admin se poochho':
    'This email is not registered — check the spelling or ask your admin',
  'Password galat hai — dobara try karo':'Wrong password — please try again',
  /* longest-first matching means this wins over the shorter 'Order punch' key */
  'change ho chuke hain — kal se naya din':'changes are already used — tomorrow is a new day',
  'change ho chuke hain':'changes used',
  'bacha hai.':'left.',
  'limit poori.':'limit reached.',
  'Change limit over':'Change limit over',
  'Order kaise aa raha hai?':'How is the order coming in?',
  'Store visit':'Store visit',
  'Telephonic':'Telephonic',
  'Shop me ja rahe ho — photo lagega':'Going to the shop — a photo is needed',
  'Phone par order — photo aur POSM skip':'Order by phone — photo and POSM skipped',
  '— shop ka photo aur POSM dono skip ho jayenge. Sirf product aur status bharo.':'— the shop photo and POSM are both skipped. Just fill the product and status.',
  '— badalna ho to upar step 2 me jao.':'— to change it, go up to step 2.',
  'Order source:':'Order source:',
  'Kuch change nahi hua':'Nothing changed',
  'update ho gaya':'updated',
  'Submit & aage badho':'Submit & continue',
  'Submit &amp; aage badho':'Submit &amp; continue',
  'Store select karo':'Pick a store',
  'Sheet me:':'In the sheet:',
  'Save hua':'Saved at',
  'Order update ho gaya — sheet me chala gaya':'Order updated — written to the sheet',
  'Save order':'Save order',
  'Save kiye bina band karein?':'Close without saving?',
  'Is order me kuch change kiya hai jo abhi sheet me nahi gaya.':'This order has changes that have not reached the sheet yet.',
  'Save karke band karo':'Save and close',
  'Bina save band karo':'Close without saving',
  'Product add':'Add product',
  'Is order ki lines nahi mili — Sync karke dobara try karo':'This order’s lines could not be found — Sync and try again',
  'Chahiye?':'Needed?',
  'Store calls (SC)':'Store calls (SC)',
  'Order mile (PC)':'Orders won (PC)',
  'Order value (₹)':'Order value (₹)',
  'NSV (₹ Lakh)':'NSV (₹ Lakh)',
  'Date of joining':'Date of joining',
  'NAYE OUTLET (NSO)':'NEW OUTLETS (NSO)',
  'BRAND SPLIT — MRP value vs NSV':'BRAND SPLIT — MRP value vs NSV',
  'EMPLOYEE & REPORTING':'EMPLOYEE & REPORTING',
  'POSM AUDIT':'POSM AUDIT',
  'POSM REQUIREMENT':'POSM REQUIREMENT',
  'COVERAGE':'COVERAGE',
  'TARGET vs ACHIEVEMENT':'TARGET vs ACHIEVEMENT',
  'Apne order, naye outlet aur POSM ka status khud update karo. Koi approval nahi — ASM se baat karke jo hua wahi yahan mark kar do, sheet me chala jayega.':'Update the status of your own orders, new outlets and POSM yourself. No approvals — talk to your ASM, mark what actually happened here, and it goes into the sheet.',
  'Sirf pehle 80 dikha rahe hain — filter use karo.':'Showing the first 80 only — use the filter.',
  'Note — ASM ne kya kaha':'Note — what the ASM said',
  'Tracker tab me status update karo':'update the status in the Tracker tab',
  'Abhi is type ka kuch nahi bhara':'Nothing filled in for this type yet',
  'Ye row nahi mili — Sync karo':'This row was not found — Sync and try again',
  'Note save ho gaya':'Note saved',
  'Is period me kuch nahi':'Nothing in this period',
  'se chalu':'onwards',
  'plan din':'plan days',
  'field din ×':'field days ×',
  'Plan ka NSO target':'NSO target from the plan',
  'Month ka NSV target':'Month NSV target',
  'Planned beat din':'Planned beat days',
  'Chhoot gaya':'Missed',
  'din PJP se bahar kaam hua (off-PJP)':'days worked outside the PJP (off-PJP)',
  'Status Tracker tab se update karo — ASM se poochh ke.':'Update the status from the Tracker tab — after checking with your ASM.',
  'Tracker kholo':'Open Tracker',
  'Ek bhi order pending nahi — sab billed':'Nothing pending — everything is billed',
  'MSL data nahi hai':'No MSL data',
  'Pending — billing baaki':'Pending — billing awaited',
  'Pending orders — billing nahi hui':'Pending orders — not billed yet',
  'Is period koi order nahi':'No orders in this period',
  'Order mila (PC)':'Orders won (PC)',
  'POSM chahiye':'POSM needed',
  'EOD file kiye':'EOD filed',
  'Store visit kiye':'Stores visited',
  'Jitne store ne order diya':'Stores that gave an order',
  'Audit kiye':'Audits done',
  'Team ka data aa raha hai…':'Fetching the team data…',
  '· sirf totals, kisi ka raw data nahi':'· totals only, nobody’s raw data',
  'Team view abhi ready nahi':'Team view is not ready yet',
  'Dobara try karo':'Try again',
  'Is period me team ka koi kaam record nahi hua':'No team activity recorded in this period',
  'Mera total':'My total',
  'Team me rank':'Rank in the team',
  '— kis ke saath kaam kiya':'— who you worked with',
  'Din ka bucket us din ke plan ke Working-With se aata hai.':'A day lands in a column according to that day’s plan (Working-With).',
  'Main akela vs team ke saath':'Me alone vs with the team',
  'Sirf aapke numbers — kis mode me aap best perform karte ho.':'Your numbers only — which mode you perform best in.',
  'Server ne mana kar diya — backend.gs dobara deploy karna pad sakta hai':'The server refused — backend.gs may need to be re-deployed',
  'Internet nahi mila — refresh karke dobara try karo':'No internet — refresh and try again',
  'PJP window khuli hai (27 se 1 tarikh)':'The PJP window is open (27th to the 1st)',
  'ka plan abhi bhar ke HOD ko bhej do.':'plan — fill it now and send it to the HOD.',
  'approve ho gaya':'is approved',
  'Ab is month me change nahi hoga — agli PJP 27 tarikh se khulegi.':'No more changes this month — the next PJP opens on the 27th.',
  'Approve hone tak aap edit karke dobara bhej sakte ho — naya request purane ko replace kar dega.':'Until it is approved you can edit and send again — a new request replaces the old one.',
  'Approve hone tak aap edit karke dobara bhej sakte ho.':'Until it is approved you can edit and send it again.',
  'Ye month approve ho chuka hai':'This month is already approved',
  'Naya request bhejna hai?':'Send a new request?',
  'Purana request cancel ho jayega — HOD ko sirf yehi naya dikhega.':'The old request is cancelled — the HOD only sees this new one.',
  'Naya request bheja — purana cancel':'New request sent — the old one is cancelled',
  'ka PJP approve ho gaya — agli PJP 27 tarikh se khulegi':'PJP is approved — the next PJP opens on the 27th',
  'Dobara bhejo':'Send again',
  'khud likho':'type it yourself',
  'Beat / market ka naam':'Beat / market name',
  'Naya town likho':'Type the new town',
  'Naya state likho':'Type the new state',
  'Sab category':'All categories',
  'Sab sub-category':'All sub-categories',
  '"Other" (meeting / leave) total me gina jaata hai lekin apna column nahi hai.':'"Other" (meeting / leave) counts in the total but has no column of its own.',
  '/din':'/day',
  'Meri approvals':'My approvals',
  'Sirf dekhne ke liye — jo bheja hai, kab bheja aur kab decision aaya. Kisi bhi request par tap karke detail dekho.':'View only — what you sent, when you sent it and when the decision came. Tap any request for the detail.',
  'Jo bhi approval ke liye aaya hai — kab bheja, kab decide hua, sab yahan. Kisi bhi request par tap karo.':'Everything sent for approval — when it was sent, when it was decided. Tap any request.',
  'Poora plan':'Full plan',
  'HOD ke paas hai':'With the HOD',
  'HOD ne kuch din reject kiye':'The HOD rejected some days',
  'Sirf wo din theek karke dobara bhejo — baaki month waise hi hai.':'Fix only those days and send it again — the rest of the month stands.',
  'PJP tab me sirf reject wale din khule hain — theek karke dobara bhejo.':'Only the rejected days are open in the PJP tab — fix them and send it again.',
  'reject kiye hue hain':'are rejected',
  '— rep sirf yeh din edit kar sakta hai.':'— the rep can only edit these days.',
  'Approve poora month':'Approve the whole month',
  'Poora month reject':'Reject the whole month',
  'Jo din galat hai use tick karke reject selected days dabao. Baaki month waise hi rahega. Ya Edit dabakar khud theek kar do, phir approve kar do.':'Tick the days that are wrong and press reject selected days — the rest of the month stands. Or press Edit, fix it yourself, then approve.',
  'Change turant draft me save ho jata hai — rep ko bhi dikhega.':'The change saves into the draft at once — the rep sees it too.',
  'Is draft me koi din nahi hai.':'This draft has no days in it.',
  'Pehle wo din tick karo jo reject karne hain':'First tick the days you want to reject',
  'din reject karne hain?':'days to reject?',
  'Baaki din waise hi rahenge — rep sirf yeh din edit kar payega.':'The other days stand — the rep will only be able to edit these.',
  'Reason (rep ko dikhega)':'Reason (the rep sees this)',
  'e.g. ye beat pichhle hafte hi kiya tha':'e.g. this beat was already done last week',
  'din reject — rep ko sirf wahi edit karne milega':'days rejected — the rep can only edit those',
  'din reject hue hain':'days came back rejected',
  'Ye din reject hua tha — theek karo':'This day was rejected — fix it',
  'Sirf yeh din edit ho sakte hain — baaki month approve hai. Theek karke dobara bhej do.':'Only these days can be edited — the rest of the month is approved. Fix them and send it again.',
  'Theek kiya — dobara bhejo':'Fixed — send again',
  'Partly rejected':'Partly rejected',
  'Reject selected days':'Reject selected days',
  'selected days':'selected days',
  'Master_PJP me':'In Master_PJP',
  'din select kiye hain':'days selected',
  'Sirf yehi din reject honge — baaki month approve rahega.':'Only these days will be rejected — the rest of the month stays approved.',
  'Select kiye din reject karo':'Reject the selected days',
  'Sirf ye ':'Reject only these ',
  'din reject karo':'days',
  'Poora PJP approve':'Approve the whole PJP',
  'Poora PJP reject':'Reject the whole PJP',
  'Sirf yeh ek din reject karo':'Reject only this one day',
  'Ek din select kiya hai':'One day selected',
  'Jo din galat hai unke box tick karo, phir niche wala reject button dabao. Ya Edit dabakar khud theek kar do.':'Tick the box on each day that is wrong, then press the reject button below. Or press Edit and fix it yourself.',
  'Din ka report — WhatsApp image':'Day report — WhatsApp image',
  'Subah wali card ki tarah, lekin aaj ke poore numbers ke saath. Text nahi, image jaati hai.':'The same card as the morning one, with the day’s full numbers. An image goes, not text.',
  'Text bhejo':'Send as text',
  'EOD image bhej di':'EOD image sent',
  'AUR BHI':'ALSO',
  'KYA':'WHAT',
  'Naye outlet:':'New outlets:',
  'Kyun zaroorat nahi hai':'Why it is not needed',
  'Aaj ka POSM':'Today’s POSM',
  'Kaunsa element':'Which element',
  'Kyun chahiye / store ka kya kehna hai':'Why it is needed / what the store says',
  'aur store':'more stores',
  'STORE-WISE':'STORE-WISE',
  'Approve — plan dekho':'Approve — see the plan',
  'Reject — plan dekho':'Reject — see the plan',
  'Poora plan dekho — niche se poora month ya sirf kuch din reject karo':'Read the whole plan — then reject the whole month, or only some days, from below',
  'Poora plan dekho — niche se approve karo':'Read the whole plan — then approve it from below',
  'Ab decide karo':'Now decide',
  'kuch select nahi':'nothing selected',
  'din select':'selected',
  'Approve all':'Approve all',
  'Reject all':'Reject all',
  'Ya kisi din par Edit dabakar khud theek kar do, phir Approve all.':'Or press Edit on a day, fix it yourself, then Approve all.',
  'Jo din galat hai unke box tick karo — niche reject selected days chalu ho jayega.':'Tick the box on each day that is wrong — reject selected days switches on below.',
  'Poora plan niche hai — padho, galat din tick karo, phir niche se decide karo.':'The whole plan is below — read it, tick the wrong days, then decide from there.',
  'Galat din tick karo, phir yahan se decide karo':'Tick the wrong days, then decide from here',
  'Is din ko save karo':'Save this day',
  'Ab dobara bhejo':'Now send it again',
  'Reject wale din theek karke save karo, phir HOD ko dobara bhejo.':'Fix the rejected days, save them, then send it to the HOD again.',
  'Bhara':'Filled',
  'Poora':'Complete',
  'Adhoora':'Incomplete',
  'Sab save karo':'Save everything',
  'HOD ko dobara bhejo':'Send to the HOD again',
  '! Pehle har reject wale din ka Town aur Beat bharo — tabhi dobara bhej paoge.':'! Fill the Town and Beat on every rejected day first — only then can you send it again.',
  'Save ho gaya':'Saved',
  'Sab din save ho gaye':'All days saved',
  'Rep ke paas hai':'With the rep',
  'din wapas bheje hue hain — rep theek karke dobara bhejega, tab approve kar sakte ho.':'days were sent back — the rep will fix them and send again, then you can approve.',
  'Rep ke paas hai — wapas aane ka wait':'With the rep — waiting for it to come back',
  'Jab tak rep dobara nahi bhejta, isme kuch decide nahi karna hai.':'Nothing to decide here until the rep sends it again.',
  'Theek karke dobara bhejna hai':'Fix it and send it again',
  'PJP tab me sirf reject wale din khule hain.':'Only the rejected days are open in the PJP tab.',
  'in dino ka Town aur Beat bharo':'— fill the Town and Beat for these days',
  'din theek karke dobara bheje hain':'days were fixed and sent again',
  'baaki month pehle hi approve tha, wahi hai.':'the rest of the month was already approved and is unchanged.',
  'Sirf badle hue':'Only the changed',
  'Poora month':'Whole month',
  'Badle hue din':'Changed days',
  'Changed':'Changed',
  'Save nahi hua':'Not saved yet',
  'Is store par kya hua?':'What happened at this store?',
  'No order':'No order',
  'Order nahi mila — sirf reason':'No order — reason only',
  'Order kyun nahi mila?':'Why was there no order?',
  'Reason select karo — product aur photo ki zaroorat nahi. Save karte hi POSM khul jayega.':'Pick a reason — no products and no photo needed. Saving opens POSM.',
  'Shop ne kya kaha (optional)':'What the shop said (optional)',
  'Save karke POSM par jao':'Save and go to POSM',
  'Order bharo':'Fill the order',
  'no order (':'no order (',
  ') save · ab POSM karo':') saved · now do POSM',
  'Punch order':'Punch order',
  'Shop ka photo ho gaya':'Shop photo done',
  'Visit ka proof save hai. Ab sirf reason bharo.':'The visit is evidenced. Now just fill the reason.',
  'Wapas — order punch karo':'Back — punch the order',
  'Reason likho — zaroori hai':'Write the reason — required',
  'Other chuna hai — Remarks me reason likho':'You picked Other — write the reason in Remarks',
  'TC (Total calls)':'TC (Total calls)',
  'PC (Productive calls)':'PC (Productive calls)',
  'SC (Scheduled calls)':'SC (Scheduled calls)',
  'TC / SC':'TC / SC',
  'Brand-wise — target vs achieved (₹ Lakh)':'Brand-wise — target vs achieved (₹ Lakh)',
  'Achieved':'Achieved',
  'Review':'Review',
  'Kaunsa element chahiye — select karo':'Pick which element is needed',
  'Honasa brand select karo':'Pick the Honasa brand',
  'Kahan lagana hai':'Where it goes',
  'Branding chahiye':'Branding wanted',
  'Kitne chahiye':'How many',
  'Store ka monthly income ₹':'Store monthly income ₹',
  'Store ka daily sale ₹':'Store daily sale ₹',
  'Kab tak chahiye':'Needed by',
  'POSM type':'POSM type',
  'Asset type':'Asset type',
  'Email + Excel + image':'Email + Excel + image',
  'HOD ka email Master_Config me nahi hai — draft khol diya':'The HOD email is not in Master_Config — opened a draft instead',
  'Email bhej diya —':'Email sent —',
  '! Email nahi gaya:':'! Email did not go:',
  '— draft khol rahe hain':'— opening a draft',
  '! Email nahi gaya — draft khol rahe hain':'! Email did not go — opening a draft',
  'attachment':'attachment',
  'Is shop ka stock':'This shop’s stock',
  'Stock aa raha hai…':'Fetching the stock…',
  '· sheet se, aaj ka':'· from the sheet, today’s',
  'Stock nahi dikha':'Could not show the stock',
  'Sheet se live — Stock_Store.':'Live from the sheet — Stock_Store.',
  'Upload time nahi mila':'No upload time found',
  'Is shop ka stock sheet me nahi hai':'This shop has no rows in the stock sheet',
  'Distributor ka stock':'Distributor stock',
  'Is distributor ka stock sheet me nahi hai':'This distributor has no rows in the stock sheet',
  'Stock nahi mila':'Stock not found',
  'zero':'zero',
  'Upload:':'Upload:',
  'Ye live camera se hi hoga, gallery se nahi.':'It must come from the live camera, not the gallery.',
  'Internet nahi mila':'No internet',
  'Ye store list me nahi mila — Sync karo':'This store is not in the list — Sync',
  'Stock — shop aur distributor':'Stock — shop and distributor',
  'Jo store aap visit kar rahe ho uska stock, aur aapke distributor ka stock. Yahin se order add karo.':'The stock of the store you are visiting, and your distributor’s stock. Add the order from here.',
  'Pehle Field tab me store select karo':'First pick a store in the Field tab',
  'Field tab kholo':'Open the Field tab',
  'MSL products':'MSL products',
  'Non-MSL products':'Non-MSL products',
  'Is filter me koi product nahi':'No product in this filter',
  'Sirf pehle 60 dikha rahe hain — search ya filter use karo.':'Showing the first 60 only — use search or a filter.',
  'Order banaya ja raha hai':'Order being built',
  'Upar se product add karo — phir order complete karo.':'Add products above, then complete the order.',
  'Order complete karo':'Complete the order',
  'Pehle koi product add karo':'Add a product first',
  'Order check karo, phir submit':'Check the order, then submit',
  'unit order me add ho gaya':'units added to the order',
  'Order se hata diya':'Removed from the order',
  'Quantity bharo':'Fill the quantity',
  'Product nahi mila':'Product not found',
  'Stock refresh':'Refresh stock',
  'Value / NSV':'Value / NSV',
  'Stock se add karo':'Add from Stock',
  'Stock tab me shop aur distributor ka stock dikhta hai — wahin se product add karo.':'The Stock tab shows the shop and distributor stock — add products from there.',
  'Product ya code':'Product or code',
  'Stock time par nahi aaya — dobara try karo (ya admin se stock index build karwao)':'The stock did not arrive in time — try again (or ask the admin to build the stock index)',
  'Stock index nahi bana — admin ko buildStockIndex chalane ko kaho':'The stock index has not been built — ask the admin to run buildStockIndex',
  'Ek chuno — uske baad order page khulega.':'Pick one — the order page opens next.',
  'Photo lete hi order page khul jayega.':'The order page opens as soon as the photo is taken.',
  'Order page kholo':'Open the order page',
  'Ye visit:':'This visit:',
  '· shop ka photo ho gaya':'· shop photo taken',
  '· photo bypass':'· photo bypassed',
  'badlo':'change',
  'Shop ya DB heading par tap karo — ek baar ascending, dobara descending, teesri baar normal.':'Tap the Shop or DB heading — once for ascending, again for descending, a third time for normal.',
  'List scroll karo —':'Scroll the list —',
  'Shop stock kam hai':'Shop stock is low',
  'Yahin se order add karo.':'Add the order right here.',
  'Shop stock':'Shop stock',
  'Sab stock':'All stock',
  'se kam':'or less',
  'Filter hatao':'Clear filters',
  'TA / DA claim':'TA / DA claim',
  'Policy ke hisaab se apne mahine ka travel claim banao — din ka station plan se aa jata hai, aap sirf amount aur bills confirm karo.':'Your month’s travel claim, by the policy — each day’s station comes from your plan, you just confirm the amounts and the bills.',
  'Aapka slab:':'Your slab:',
  'Aapka entitlement':'Your entitlement',
  'Metro cities: Delhi NCR, Mumbai, Kolkata, Hyderabad, Chennai, Bangalore. Mumbai ka lodging rate alag hai.':'Metro cities: Delhi NCR, Mumbai, Kolkata, Hyderabad, Chennai, Bangalore. Mumbai has its own lodging rate.',
  'Female employee — lodging ek level upar claim kar sakti hain.':'Female employee — lodging can be claimed one level up.',
  'Ye claim approve ho gaya':'This claim is approved',
  '5 tarikh tak approve hua to 17 ko, 15 tak hua to 30 ko payment.':'Approved by the 5th → paid on the 17th; by the 15th → paid on the 30th.',
  'Approve hone tak edit kar sakte ho — dobara bhej dena.':'You can keep editing until it is approved — just send it again.',
  'Mahine ka total':'Month total',
  'Total claim':'Total claim',
  'Claim din':'Claim days',
  'Warning':'Warnings',
  'Daily allowance':'Daily allowance',
  'Travel (km / ticket / cab)':'Travel (km / ticket / cab)',
  'Station tak':'To the station',
  'Team meeting':'Team meeting',
  'per month. HQ, Ex-HQ aur outstation ka food isi me aata hai.':'per month. HQ, Ex-HQ and outstation food all come out of this.',
  'cap se zyada':'over the cap',
  'Team meeting bill':'Team meeting bill',
  'Cap se zyada':'Over the cap',
  'Cap ke andar':'Within the cap',
  'Bills lagenge:':'Bills needed:',
  'koi nahi (sirf DA)':'none (DA only)',
  '. DA ke liye bill ki zaroorat nahi hoti.':'. DA needs no bill.',
  'Is month ka koi din abhi nahi aaya':'No day of this month has happened yet',
  'Kisi bhi din par Edit dabao.':'Tap Edit on any day.',
  'plan se':'from the plan',
  'Ek mahine ka ek hi claim jata hai. 5 tarikh tak approve hua to 17 ko payment, 15 tarikh tak hua to 30 ko.':'One claim per month. Approved by the 5th → paid on the 17th; by the 15th → paid on the 30th.',
  'Sab theek':'All good',
  'Ye din kya tha':'What was this day',
  'Town / city':'Town / city',
  'Kaise gaye':'How you travelled',
  'Kitni raat ruke':'Nights stayed',
  'Kitne km (logbook)':'Km (logbook)',
  'Ticket amount ₹':'Ticket amount ₹',
  'Cab amount ₹':'Cab amount ₹',
  'Food bill ₹':'Food bill ₹',
  'Hotel ₹ (GST ke saath)':'Hotel ₹ (with GST)',
  'Din ka total':'Day total',
  'Bill lagega:':'Bill needed:',
  'Off / leave / holiday — policy me DA nahi milta':'Off / leave / holiday — no DA under the policy',
  'Meeting day — DA aur food dono lagu nahi hote':'Meeting day — neither DA nor food applies',
  'Is role ke liye outstation DA nahi hai — tickets ya per-km chuno':'This role has no fixed outstation DA — pick tickets or per-km',
  'Is role ke liye fixed DA nahi hai — per-km, ticket ya cab chuno':'This role has no fixed DA — pick per-km, ticket or cab',
  'Is role ke liye cab allowed nahi hai':'Cab is not allowed for this role',
  'Per-km is station par allowed nahi hai':'Per-km is not allowed at this station type',
  'HQ me ticket claim policy me nahi hai — DA ya per-km chuno':'A ticket claim at HQ is not in the policy — pick DA or per-km',
  'se zyada — uske aage public transport hi allowed hai':'exceeded — beyond that only public transport is allowed',
  'Food cap':'Food cap',
  'Lodging cap':'Lodging cap',
  'DA me food shamil hai':'Food is included in the DA',
  'Station tak aane-jaane ka':'To and from the station',
  'Station tak ka cab bill alag se claim karo':'Claim the cab to the station separately',
  'Logbook':'Logbook',
  'Ticket / cab bill':'Ticket / cab bill',
  'Hotel bill (GST of the state)':'Hotel bill (with that state’s GST)',
  'Food bill':'Food bill',
  'Ticket':'Ticket',
  'Cab bill':'Cab bill',
  'TA/DA claim bhejna hai?':'Send the TA/DA claim?',
  'ka claim,':'claim,',
  'Mahine me ek hi claim jata hai.':'Only one claim goes per month.',
  'Isme':'It has',
  'warning hai — cap se zyada amount cut ho jayega.':'warnings — anything over a cap will be trimmed.',
  'Ye claim approve ho chuka hai':'This claim is already approved',
  'Claim me kuch nahi hai — pehle din bharo':'There is nothing in the claim — fill the days first',
  'Claim HOD ko chala gaya —':'The claim has gone to the HOD —',
  'Meeting budget cap':'Meeting budget cap',
  'Policy':'Policy',
  'Day-wise':'Day-wise',
  'Claim':'Claim',
  'HQ (base city)':'HQ (base city)',
  'Ex-HQ (same-day return)':'Ex-HQ (same-day return)',
  'Outstation (night stay)':'Outstation (night stay)',
  'Off / leave / holiday':'Off / leave / holiday',
  'Own vehicle (per km)':'Own vehicle (per km)',
  'Bus / train / metro / auto':'Bus / train / metro / auto',
  'Cab (Ola / Uber / Rapido)':'Cab (Ola / Uber / Rapido)',
  'km/din':'km/day',
  ' / din':' / day',
  'bills only — fixed DA nahi':'bills only — no fixed DA',
  'Policy ke hisaab se apne mahine ka travel claim banao — din ka city aur station PJP se aa jata hai, DA aur food estimate hain jo aap badal sakte ho.':'Your month’s travel claim, by the policy — each day’s city and station come from your PJP, and DA and food are estimates you can change.',
  'HOD ne wapas bheja':'The HOD sent it back',
  'Net claim':'Net claim',
  'Travel (km / fare / station)':'Travel (km / fare / station)',
  'Lodging cost':'Lodging cost',
  'Ex-HQ visits':'Ex-HQ visits',
  'Outstation visits':'Outstation visits',
  'HOD deduction':'HOD deduction',
  'Net payable':'Net payable',
  'Meeting kis city me':'Which city was the meeting in',
  '— city chuno —':'— pick a city —',
  'city nahi':'no city',
  'deduct karke wapas bheja':'deducted and sent it back',
  'din par deduction hai — neeche laal line me HOD ka reason likha hai. Theek karke ya samjha kar dobara bhej do.':'days carry a deduction — the HOD’s reason is on the red line under each one. Fix it or explain it, then send it again.',
  'deduct kiya — net':'deducted — net',
  'City':'City',
  'Aapne khud badla hai.':'You changed this yourself.',
  'City se dobara set karo':'Set it from the city again',
  'City bharo — station isi se decide hota hai.':'Fill in the city — the station follows from it.',
  'Koi travel nahi':'No travel',
  '2 wheeler (apni gaadi)':'2 wheeler (own)',
  '4 wheeler (apni gaadi)':'4 wheeler (own)',
  'Bus':'Bus',
  'Train':'Train',
  'Auto / rickshaw':'Auto / rickshaw',
  'Cab / taxi (Ola, Uber)':'Cab / taxi (Ola, Uber)',
  'Flight':'Flight',
  'ka actual ₹':' actual ₹',
  'DA ₹ (estimate)':'DA ₹ (estimate)',
  'Food ₹ (estimate)':'Food ₹ (estimate)',
  'Food ₹ (DA me shamil)':'Food ₹ (already inside the DA)',
  'DA me food already hai':'Food is already inside the DA',
  'policy rate wapas':'back to the policy rate',
  'Save karne ke baad ye din band ho jayega.':'Saving closes this day.',
  'save ho gaya':'saved',
  'City nahi bhari — HQ / Ex-HQ / Outstation isi se decide hota hai':'No city — HQ / Ex-HQ / Outstation is decided from it',
  'DA policy rate':'The DA policy rate is',
  'se zyada likha hai — HOD check karega':'and more has been claimed — the HOD will check it',
  'Food policy rate':'The food policy rate is',
  'Is role ke liye outstation DA nahi hai — bills lagao':'This role has no fixed outstation DA — attach the bills',
  'Is role ke liye fixed DA nahi hai — per-km ya actual fare claim karo':'This role has no fixed DA — claim per-km or the actual fare',
  'Is role ke liye per-km allowed nahi hai':'Per-km is not allowed for this role',
  '— uske aage public transport hi allowed hai':'— beyond that only public transport is allowed',
  'Flight sirf outstation ke liye hai':'A flight is for outstation travel only',
  'Flight — manager ki prior approval zaroori hai':'Flight — the manager’s prior approval is required',
  '— actual':'— actual',
  'Outstation DA me food already hai — alag food claim HOD deduct kar sakta hai':'The outstation DA already includes food — a separate food claim may be deducted by the HOD',
  'ki city bharo — station usi se decide hota hai':'— fill in the city, the station follows from it',
  'Flight ticket':'Flight ticket',
  'Auto receipt':'Auto receipt',
  'Poora TA/DA —':'The whole TA/DA —',
  'Claim total':'Claim total',
  'Deduction':'Deduction',
  'Rep ka remark:':'The rep’s remark:',
  'Reason likhna baaki hai':'Still needs a reason',
  'Har din ke saamne deduction daal sakte ho — jitna kaam nahi hua utna kaato aur reason likho. Reason ke bina deduction save nahi hoga.':'You can put a deduction against any day — cut what was not worked and write the reason. A deduction without a reason will not save.',
  'Deduction ₹':'Deduction ₹',
  'Reason (zaroori)':'Reason (required)',
  'Kyun kaata':'Why it was cut',
  'Ye claim abhi decide karne layak nahi hai — rep ke paas hai ya decision ho chuka hai.':'This claim is not open for a decision — it is with the rep, or it has already been decided.',
  'Message (rep ko dikhega)':'Message (the rep sees this)',
  'Poora approve karo':'Approve in full',
  'Deduction ke saath wapas bhejo':'Send back with the deductions',
  'Approve karne par deduction ke baad ka net amount final ho jayega. Wapas bhejne par rep isse theek karke dobara bhej sakta hai.':'Approving makes the net amount after deductions final. Sending it back lets the rep correct it and send it again.',
  'Har deduction ke saath reason likhna zaroori hai —':'Every deduction needs a reason —',
  'baaki hai':'still missing',
  'Wapas bhejne ke liye kam se kam ek deduction ya message do':'To send it back, add at least one deduction or a message',
  'Poora claim approve karein?':'Approve the whole claim?',
  'Deduction ke saath wapas bhejein?':'Send it back with the deductions?',
  'deduction, net':'deduction, net',
  'poora amount':'the full amount',
  'Haan, approve':'Yes, approve',
  'Haan, wapas bhejo':'Yes, send it back',
  'TA/DA approved — net':'TA/DA approved — net',
  'Rep ko wapas bhej diya —':'Sent back to the rep —',
  'Poora claim dekho — har din par deduction daal sakte ho':'Read the whole claim — you can put a deduction on any day',
  'Poora claim dekho':'Read the whole claim',
  'Deduction lagao':'Add deductions',
  'Deduct':'Deduct',
  'HOD ne kuch din par deduction lagaya':'The HOD put a deduction on some days',
  'Deduction dekho, theek karo ya samjha do, phir dobara bhejo.':'Look at the deductions, fix or explain them, then send it again.',
  'TA/DA tab me deduction wale din laal me dikh rahe hain.':'The days with a deduction are shown in red in the TA/DA tab.',
  'Claim row nahi mila':'Claim row not found',
  'bus / train actual':'bus / train on actuals',
  'cab actual':'cab on actuals',
  'raat outstation':'outstation nights',
  'raat':'nights',
  'Ye aapka HQ hai, isliye HQ. City:':'This is your HQ, so the day is HQ. City:',
  'HQ se alag city, wapas usi din — isliye Ex-HQ. HQ:':'A different city from HQ and back the same day — so Ex-HQ. HQ:',
  'HQ se doosre state me — isliye Outstation. City:':'Another state altogether — so Outstation. City:',
  ', city:':', city:',
  'Poora claim dekho — jis din ka kaam nahi hua uspar deduction daalo':'Read the whole claim — put a deduction on any day that was not worked',
  'Poora claim dekho — niche se poora approve karo':'Read the whole claim — approve it in full from the bar below',
  'Is din ka koi claim nahi bhara':'Nothing has been claimed for this day',
  '(bill ke saath)':'(with the bill)',
  '— bill lagega':'— a bill is needed',
  'Station (HQ / Ex-HQ / Outstation)':'Station (HQ / Ex-HQ / Outstation)',
  'Station':'Station',
  'Station aur city PJP se aate hain — badalna ho to PJP (ya Change PJP) me badlo.':'The station and the city come from the PJP — change them in the PJP (or Change PJP).',
  'TA — travel ₹':'TA — travel ₹',
  'DA — daily allowance ₹':'DA — daily allowance ₹',
  'Bus / train / auto / cab / apni gaadi — jo kharch hua':'Bus / train / auto / cab / own vehicle — what it cost',
  'Lodge cost ₹ (GST ke saath)':'Lodge cost ₹ (with GST)',
  'Meeting day par sirf TA milta hai.':'A meeting day pays travel only.',
  'Note (optional)':'Note (optional)',
  'DA (daily allowance)':'DA (daily allowance)',
  'TA (travel allowance)':'TA (travel allowance)',
  'Lodge cost':'Lodge cost',
  'Lodge':'Lodge',
  'Meeting day — sirf TA milta hai, DA nahi':'Meeting day — travel only, no DA',
  'Meeting day par DA nahi milta — HOD ise deduct kar sakta hai':'A meeting day pays no DA — the HOD may deduct it',
  'Is din ka city PJP me nahi hai — PJP theek karao, tabhi rate lagega':'This day has no city in the PJP — get the PJP fixed so the rate can apply',
  'policy ke hisaab se':'as per the policy',
  '(DA + food)':'(DA + food)',
  'Is role ke liye fixed DA nahi hai — TA aur bills par claim hota hai':'This role has no fixed DA — the claim is TA and bills',
  'Kitni raat ruke, wo bharo':'Fill in how many nights',
  'Travel bill / ticket / logbook':'Travel bill / ticket / logbook',
  'Is role ka food monthly budget':'This role has a monthly food budget of',
  'hai — DA me alag se food nahi jodte, bill lagao.':'— food is not added into the DA, claim it against bills.',
  'raat)':'nights)',
  'TA/DA PDF download':'Download TA/DA PDF',
  'Travel policy PDF':'Travel policy PDF',
  'Travel policy PDF khul rahi hai':'Opening the travel policy PDF',
  'PDF ban gaya —':'PDF ready —',
  'Total working days':'Total working days',
  'On planned PJP':'On planned PJP',
  'Off PJP (approved change)':'Off PJP (approved change)',
  'Off PJP (approved)':'Off PJP (approved)',
  'Missed':'Missed',
  'Working days me weekly off, leave aur holiday nahi gine jaate. Adherence':'Working days exclude weekly off, leave and holidays. Adherence',
  '% — on-PJP aur approved off-PJP dono ginte hain. HOD kisi bhi din ko khud bhi mark kar sakta hai.':'% — both on-PJP and approved off-PJP count. The HOD can also mark any day himself.',
  'Telephonic calls':'Telephonic calls',
  'TC me se store par gaye':'of TC, visited in person',
  'TC me se phone par liye':'of TC, taken on the phone',
  'Day-wise NSV (₹ Lakh)':'Day-wise NSV (₹ Lakh)',
  'Last 7 days':'Last 7 days',
  'This month':'This month',
  'From':'From',
  'To':'To',
  'PJP adherence —':'PJP adherence —',
  'Working din':'Working days',
  'Jo mark nahi kiya wo app khud nikalta hai (order hua = on-PJP, approved change = off-PJP, kuch nahi = missed).':'Anything left unmarked the app works out itself (an order that day = on-PJP, an approved change = off-PJP, nothing = missed).',
  'mark ho gaya':'marked',
  '— auto —':'— auto —',
  'Open — action chahiye':'Open — needs action',
  'Open':'Open',
  'Closed':'Closed',
  'All':'All',
  'Sec order — shop ka final order':'Sec order — each shop’s final order',
  'Din ke beech me koi adjust karne ko kahe to yahin se karo — units badlo, line hatao, ya us shop me naya product add karo.':'If someone asks for an adjustment mid-day, do it here — change units, drop a line, or add a product to that shop.',
  'Shop':'Shop',
  'Units':'Units',
  'Value':'Value',
  '(aaj)':'(today)',
  'Naya order':'New order',
  'Aaj ka din lock hai — pehle Field tab se din dobara kholo.':'Today is locked — reopen the day from the Field tab first.',
  'ka koi order nahi hai':'has no orders',
  'Adjust':'Adjust',
  'Line hatao?':'Remove the line?',
  'is order se hat jayega.':'will come off this order.',
  'Ye shop master me nahi mila — Field tab se add karo':'This shop is not in the master — add it from the Field tab',
  'Aaj ka din lock hai — pehle din dobara kholo':'Today is locked — reopen the day first',
  'shelf khul gaya, product add karo aur order complete karo':'— the shelf is open, add the product and complete the order',
  'ka order update ho gaya — PO':'order updated — PO',
  'units':'units',
  'din joining se pehle ke the':'days were before the joining date',
  'Sirf':'Only',
  'Is period me team ka koi data nahi':'No team data for this period',
  'Mera NSV ₹L':'My NSV ₹L',
  'Team average ₹L':'Team average ₹L',
  'Team —':'Team —',
  'SC = scheduled calls (plan), TC = total calls, PC = productive calls, NSV in ₹ lakh.':'SC = scheduled calls (plan), TC = total calls, PC = productive calls, NSV in ₹ lakh.',
  '= leave,':'= leave,',
  '= weekly off,':'= weekly off,',
  '= meeting — us din market me nahi the. Sab employee dikhte hain, zero ho ya na ho.':'= meeting — not in the market that day. Every employee is listed, zero or not.',
  'Summary, approvals, permissions, data — sab kuch yahin se.':'Summary, approvals, permissions, data — all of it from here.',
  'Summary':'Summary',
  'Approvals':'Approvals',
  'Users':'Users',
  'Data':'Data',
  'PC (order mila)':'PC (orders won)',
  'Field par the':'In the market',
  'Plan notified':'Plan notified',
  'Employee-wise —':'Employee-wise —',
  'Kisi bhi row par tap karo — us employee ka poora din, PJP aur photo dikhega.':'Tap any row for that employee’s whole day, their PJP and their photos.',
  'L = leave, O = weekly off, M = meeting.':'L = leave, O = weekly off, M = meeting.',
  'Excel chahiye? Data tab':'Need Excel? The Data tab',
  'Field din':'Field days',
  'Off / leave':'Off / leave',
  'Is period me kuch record nahi':'Nothing recorded in this period',
  'Is period me koi photo nahi':'No photos in this period',
  'Photos':'Photos',
  'Sab ke liye':'For everybody',
  'Bypass — poori team':'Bypass — the whole team',
  'Photo, sequence aur poora-month PJP ki majboori sab ke liye hat jayegi. Sirf tab jab kuch tut gaya ho.':'The photo, the day sequence and full-month PJP stop being compulsory for everyone. Only when something is genuinely broken.',
  'OFF karo':'Turn OFF',
  'ON karo':'Turn ON',
  'Poori team par bypass ON hai':'Bypass is ON for the whole team',
  'kaam hote hi OFF karo':'turn it off as soon as the work is done',
  'PJP tab — poori team':'PJP tab — the whole team',
  'Normal niyam: 27 se 1 tarikh tak khula, HOD approve karne ke baad band. Yahan se force kar sakte ho.':'The normal rule: open from the 27th to the 1st, shut once the HOD approves. You can force it either way here.',
  'Normal niyam':'Normal rule',
  'Sab ke liye khula':'Open for everybody',
  'Sab ke liye band':'Shut for everybody',
  'Password reset':'Password reset',
  'Sab logins Honasa@123 ho jayenge, aur pehli login par change maangega.':'Every login becomes Honasa@123, and the first login will ask for a change.',
  'Reset all':'Reset all',
  'Bypass me kya-kya hat jata hai:':'What bypass waives:',
  '. Data phir bhi zaroori hai.':'. The data itself is still required.',
  'par bypass ON hai':'have bypass ON',
  'Naam, code ya HQ se dhoondo':'Search by name, code or HQ',
  'Is search me koi user nahi':'No user matches that search',
  'PJP khula':'PJP open',
  'PJP band':'PJP shut',
  'Inactive':'Inactive',
  'bypass by':'bypass by',
  'Bypass OFF':'Bypass OFF',
  'Bypass ON':'Bypass ON',
  'PJP: normal':'PJP: normal',
  'PJP: khula rakho':'PJP: keep open',
  'PJP: band rakho':'PJP: keep shut',
  'Login band karo':'Disable login',
  'Login chalu karo':'Enable login',
  'Sirf pehle 60 — search karo.':'First 60 only — use the search.',
  'badalna hai?':'— change it?',
  'Ye sab employee par lagu hoga.':'This applies to every employee.',
  'Haan, badlo':'Yes, change it',
  'Poori team ka bypass':'The whole team’s bypass',
  'Poori team ka PJP tab':'The whole team’s PJP tab',
  'normal niyam':'the normal rule',
  'Nahi hua':'That did not go through',
  'Report download':'Download a report',
  'Report':'Report',
  'row milenge —':'rows —',
  'sab employee':'all employees',
  'Excel download':'Download Excel',
  'Sab reports (ek file)':'All reports (one file)',
  'Data delete':'Delete data',
  'Jo report, jo employee aur jo date range upar chuna hai — wahi delete hoga.':'Whatever report, employee and date range are chosen above is what gets deleted.',
  'Pehle count dekho, phir confirm karo. Master tab kabhi nahi chhutte.':'Look at the count first, then confirm. Master tabs are never touched.',
  'Kitna delete hoga? (count)':'How many will go? (count)',
  'Delete karo':'Delete',
  'row delete honge':'rows will be deleted',
  'kuch nahi':'nothing',
  'Order delete karne par uski SecOrderLines bhi jaati hain.':'Deleting an order takes its SecOrderLines with it.',
  'Delete sirf Admin kar sakta hai, HOD nahi.':'Only an Admin can delete — not an HOD.',
  'Sab employee — ya naam / code likho':'All employees — or type a name / code',
  'employee · khali chhodo to sab':'employees · leave it blank for all',
  'Ban raha hai…':'Building…',
  'Download shuru —':'Download started —',
  'Gin raha hai…':'Counting…',
  'Pehle count dekho':'Look at the count first',
  'row delete karne hain?':'rows — delete them?',
  'Ye wapas nahi aayega. Confirm karne ke liye niche DELETE likho.':'This cannot be undone. Type DELETE below to confirm.',
  'DELETE likho':'Type DELETE',
  'DELETE likhna zaroori hai':'You have to type DELETE',
  'Haan, delete karo':'Yes, delete',
  'Delete ho raha hai…':'Deleting…',
  'Delete nahi hua':'The delete did not go through',
  'row delete ho gaye — sync kar raha hai':'rows deleted — syncing',
  'Count nahi hua':'The count did not come back',
  'login':'logins',
  'Requests — poori team':'Requests — the whole team',
  'Is month ka PJP update nahi hai. Kuch galat lage to admin se baat karo.':'This month’s PJP is not updated. Talk to your admin if something looks wrong.',
  'Master me is month ke':'The master has',
  'din hain — aaj ka nahi.':'days for this month — but not today.',
  'My data':'My data',
  'Mera data':'My data',
  'Apni koi bhi report, jitne din ki chahiye — Excel me download karo. Sirf aapka data jata hai.':'Any of your own reports, for as many days as you want — as an Excel file. Only your data goes into it.',
  'Mere orders (lines ke saath)':'My orders (with lines)',
  'Mera EOD':'My EOD',
  'Mere day plans':'My day plans',
  'Mera TA / DA':'My TA / DA',
  'Plan change requests':'Plan change requests',
  'Mere PJP drafts':'My PJP drafts',
  'Meri photos':'My photos',
  'Last 30 din':'Last 30 days',
  'Ye month':'This month',
  'Is period me kitna':'What is in this period',
  'Ye sirf aapke rows hain — team ka data kabhi nahi aata. Kisi aur ka data chahiye to HOD se maango.':'These are your rows only — team data never comes into it. For anyone else’s data, ask your HOD.',
  'Login phir se karo':'Log in again',
  'Compare':'Compare',
  'Aamne-saamne':'Head to head',
  'Number-wise':'Number by number',
  'Din-wise NSV':'Day-wise NSV',
  'Din shuru':'Days started',
  'Missed din':'Missed days',
  'Leave / off':'Leave / off',
  'NSV / field din':'NSV / field day',
  'SC (target calls)':'SC (target calls)',
  '— store visit':'— store visits',
  '— telephonic':'— telephonic',
  'Strike rate':'Strike rate',
  'PJP adherence':'PJP adherence',
  'Kaun kya kar sakta hai — bypass, PJP lock, active/inactive.':'Who may do what — bypass, PJP lock, active / inactive.',
  'Report download karo, ya galat data hatao.':'Download a report, or take wrong data out.',
  'Employee ka aaj ka live screen, jaisa unhe dikh raha hai.':'The employee’s live screen today, exactly as they see it.',
  'Aaj kya hua — pehle total, phir har aadmi. Compare bhi yahin se.':'What happened — the total first, then each person. Compare from here too.',
  'Pehle kisi ko tick karo':'Tick somebody first',
  'Aur kisi ko add karo':'Add somebody else',
  'Naam ya code likho':'Type a name or code',
  'Chuno…':'Choose…',
  'Sab employee add ho gaye.':'Every employee is already in.',
  'Metric':'Metric',
  'Din shuru (plan bhejo)':'Start the day (send the plan)',
  'Save ho gaya — WhatsApp bhejna baaki':'Saved — still to be sent on WhatsApp',
  'Plan bhej diya — din shuru, Field khul gaya':'Plan sent — day started, Field is open',
  'Plan bheja nahi':'Plan not sent',
  'Din shuru = plan WhatsApp par chala gaya. Sirf save karna shuruaat nahi hai.':'A day counts as started once the plan has gone out on WhatsApp. Saving it is not a start.',
  'aage hai':'is ahead',
  'kisi bhi metric par nahi':'on no metric at all',
  'metric par barabar. Missed din me kam behtar hai.':'metric(s) level. On missed days, fewer is better.',
  'Shuru:':'Started:',
  'us row ka leader. SC, field din, telephonic aur leave par koi leader nahi — wo zyada hone se behtar nahi hota.':'leads that row. SC, field days, telephonic and leave have no leader — more of them is not better.',
  'Neeche kisi bhi 2':'Tick any 2',
  'logon ko tick karo — side by side dikhega':'people below — they line up side by side',
  'Is period me kisi ka order nahi hai.':'Nobody has an order in this period.',
  'Ek baar me':'At most',
  'se zyada nahi — table padhne layak rehna chahiye.':'at a time — the table has to stay readable.',
  'log — pehle kisi ko hatao':'people — drop somebody first',
  'aur employee':'more employees',
  'Naam par tap karo — us employee ka poora din, PJP aur photo dikhega.':'Tap a name — that employee’s whole day, PJP and photos.',
  'Tick karke Compare dabao — do ya zyada log side by side.':'Tick people and hit Compare — two or more, side by side.',
  'sheet me hi rehta hai':'stays in the sheet',
  'Admin ne aapka PJP band kar rakha hai — unse baat karo':'Your admin has kept the PJP shut — talk to them',
  'ka PJP window':'’s PJP window closed on',
  'ko band ho gaya — admin se khulwao':'— ask your admin to open it',
  'Admin ne aapka PJP hata diya hai':'Your admin removed your PJP',
  'Admin ne aapka data hata diya hai':'Your admin removed some of your data',
  'PJP — published days + month draft':'PJP — published days + month draft',
  'Published PJP sirf ek aadmi ka hatta hai — sab ka ek saath nahi.':'A published PJP is only ever removed for one person — never for everybody at once.',
  'Jayega:':'Will go:',
  'Month chuna hai to poora month — aage ke din bhi.':'A month means the whole month — the days still to come as well.',
  'app sirf approve par likhta hai — aur upar se ek employee ka delete':'the app writes it on approval only — plus a one-employee delete from above',
  'Ek employee chuno':'Pick an employee',
  'PJP window abhi khula hai (27–1) — hataane ke baad wo khud se dobara bana sakta hai.':'The PJP window is open (27th–1st) — after this he can build it again himself.',
  'PJP window band hai, par is month ka draft nahi ja raha — uska current plan chalta rahega.':'The window is shut, but this month’s draft is not going — his current plan stays.',
  'ko band ho gaya — hataane ke baad wo khud dobara nahi bana payega. Users tab se uska PJP kholna padega.':'— after this he cannot build it again himself. You will have to open his PJP from the Users tab.',
  'PJP hat gaya aur window band hai — Users tab se uska PJP kholna padega':'The PJP is gone and the window is shut — open his PJP from the Users tab',
  'PJP me poore month ka range hone par hi us month ka draft jata hai — ek din delete karne se poora plan nahi jata.':'A month’s draft only goes when the range covers that whole month — deleting one day never takes the whole plan.',
  'din master me':'days in the master',
  'koi draft nahi':'no draft',
  'tab KHULA (admin ne khola)':'tab OPEN (an admin opened it)',
  'tab BAND (admin ne band kiya)':'tab SHUT (an admin shut it)',
  'tab KHULA (bypass)':'tab OPEN (bypass)',
  'tab band (approve ho gaya)':'tab shut (it is approved)',
  'tab KHULA (window 27–1 chalu hai)':'tab OPEN (the 27th–1st window is on)',
  'tab KHULA (decision baaki hai)':'tab OPEN (a decision is still owed)',
  'ko band ho gaya)':'closed)',
  'published din':'published days',
  'month ka draft':'month draft(s)',
  'sheet me hi rehta hai':'stays in the sheet',
  'Kya hatana hai, kiska, aur kis range ka — teen cheezein. Employee aur date range upar se aati hain.':'What goes, whose, and over which days — three things. The employee and the date range come from above.',
  'Kya delete karna hai':'What do you want to delete',
  'Sab kuch — poora data':'Everything — the whole of his data',
  'Orders — lines aur photos ke saath':'Orders — with their lines and photos',
  'Naye shop — photos ke saath':'New shops — with their photos',
  'POSM — audit aur requirement':'POSM — audit and requirement',
  'Day plan aur plan change':'Day plans and plan changes',
  'EOD aur DFR':'EOD and DFR',
  /* the already-plural form has to be listed too, and I18n.re sorts keys LONGEST-FIRST so this one wins:
     without it the 'Stock remark' rule below matched the first 12 characters of "Stock remarks" and the
     leftover 's' made it "Stock remarkss" — on the sheet tab, the report picker and the column header. */
  'Stock remarks':'Stock remarks',
  'Stock remark':'Stock remarks',
  'Photos (row — Drive file rehti hai)':'Photos (the row — the Drive file stays)',
  'Ek tab':'One tab',
  'is device par':'on this device:',
  'Poora data jayega':'The whole of his data will go',
  'Orders (+lines), naye shop, POSM, day plan, plan change, PJP (published + draft), TA/DA, EOD, DFR, stock remark aur photo row — sab is range ke.':'Orders (+lines), new shops, POSM, day plans, plan changes, the PJP (published + draft), TA/DA, EOD, DFR, stock remarks and photo rows — all of them, for this range.',
  'Activity log nahi jata (wo record hai), Drive ki photo file nahi jati, master tab nahi jate.':'The activity log stays (it is the record), the Drive photo files stay, and no master tab is touched.',
  '"Sab kuch" ek aadmi ka hi hatta hai. Sab ke liye — ek-ek report chuno, ya Days range ke saath.':'"Everything" only ever goes for one person. For the whole team, pick the reports one at a time, with a Days range.',
  'Parent ke saath child row apne aap jaati hai — order ke saath uski lines aur photo, shop/POSM ke saath unki photo. Koi aadha record nahi bachta.':'A child row always follows its parent — an order takes its lines and photos, a shop or POSM audit takes its photos. No half record is left.',
  'Month wali cheezein (PJP draft, TA/DA) tabhi jaati hain jab poora month range me ho — ek din delete karne se poora month nahi jata.':'Month-keyed things (the PJP draft, TA/DA) only go when the whole month is inside the range — deleting one day never takes the month.',
  'Activity log apne aap nahi jata, Drive ki photo file nahi jati, master tab (employee, store, product, config, phasing) kabhi nahi chhutte.':'The activity log is never taken automatically, Drive photo files stay, and the master tabs (employees, stores, products, config, phasing) are never touched.',
  'Delete Admin aur HOD dono kar sakte hain. Employee ke paas delete hai hi nahi — uske Data tab me sirf download hai.':'An Admin and an HOD can both delete. An employee has no delete at all — his Data tab is download only.',
  'What is in this file':'What is in this file',
  'Order ke saath uski lines aur us par li gayi photo row bhi jayegi — aadha record nahi bachega.':'An order takes its lines and the photo rows shot on it — no half record is left behind.',
  'Naye shop ke saath uski photo row bhi jayegi. Store master (Master_Stores) chhuta nahi.':'A new shop takes its photo rows with it. The store master (Master_Stores) is untouched.',
  'Activity log record hai — kisne kya kiya. Isse hataane par wo history chali jayegi.':'The activity log is the record of who did what. Remove it and that history is gone.',
  'Order detail':'Order detail',
  'Claim detail':'Claim detail',
  'Store code / city':'Store code / city',
  'Visit type':'Visit type',
  'DA / food':'DA / food',
  'Lodging':'Lodging',
  'Station / city':'Station / city',
  'Is order me koi SKU nahi — ye No Order / Cancel wala visit hai.':'No SKU in this order — it was a No Order / Cancel visit.',
  'Kaun kaun si report':'Which reports',
  'Ek se zyada chuno — har ek apne tab me aayegi':'Pick more than one — each gets its own tab',
  'Kiska data':'Whose data',
  'Khali chhodo to sab employee':'Leave it empty for every employee',
  'Report dhoondo':'Search the reports',
  'Group, ya seedha ek tab — ek se zyada bhi':'A group, or a single tab — more than one is fine',
  'ek tab':'one tab',
  'Kuch nahi mila':'Nothing matched',
  'Pehle report chuno':'Pick a report first',
  'Apni koi bhi report — ek ya kai — jitne din ki chahiye, Excel me. Sirf aapka data jata hai.':'Any of your own reports — one or several — for as many days as you want, as Excel. Only your data goes into it.',
  'kholne ke liye tap karo':'tap to open',
  'band karne ke liye tap karo':'tap to close',
  'row · read-only ·':'rows · read-only ·',
  '7 din':'7 days',
  'Published PJP':'Published PJP',
  'PJP drafts':'PJP drafts',
  'Pehle chuno kya delete karna hai':'First choose what to delete',
  'Server ne ye kaha:':'The server said this:',
  'koi jawab nahi':'no answer',
  'Aksar iska matlab:':'This usually means:',
  'Apps Script ka deployment purane version ka hai. backend.gs dobara paste karke New deployment karo — ya agar "admin only" likha hai to wahi purana version hai.':'the Apps Script deployment is an older version. Paste backend.gs again and make a New deployment — "admin only" means the same thing.',
  'row delete ho gaye':'rows deleted',
  'Kahan se:':'From where:',
  'Kuch match nahi hua.':'Nothing matched.',
  'Child rows (lines / photos) bhi isme hain.':'Child rows (lines / photos) are included in that.',
  'Ye nahi gaya:':'This did NOT go:',
  'ka month-wala row (PJP draft / TA-DA) — poora month range me hona chahiye tha.':'— the month-keyed row (PJP draft / TA-DA) needed the whole month inside the range.',
  'Kuch match nahi hua':'Nothing matched',
  'Is range me is employee ka koi row nahi mila. Date range ya employee badal ke dekho.':'No row for that employee in this range. Try a different range or employee.',
  'Range poore month ka kar diya':'The range now covers the whole month',
  'Poora month karo':'Use the whole month',
  'ka month-wala row (PJP draft / TA-DA)':'— the month-keyed row (PJP draft / TA-DA)',
  'nahi jayega':'will NOT go',
  '— range poore month ka nahi hai.':'— the range is not a whole month.',
  'server ne jawab nahi diya':'the server did not answer',
  'Delete, PJP delete aur kuch naye column tab tak kaam nahi karenge. Apps Script me backend.gs dobara paste karo, phir Deploy → New deployment.':'Delete, the PJP delete and some newer columns will not work until then. Paste backend.gs into Apps Script again, then Deploy → New deployment.',
  'Sheet ka script purana hai — v':'The sheet script is out of date — v',
  'chahiye v':'this app needs v',
  '(purane script ke liye tab-by-tab kiya gaya)':'(done tab by tab, for an older sheet script)',
  'Ye check nahi ho paya:':'This could not be checked:',
  'Baaki ka delete ho jayega.':'The rest will still be deleted.',
  'Meeting ya activity ka reason likho':'Write what the meeting or activity is',
  'Remark likho — tabhi ye din complete hoga.':'Write a remark — only then is this day complete.',
  'Meeting / Activity din me Remarks likhna baaki hai':'Meeting / Activity day(s) still need Remarks written',
  'in dino ka Town/Beat ya Remarks bharo':'fill in the Town/Beat or Remarks for these days',
  'Meeting / Activity ka Remarks likho':'Write the Remarks for the Meeting / Activity',
  'Pehle har reject wale din ka Town/Beat ya (meeting ho to) Remarks bharo — tabhi dobara bhej paoge.':'Fill in the Town/Beat, or the Remarks if it is a meeting, for every rejected day — only then can you resend.',
  'Order punch karo':'Punch the order',
  /* live updates + the read-only plan / waiting screen */
  'HOD ne approve kar diya — aage badho':'The HOD approved it — carry on',
  'HOD ne reject kiya — Requests me reason dekho':'The HOD rejected it — see the reason in Requests',
  'nayi request aayi hai — Approvals dekho':'new request(s) — check Approvals',
  'Sync already chal raha hai':'A sync is already running',
  'Sheet se sync ho raha hai…':'Syncing with the sheet…',
  'Sheet me change mila — master update kar rahe hain…':'The sheet changed — updating the masters…',
  'HOD approval ka wait':'Waiting for HOD approval',
  '· aapki Change PJP request HOD ke paas hai.':'· your Change PJP request is with the HOD.',
  'Waiting for approval':'Waiting for approval',
  'Kya maanga':'What you asked for',
  'Approve hone par ye screen apne aap khul jayegi — reload karne ki zaroorat nahi. Tab tak target aur WhatsApp band hai.':
    'This screen opens by itself once it is approved — no need to reload. Until then the target and WhatsApp are closed.',
  'Check for approval':'Check for approval',
  '*Approved by HOD — kuch bhi badalna ho to Change PJP dabao, sidha edit nahi hota.':
    '*Approved by HOD — to change anything press Change PJP; it cannot be edited directly.',
  'Yahi ek jagah hai jahan plan badal sakte ho. Mapping sheet se aati hai — na mile to':
    'This is the only place the plan can be changed. The mapping comes from the sheet — if it is missing, choose',
  'chuno, HOD approval ke baad master me add hoga.':'and it is added to the master after the HOD approves.',
  'Ye field day nahi hai — town/beat ki zaroorat nahi.':'Not a field day — no town/beat needed.',
  'Photo upload fail:':'Photo upload failed:',
  'Remove':'Remove',
  /* the source writes &amp; in the markup, so that is what a text run contains */
  'EOD save &amp; din close':'Save EOD &amp; close the day',

  'screen dekho, jaisa unhe abhi dikh raha hai (beech din ka status bhi). Preview me kuch bhi sheet me save nahi hota.':
    'screen for today, exactly as they see it right now (mid-day state included). Nothing is ever saved to the sheet while previewing.',
  'live screen dekho':'live screen',
  'Aaj ka kaam save karo':'Save today’s work',
  '· in the master':'· in the master',
  '· master me din:':'· days in master:',
  'Din:':'Days:',

  /* ── round 120: editing an approved PJP + the Notify feed ── */
  'Edit mode chalu hai':'Edit mode is on',
  'Kisi bhi din ka Edit dabakar badlo, phir niche Publish update dabao \u2014 rep ko notification bhi mil jayega.':
    'Tap Edit on any day to change it, then tap Publish update below \u2014 the rep will get a notification too.',
  'Approved plan edit karo':'Edit the approved plan',
  'Update publish karo':'Publish the update',
  'Jo din badle hain wahi Master_PJP me update honge, aur rep ko notification milega.':
    'Only the days that changed will be updated in Master_PJP, and the rep will get a notification.',
  'Publish update — rep ko bhejo':'Publish update — send to the rep',
  'Kuch change nahi hua':'Nothing changed',
  '! Publish fail: ':'! Publish failed: ',
  '! Publish nahi hua — dobara try karo':'! Publish failed — please try again',
  'badle:':'changed:',
  'Notifications — poori team':'Notifications — the whole team',
  'Meri notifications':'My notifications',
  'Jo bhi aaya hai — request ho ya sirf ek update — sab ek jagah, type se colour hai. Kisi bhi card par tap karo.':
    'Everything that comes in — a request or just an update — lives in one place, coloured by type. Tap any card.',
  'Jo bheja hai aur jo HOD ne update kiya, sab ek jagah. Kisi bhi card par tap karke detail dekho.':
    'What you sent, and what your HOD updated — all in one place. Tap any card to see the detail.',
  'Naya':'New',
  'Dekh liya':'Seen',
  'Dekh liya — band karo':'Seen — dismiss',
  'Kya badla':'What changed',
  'ne update kiya':'made this update'
};

/* ═══════════════ STORE — cache + offline queue ═══════════════ */
/* ntf is a PREFIX, not a key: the read receipts are stored per employee code (K.ntf + '_' + code),
   because a phone in the market gets handed around and one rep's dismissals are not another's. */
var K = { sess:'g2_session', cache:'g2_cache', queue:'g2_queue', users:'g2_users', pulled:'g2_pulled', lock:'g2_lock', navoff:'g2_navoff', ntf:'g2_ntf' };
var Store = {
  get: function (k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
};

/* ═══════════════ API ═══════════════ */
/* Every network call goes through here, so counting them in one place is what makes the loader
   appear EVERYWHERE something is loading — no screen has to remember to show one. */
var Load = {
  block: function (m) {
    var l = $('load'); if (!l) return;
    /* writes straight into the DOM, so it has to translate itself — this overlay is why "Sheet se
       data aa raha hai" still appeared on load with English selected */
    var b = l.querySelector('b'); if (b) b.textContent = I18n.s(m || 'Load ho raha hai…');
    l.classList.add('on');
  },
  unblock: function () { var l = $('load'); if (l) l.classList.remove('on'); },
  /* the Sync button doubles as a live indicator: any REAL request in flight (never a quiet
     autosave — those skip Api.begin/end entirely) puts "Syncing…" in it on its own, so nobody has
     to wonder whether something is happening. Sync.now() already owns the button's text for the
     duration of an explicit tap; this only touches it the rest of the time. */
  bar: function (on) {
    var b = $('bar'); if (b) b.classList.toggle('on', !!on);
    var s = $('tb_sync');
    if (s && typeof Sync !== 'undefined' && !Sync.busy) s.innerHTML = on ? '<span class="spin"></span> Syncing…' : '↻ Sync';
  }
};

var Api = {
  n:0,                                              /* requests in flight */
  online: function () { return navigator.onLine !== false; },
  begin: function () { Api.n++; Load.bar(true); },
  end: function () { Api.n = Math.max(0, Api.n - 1); if (!Api.n) Load.bar(false); },
  /* resolve/reject both have to release the loader, or the bar would stay up forever */
  done: function (p) { return p.then(function (r) { Api.end(); return r; },
                                     function (e) { Api.end(); throw e; }); },
  /* `quiet` skips the loader entirely — used by the 25-second liveness poll, which must not flash a
     progress bar at the rep every few seconds */
  get: function (params, quiet) {
    params.token = API_TOKEN;
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    if (quiet) return fetch(API_URL + '?' + q, { method:'GET', redirect:'follow' }).then(function (r) { return r.json(); });
    Api.begin();
    return Api.done(fetch(API_URL + '?' + q, { method:'GET', redirect:'follow' }).then(function (r) { return r.json(); }));
  },
  /* `quiet` skips the loader entirely — mirrors Api.get. The routine autosaves that fire on nearly
     every keystroke (Pjp.flush, Admin.setDay, Log.add…) used to flash the top bar dozens of times a
     minute, which is what read as "it's always syncing". Only a caller that explicitly asks for
     quiet gets this; every user-facing action (Save, Submit, Approve, Delete, Publish…) still shows
     it, because DB.save/saveMany default `quiet` to falsy when a caller doesn't pass it. */
  post: function (body, quiet) {
    body.token = API_TOKEN;
    if (quiet) return fetch(API_URL, { method:'POST', redirect:'follow', body:JSON.stringify(body),
      headers:{ 'Content-Type':'text/plain;charset=utf-8' } }).then(function (r) { return r.json(); });
    Api.begin();
    return Api.done(fetch(API_URL, { method:'POST', redirect:'follow', body:JSON.stringify(body),
      headers:{ 'Content-Type':'text/plain;charset=utf-8' } }).then(function (r) { return r.json(); }));
  }
};

/* ═══════════════ DB — masters + transactional data, sheet is authoritative ═══════════════ */
var DB = {
  m:{}, t:{}, me:null, pulledAt:0,
  TXN:['SecOrders','SecOrderLines','NewStores','PosmAudit','PosmRequirement','DayPlan','Eod','Dfr',
       'PjpDraft','Deviation','TaDa','StockRemark','ActivityLog','Photos','Notify'],
  KEY:{ SecOrders:'PoNumber', SecOrderLines:'LineId', NewStores:'StoreId', PosmAudit:'Id', PosmRequirement:'Id',
        DayPlan:'Id', Eod:'Id', Dfr:'Id', PjpDraft:'Key', Deviation:'Id', TaDa:'Id', StockRemark:'Id',
        ActivityLog:'Id', Photos:'Key', Notify:'Id' },

  boot: function () {
    var c = Store.get(K.cache, null);
    if (c) { DB.m = c.m || {}; DB.t = c.t || {}; DB.me = c.me || null; DB.pulledAt = c.at || 0;
      DB.mAt = c.mAt || 0; DB.mver = c.mver || 0; DB.counts = c.counts || {}; }
  },
  cache: function () { Store.set(K.cache, { m:DB.m, t:DB.t, me:DB.me, at:DB.pulledAt,
    mAt:DB.mAt, mver:DB.mver, counts:DB.counts }); },

  /* ── LOAD TIME, WITHOUT TRADING AWAY CORRECTNESS ──
     The rule stays "the sheet always wins". What changed is only how much travels:
       · Stock_Store + Stock_Distributor (~95k rows) are not downloaded — the app only ever showed
         their row COUNT, which now arrives as a number.
       · A routine sync asks for the TRANSACTIONAL rows only… but every response carries `mver`, the
         spreadsheet's own modified time. If it differs from the one we hold, the masters are re-pulled
         IMMEDIATELY in the same cycle. So a beat edited by hand in the sheet is picked up on the very
         next sync, exactly as before — the saving is only in the quiet case where nothing changed.
       · Our own writes move that timestamp too, so push_ returns the new value and we store it; a
         rep's own order does not trigger a pointless master re-read.
       · A 15-minute timer remains as a backstop, and an explicit Sync is always a FULL pull. */
  mAt:0, mver:0, counts:{}, MFRESH:900000,
  pull: function (loud, opt) {
    var s = Auth.session();
    if (!s) return Promise.resolve({ ok:false });
    opt = opt || {};
    var txnOnly = opt.txn === true && DB.mAt && (Date.now() - DB.mAt < DB.MFRESH) &&
                  (DB.m.Master_Employees || []).length > 0;
    /* nothing has ever been painted → block the screen, otherwise the rep stares at empty cards
       and assumes the app is broken. Every later pull only raises the thin top bar. */
    if (!DB.pulledAt) Load.block('Sheet se data aa raha hai…');
    if (loud) syncChip('Sheet se data aa raha hai…');
    return Api.get({ action:'pull', email:s.email, txnOnly:txnOnly ? 1 : '' }).then(function (r) {
      Load.unblock();
      if (!r || !r.ok) { syncChip('! Sync fail — offline data'); return r || { ok:false }; }
      ['Master_Config','Master_Employees','Master_Stores','Master_Distributors','Master_Products',
       'Master_PJP','Master_Phasing','Stock_Distributor','Stock_Store','LoginConfig'].forEach(function (k) {
        if (r[k]) DB.m[k] = r[k];
      });
      if (r.masters) DB.mAt = Date.now();
      if (r.counts) DB.counts = r.counts;
      /* ── normalise the columns every lookup matches on, ONCE, here ──
         A Master_PJP row for today was being missed because the sheet cell held "HCPL2573 " with a
         trailing space (what pasting a column does) while the app compared it to "HCPL2573". Every
         consumer — the Plan screen, the PJP builder, adherence, the TA/DA claim — did its own
         `String(Code).toUpperCase()` with no trim, so all of them missed it and none of them said why.
         Trimming here means no screen can ever be caught by whitespace again; the same for the date,
         which is normalised to ISO so an ISO-to-ISO comparison is all anyone has to do. */
      DB.fix();
      /* Master_PJP de-dupe: the live sheet carries 31 rows where the same employee+date appears
         twice (leftovers from the previous app writing into the master). Keep the FIRST row the
         sheet returns — that is the customer's own — so a lookup can never land on a stale copy. */
      if (DB.m.Master_PJP) {
        var seen = {}, dup = 0;
        DB.m.Master_PJP = DB.m.Master_PJP.filter(function (p) {
          var k = String(p.Code || '') + '|' + String(p.Date || '');
          if (k === '|') return true;
          if (seen[k]) { dup++; return false; }
          seen[k] = 1; return true;
        });
        DB.pjpDupes = dup;
      }
      DB.TXN.forEach(function (k) { if (r[k]) DB.t[k] = r[k]; });
      DB.me = r.me || DB.me;
      DB.pulledAt = Date.now();
      DB.cache();
      /* the sheet is the truth: drop anything this device is holding that no longer exists there */
      DB.reconcile();
      /* SOMEONE ELSE TOUCHED THE SHEET → the masters we just skipped are stale. Re-pull them right
         now, in the same cycle, so "transactional-only" can never mean "out of date". */
      if (txnOnly && r.mver && DB.mver && r.mver !== DB.mver) {
        DB.mver = r.mver;
        syncChip('Sheet me change mila — master update kar rahe hain…');
        return DB.pull(loud);
      }
      if (r.mver) DB.mver = r.mver;
      syncChip('Sheet se sync ho gaya');
      return r;
    }).catch(function () { Load.unblock(); syncChip('! Offline — local data'); return { ok:false }; });
  },
  /* ── after every pull: forget local state whose row is GONE ──
     An admin can remove data from the console. The pull replaces every transactional tab, so the row
     disappears — but a screen may still be holding it, and a flush on tab-leave would write it back.
     Everything a device could be mid-edit on is checked against the sheet here, in one place, so no
     screen has to remember to do it. */
  reconcile: function () {
    var lost = [];
    try { if (Pjp.reconcile()) lost.push('PJP'); } catch (e) {}
    try {
      /* an order being adjusted that is no longer there */
      if (Field.editPo && !DB.rows('SecOrders').some(function (o) {
            return String(o.PoNumber) === String(Field.editPo); })) {
        Field.editPo = ''; Field.lines = []; Field.store = null; Field.mode = 'order';
        lost.push('order');
      }
      if (Sec.edit && !DB.rows('SecOrders').some(function (o) {
            return String(o.PoNumber) === String(Sec.edit); })) Sec.edit = null;
      if (Fin.open && !DB.rows('SecOrders').some(function (o) {
            return String(o.PoNumber) === String(Fin.open); })) Fin.open = '';
    } catch (e) {}
    if (lost.length) {
      try { Nav.build(); } catch (e) {}
      toast(I18n.s('Admin ne aapka ' + (lost[0] === 'PJP' ? 'PJP' : 'data') + ' hata diya hai'), 5000);
    }
    return lost;
  },
  fresh: function (ms) { return Date.now() - DB.pulledAt < (ms || 90000); },
  /* pull if stale — called on tab open / foreground. Transactional-only, so opening a tab costs a
     few KB instead of the whole master set. */
  maybe: function () { if (!DB.fresh() && Api.online()) DB.pull(false, { txn:true }).then(render); },

  rows: function (tab) { return (DB.t[tab] || []).slice(); },
  mine: function (tab) {
    var me = (DB.me && DB.me.code) || '';
    return DB.rows(tab).filter(function (r) { return !r.EmpCode || String(r.EmpCode).toUpperCase() === me.toUpperCase(); });
  },
  find: function (tab, key) {
    var kc = DB.KEY[tab], v = String(key);
    var a = DB.rows(tab);
    for (var i = 0; i < a.length; i++) if (String(a[i][kc]) === v) return a[i];
    return null;
  },

  /* Master_* tabs are the customer's source of truth — the app must never write one. The backend
     refuses them too; this is the client-side half of the same rule, so a future code path can't
     quietly start writing a master. The ONE exception is the admin-only publishPjp action, which
     runs server-side and upserts on Code+Date. */
  isMaster: function (tab) { return /^master/i.test(String(tab || '').trim()); },

  /* UPSERT — local first (instant), then sheet. Same key ⇒ overwrite, never duplicate. */
  save: function (tab, row, opt) {
    opt = opt || {};
    if (DB.isMaster(tab)) { try { console.warn('[GARUDA] blocked write to read-only master tab: ' + tab); } catch (e) {}
      return Promise.resolve({ ok:false, blocked:true, error:'Master_* tabs are read-only' }); }
    var kc = DB.KEY[tab];
    if (!row[kc]) return Promise.resolve({ ok:false, error:'no key' });
    var s = Auth.session();
    row.EmpCode = row.EmpCode || (DB.me && DB.me.code) || s.code;
    row.EmpName = row.EmpName || (DB.me && DB.me.name) || s.name;
    if (row.Date) row.Date = toISO(row.Date);
    row.Ts = row.Ts || new Date().toISOString();

    DB.t[tab] = DB.t[tab] || [];
    var arr = DB.t[tab], hit = -1;
    for (var i = 0; i < arr.length; i++) if (String(arr[i][kc]) === String(row[kc])) { hit = i; break; }
    if (hit >= 0) arr[hit] = Object.assign({}, arr[hit], row); else arr.push(row);
    DB.cache();

    /* Send the MERGED row, not just the changed fields. A caller legitimately passes a partial row
       (Pjp.flush sends DaysJson but not SubmittedAt); pushing that alone used to blank every other
       column in the sheet. The backend merges too — this is the client-side half of the same rule. */
    var full = hit >= 0 ? arr[hit] : row;
    if (Preview.on) return Promise.resolve({ ok:true, preview:true });
    return Api.post({ action:'push', email:s.email, sheet:tab, rows:[full] }, opt.quiet).then(function (r) {
      if (!r || !r.ok) { Queue.add({ action:'push', email:s.email, sheet:tab, rows:[full] }); syncChip('Queue me — internet aane par jayega'); }
      else if (!opt.quiet) syncChip('Sheet me save');
      /* our own write moved the sheet's modified time — record it, or the next sync would mistake it
         for someone else's edit and re-download every master */
      if (r && r.mver) { DB.mver = r.mver; DB.cache(); }
      return r || { ok:false };
    }).catch(function () {
      Queue.add({ action:'push', email:s.email, sheet:tab, rows:[full] });
      syncChip('Offline — queue me save'); return { ok:false };
    });
  },
  saveMany: function (tab, rows) {
    if (DB.isMaster(tab)) return Promise.resolve({ ok:false, blocked:true, error:'Master_* tabs are read-only' });
    if (!rows.length) return Promise.resolve({ ok:true });
    var s = Auth.session(), kc = DB.KEY[tab], send = [];
    DB.t[tab] = DB.t[tab] || [];
    rows.forEach(function (row) {
      row.EmpCode = row.EmpCode || DB.me.code; row.EmpName = row.EmpName || DB.me.name;
      if (row.Date) row.Date = toISO(row.Date);
      var arr = DB.t[tab], hit = -1;
      for (var i = 0; i < arr.length; i++) if (String(arr[i][kc]) === String(row[kc])) { hit = i; break; }
      if (hit >= 0) arr[hit] = Object.assign({}, arr[hit], row); else arr.push(row);
      send.push(hit >= 0 ? arr[hit] : row);                  /* merged, so nothing gets blanked */
    });
    DB.cache();
    if (Preview.on) return Promise.resolve({ ok:true, preview:true });
    return Api.post({ action:'push', email:s.email, sheet:tab, rows:send }).catch(function () {
      Queue.add({ action:'push', email:s.email, sheet:tab, rows:send }); return { ok:false };
    });
  },
  remove: function (tab, key) {
    if (DB.isMaster(tab)) return Promise.resolve({ ok:false, blocked:true, error:'Master_* tabs are read-only' });
    var kc = DB.KEY[tab], s = Auth.session();
    DB.t[tab] = DB.rows(tab).filter(function (r) { return String(r[kc]) !== String(key); });
    DB.cache();
    if (Preview.on) return Promise.resolve({ ok:true });
    return Api.post({ action:'del', email:s.email, sheet:tab, keys:[key] }).catch(function () { return { ok:false }; });
  },

  /* master lookups */
  cfg: function (k, d) { var a = DB.m.Master_Config || [];
    for (var i = 0; i < a.length; i++) if (String(a[i].Key) === k) return a[i].Value; return d; },
  emp: function (code) { var a = DB.m.Master_Employees || [], q = String(code || '').toUpperCase();
    for (var i = 0; i < a.length; i++) if (String(a[i].Code).toUpperCase() === q || String(a[i].Name).toUpperCase() === q) return a[i];
    return null; },
  doj: function (code) { var e = DB.emp(code); var d = e ? toISO(e.DateofJoining) : '';
    if (d) return d;
    var u = (DB.m.LoginConfig || []).filter(function (x) { return String(x.Code).toUpperCase() === String(code).toUpperCase(); })[0];
    return u ? toISO(u.DateofJoining) : (DB.me && DB.me.doj ? toISO(DB.me.doj) : ''); },
  /* my stores = Master_Stores where EmAsm is me (name or code); fallback: all */
  myStores: function () {
    var me = (DB.me.name || '').toUpperCase().replace(/\s+/g, ' ').trim(), code = (DB.me.code || '').toUpperCase();
    var all = DB.m.Master_Stores || [];
    var mine = all.filter(function (s) { var a = String(s.EmAsm || '').toUpperCase().replace(/\s+/g, ' ').trim();
      return a && (a === me || a === code); });
    return mine.length ? mine : all;
  },
  /* one distributor, by code, from Master_Distributors — the authority on what a distributor IS */
  distByCode: function (code) {
    var q = String(code == null ? '' : code).trim().toUpperCase();
    if (!q) return null;
    var all = DB.m.Master_Distributors || [];
    for (var i = 0; i < all.length; i++)
      if (String(all[i].Code == null ? '' : all[i].Code).trim().toUpperCase() === q) return all[i];
    return null;
  },
  /* ── the rep's distributors, ALWAYS resolved to a Master_Distributors row ──
     Three ways a rep's distributors are identified, tried in order — and every one of them ends at a
     real row in the distributor master, never at a record assembled from another tab:
       1. the distributor master's own mapping column (EmAsm = this rep);
       2. the distributors his mapped stores point at, looked UP in the master by code;
       3. the whole distributor master.
     Step 2 used to RETURN { Code, Name } built straight out of Master_Stores' DbCode / DbName columns.
     Those two are a denormalised copy of the distributor master: they go stale the moment a distributor
     is renamed there, they carry no City / State / Zone / ASM at all, and a distributor the rep has no
     store with YET could never appear — which is exactly the case when he is opening a new outlet under
     one. So a store's DbCode is now only ever a POINTER used to find the master row. */
  myDistributors: function () {
    var me = (DB.me.name || '').toUpperCase().replace(/\s+/g, ' ').trim(), code = (DB.me.code || '').toUpperCase();
    var all = DB.m.Master_Distributors || [];
    var mapped = all.filter(function (d) { var a = String(d.EmAsm || '').toUpperCase().replace(/\s+/g, ' ').trim();
      return a && (a === me || a === code); });
    /* the admin has said whose distributors these are — that mapping IS the answer */
    if (mapped.length) return mapped;
    /* ── nothing mapped: offer the WHOLE master, likely ones first ──
       Narrowing to just the distributors he already has stores with would hide the very distributor a
       NEW outlet is most often opened under: one he has no store with YET. So every distributor in the
       master is offerable, and the ones he already deals with are simply lifted to the top. */
    var near = {};
    DB.myStores().forEach(function (s) {
      var c = String(s.DbCode || '').trim(); if (c) near[c.toUpperCase()] = 1;
    });
    var mine = [], rest = [];
    all.forEach(function (d) {
      (near[String(d.Code == null ? '' : d.Code).trim().toUpperCase()] ? mine : rest).push(d);
    });
    return mine.concat(rest);
  },
  /* does the rep already have a store with this distributor? Only used to GROUP the list — never to
     decide what is offerable. */
  distIsMine: function (code) {
    var q = String(code == null ? '' : code).trim().toUpperCase();
    if (!q) return false;
    return DB.myStores().some(function (s) {
      return String(s.DbCode == null ? '' : s.DbCode).trim().toUpperCase() === q; });
  },
  /* codes the rep's stores point at that the distributor master does not have. Not an error the rep can
     fix — it is a gap in the masters — but he has to be told, or a distributor he expects to see in the
     new-outlet list is simply absent and he has no idea why. */
  distGaps: function () {
    var seen = {}, gaps = [];
    DB.myStores().forEach(function (s) {
      var c = String(s.DbCode || '').trim(); if (!c || seen[c.toUpperCase()]) return;
      seen[c.toUpperCase()] = 1;
      if (!DB.distByCode(c)) gaps.push(c + (s.DbName ? ' (' + s.DbName + ')' : ''));
    });
    return gaps;
  },
  products: function () { return DB.m.Master_Products || []; },
  /* ── one comparison for every code in the app ──
     A code arrives from three places (LoginConfig, Master_Employees, a pasted master column) and any
     of them can carry a space or a different case. Nothing may depend on which. */
  same: function (a, b) {
    return String(a == null ? '' : a).trim().toUpperCase() ===
           String(b == null ? '' : b).trim().toUpperCase();
  },
  /* trim the codes and ISO the dates on the masters everything is matched against. Called once per
     pull, before the de-dupe. */
  fix: function () {
    ['Master_PJP', 'Master_Employees', 'Master_Phasing'].forEach(function (t) {
      (DB.m[t] || []).forEach(function (r) {
        if (r.Code !== undefined) r.Code = String(r.Code == null ? '' : r.Code).trim().toUpperCase();
        if (t === 'Master_PJP' && r.Date !== undefined) r.Date = toISO(r.Date) || r.Date;
      });
    });
    (DB.m.LoginConfig || []).forEach(function (r) {
      if (r.Code !== undefined) r.Code = String(r.Code == null ? '' : r.Code).trim().toUpperCase();
    });
    if (DB.me && DB.me.code) DB.me.code = String(DB.me.code).trim().toUpperCase();
  },
  /* PJP row straight from Master_PJP — admin edits here reflect immediately after a pull */
  pjpFor: function (code, date) {
    var d = toISO(date);
    var a = DB.m.Master_PJP || [];
    for (var i = 0; i < a.length; i++)
      if (DB.same(a[i].Code, code) && toISO(a[i].Date) === d) return a[i];
    return null;
  },
  pjpMonth: function (code, month) {
    return (DB.m.Master_PJP || []).filter(function (r) {
      return DB.same(r.Code, code) && toISO(r.Date).slice(0, 7) === month; });
  },
  /* what the master DOES hold for this rep in a month — so a missing day can be explained instead of
     leaving the rep staring at "no plan" */
  pjpNear: function (code, date) {
    var mo = String(date || today()).slice(0, 7);
    var days = DB.pjpMonth(code, mo).map(function (r) { return toISO(r.Date); }).sort();
    return { month:mo, days:days, has:days.length };
  }
};

/* ═══════════════ QUEUE — nothing is lost when offline ═══════════════ */
var Queue = {
  add: function (op) { var q = Store.get(K.queue, []); q.push(op); Store.set(K.queue, q); Queue.badge(); },
  badge: function () { var n = Store.get(K.queue, []).length; if (n) syncChip('' + n + ' pending sync'); },
  drain: function () {
    var q = Store.get(K.queue, []);
    if (!q.length || !Api.online()) return Promise.resolve(0);
    var keep = [], done = 0;
    return q.reduce(function (ch, op) {
      return ch.then(function () {
        return Api.post(op).then(function (r) { if (r && r.ok) done++; else keep.push(op); })
          .catch(function () { keep.push(op); });
      });
    }, Promise.resolve()).then(function () {
      Store.set(K.queue, keep);
      if (done) syncChip('' + done + ' pending sync ho gaya');
      return done;
    });
  }
};

/* ═══════════════ ONE-SHOT GUARD ═══════════════
   Tapping a submit button three times must not send three requests. Every action that creates
   something wraps itself in Busy.run(key, fn): the first tap runs, the rest are ignored until it
   finishes, and the button itself is disabled + relabelled while in flight. */
var Busy = {
  on:{},
  run: function (key, el, label, fn) {
    if (Busy.on[key]) { toast('Ruko — pehla request chal raha hai'); return null; }
    Busy.on[key] = true;
    var txt = null;
    /* spinner INSIDE the button — every guarded action gets it for free, so no screen has to
       remember to show progress on its own submit button */
    if (el) { txt = el.textContent; el.disabled = true;
      el.innerHTML = I18n.tr('<span class="spin"></span> ' + esc(label || 'Bhej raha hai…')); }
    var done = function () {
      delete Busy.on[key];
      if (el) { el.disabled = false; if (txt !== null) el.textContent = txt; }
    };
    var p;
    try { p = fn(); } catch (e) { done(); throw e; }
    if (p && p.then) return p.then(function (r) { done(); return r; }, function (e) { done(); throw e; });
    done(); return p;
  },
  busy: function (key) { return !!Busy.on[key]; }
};

/* ═══════════════ AUTOSAVE — flush on every tab change ═══════════════ */
var Flush = {
  jobs:{},
  reg: function (name, fn) { Flush.jobs[name] = fn; },
  clear: function () { Flush.jobs = {}; },
  all: function () {
    var names = Object.keys(Flush.jobs), out = [];
    names.forEach(function (n) { try { var p = Flush.jobs[n](); if (p && p.then) out.push(p); } catch (e) {} });
    return out.length ? Promise.all(out) : Promise.resolve([]);
  }
};

/* ═══════════════ AUTH — drives the original GARUDA login gate ═══════════════
   The login screen, password-change modal and forgot-password modal are the EXACT markup
   from the previous build (single-file-app), so the ids below are theirs:
   gate_email / gate_pwd / gate_err, pwd_change_*, forgot_*. */
var Auth = {
  session: function () { return Store.get(K.sess, null); },
  users: function () { return Store.get(K.users, []) || []; },

  /* ── the login button's two states, in one place ──
     `busy` is what makes one tap enough: the button says "Logging in…" with a spinner and refuses a
     second tap, instead of sitting there looking untouched while an Apps Script cold start takes
     three seconds. `gateErr` is the only way back out of that state. */
  BTN:'LOGIN TO GARUDA',
  busy:false,
  gateBusy: function (on) {
    Auth.busy = !!on;
    var b = $('gate_btn'); if (!b) return;
    b.disabled = !!on;
    b.style.opacity = on ? '.75' : '';
    b.style.cursor = on ? 'default' : 'pointer';
    b.innerHTML = on ? '<span class="spin" style="border-color:rgba(255,255,255,.45);border-top-color:#fff"></span> ' +
      esc(I18n.s('Logging in…')) : esc(I18n.s(Auth.BTN));
  },
  gateErr: function (m) {
    var e = $('gate_err'); if (e) e.textContent = I18n.s(m || '');
    Auth.gateBusy(false);
  },
  login: function () {
    if (Auth.busy) return;                       /* a second tap while the first is still in flight */
    var em = String(($('gate_email') || {}).value || '').trim().toLowerCase();
    var pw = String(($('gate_pwd') || {}).value || '');
    if (!em) return Auth.gateErr('Email bharo');
    if (!pw) return Auth.gateErr('Password bharo');
    if (em.indexOf('@') < 0) return Auth.gateErr('Poora email likho (jaise name@mamaearth.in)');
    Auth.gateErr('');
    Auth.gateBusy(true);
    var done = function (users) {
      Store.set(K.users, users);
      /* trim BOTH sides: a stray space in the sheet's Email cell used to read as "not registered" */
      var u = (users || []).filter(function (x) {
        return String(x.Email || '').trim().toLowerCase() === em; })[0];
      if (!u) return Auth.gateErr('Ye email register nahi hai — spelling check karo ya admin se poochho');
      if (String(u.Status || '').trim().toLowerCase() !== 'active') return Auth.gateErr('Account inactive hai — admin se baat karo');
      if (String(u.Password) !== pw) return Auth.gateErr('Password galat hai — dobara try karo');
      /* first login → force a password change before entering the app */
      if (!u.PwdChanged || u.PwdChanged === 'FALSE' || u.PwdChanged === false) {
        if ($('pwd_change_email')) $('pwd_change_email').value = em;
        if ($('pwd_change_old')) $('pwd_change_old').value = pw;
        var mm = $('pwd_change_modal'); if (mm) mm.style.display = 'flex';
        Auth.gateErr('');
        return;
      }
      Auth.gateBusy(false);
      Auth.enter(u, em);
    };
    if (!Api.online()) { var c = Auth.users(); return c.length ? done(c) : Auth.gateErr('Offline ho — pehli baar login ke liye internet chahiye'); }
    Api.get({ action:'login' }).then(function (r) {
      if (!r || !r.ok) { var c = Auth.users(); if (c.length) return done(c); return Auth.gateErr('Server se connect nahi hua — API_URL check karo'); }
      done(r.users);
    }).catch(function () { var c = Auth.users(); if (c.length) return done(c); Auth.gateErr('Network error — dobara try karo'); });
  },
  enter: function (u, em) {
    /* the bypass flag comes down with the login row too, so the very first screen after login already
       knows — otherwise the gates would look locked until the first pull returned `me` */
    var byp = /^(yes|true|1)$/i.test(String(u.Bypass || ''));
    Store.set(K.sess, { code:u.Code, name:u.Name, email:em, rights:u.Rights || 'Employee',
      hq:u.HQ, zone:u.Zone, desig:u.Designation, doj:toISO(u.DateofJoining), pwdChanged:true });
    DB.me = { code:u.Code, name:u.Name, rights:u.Rights || 'Employee', hq:u.HQ, zone:u.Zone,
      desig:u.Designation, doj:toISO(u.DateofJoining),
      bypass:byp, bypassBy:u.BypassBy || '', bypassNote:u.BypassNote || '' };
    Auth.start();
  },
  start: function () {
    var g = $('login_gate'); if (g) g.style.display = 'none';
    $('app').classList.remove('hide');
    Auth.chrome();
    Nav.restore();
    Nav.build();
    Router.go(Auth.isAdmin() ? 'admin' : 'home');
    DB.pull(true).then(function () { Nav.build(); render(); });
    Queue.drain();
  },
  /* the bits of the topbar that are not part of a screen render — refreshed on login and whenever
     the language changes */
  chrome: function () {
    var s = Auth.session(); if (!s) return;
    var av = $('tb_av'); if (av) av.textContent = (s.name || '?').slice(0, 1);
    var sub = $('tb_sub');
    if (sub) sub.textContent = s.name + ' · ' + (String(s.rights).toLowerCase() === 'employee' ? (s.hq || '') : s.rights);
    var lg = $('tb_lang'); if (lg) lg.textContent = I18n.code();
  },
  showGate: function () {
    var g = $('login_gate'); if (g) g.style.display = 'block';
    $('app').classList.add('hide');
  },
  logout: function () { Flush.all().then(function () { Store.del(K.sess); location.reload(); }); },
  isAdmin: function () {
    var s = Auth.session(); if (!s || Preview.on) return false;
    var r = String(s.rights || '').toLowerCase(); return r === 'admin' || r === 'hod';
  }
};

/* ── handlers the original gate markup calls ── */
window.__togglePwd = function (id, el) {
  var e = $(id); if (!e) return;
  e.type = e.type === 'password' ? 'text' : 'password';
  if (el) el.textContent = e.type === 'password' ? '' : '';
};
window.__doLogin = function () { Auth.login(); };

window.__closePwdChange = function () { var m = $('pwd_change_modal'); if (m) m.style.display = 'none'; };
window.__doPasswordChange = function () {
  var em = String(($('pwd_change_email') || {}).value || '').trim().toLowerCase();
  var old = String(($('pwd_change_old') || {}).value || '');
  var n1 = String(($('pwd_change_new') || {}).value || '');
  var n2 = String(($('pwd_change_confirm') || {}).value || '');
  var err = function (m) { var e = $('pwd_change_err'); if (e) e.textContent = m || ''; };
  if (n1.length < 6) return err('Naya password kam se kam 6 character ka ho');
  if (n1 !== n2) return err('Dono password match nahi kar rahe');
  if (n1 === old) return err('Naya password purane se different hona chahiye');
  err('Save ho raha hai…');
  Api.post({ action:'setpwd', email:em, mode:'change', oldPwd:old, newPwd:n1 }).then(function (r) {
    if (!r || !r.ok) return err((r && r.error) || 'Save nahi hua — dobara try karo');
    var users = Auth.users().map(function (u) {
      if (String(u.Email).toLowerCase() === em) { u.Password = n1; u.PwdChanged = true; } return u; });
    Store.set(K.users, users);
    window.__closePwdChange();
    var u = users.filter(function (x) { return String(x.Email).toLowerCase() === em; })[0];
    if (u) { Auth.enter(u, em); toast('Password change ho gaya'); }
  }).catch(function () { err('Network error — dobara try karo'); });
};

window.__showForgot = function () {
  var m = $('forgot_modal'); if (!m) return;
  if ($('forgot_email') && $('gate_email')) $('forgot_email').value = $('gate_email').value || '';
  m.style.display = 'flex';
};
window.__closeForgot = function () { var m = $('forgot_modal'); if (m) m.style.display = 'none'; };
window.__doForgot = function () {
  var em = String(($('forgot_email') || {}).value || '').trim().toLowerCase();
  var mob = String(($('forgot_mob') || {}).value || '');
  var n1 = String(($('forgot_newpwd') || {}).value || '');
  var n2 = String(($('forgot_confirm') || {}).value || '');
  var err = function (m) { var e = $('forgot_err'); if (e) e.textContent = m || ''; };
  if (!em) return err('Email bharo');
  if (!mob) return err('Registered mobile number bharo');
  if (n1.length < 6) return err('Naya password kam se kam 6 character ka ho');
  if (n1 !== n2) return err('Dono password match nahi kar rahe');
  err('Check ho raha hai…');
  Api.post({ action:'setpwd', email:em, mode:'forgot', mobile:mob, newPwd:n1 }).then(function (r) {
    if (!r || !r.ok) return err((r && r.error) || 'Reset nahi hua');
    var users = Auth.users().map(function (u) {
      if (String(u.Email).toLowerCase() === em) { u.Password = n1; u.PwdChanged = true; } return u; });
    Store.set(K.users, users);
    window.__closeForgot();
    if ($('gate_email')) $('gate_email').value = em;
    if ($('gate_pwd')) $('gate_pwd').value = n1;
    toast('Password reset ho gaya — ab login karo');
  }).catch(function () { err('Network error — dobara try karo'); });
};

/* The gate's language dropdown is kept (same markup) but this build ships Hinglish only —
   the choice is remembered so a future translation layer can pick it up. */
window.__setUiLang = function (v) { Store.set('g2_lang', v || 'en'); };
window.__getUiLang = function () { return Store.get('g2_lang', 'en'); };

/* ═══════════════ PREVIEW (admin walks the salesman flow) ═══════════════ */
var Preview = {
  on:false, real:null,
  start: function (code) {
    var e = DB.emp(code); if (!e) return toast('Employee nahi mila');
    Preview.real = DB.me;
    Preview.on = true;
    /* Master_Employees carries no bypass flag — it lives on the LoginConfig row, which an admin has.
       Without this the preview would show locked gates for a rep whose gates are actually open. */
    var lc = (DB.m.LoginConfig || []).filter(function (x) {
      return String(x.Code).toUpperCase() === String(e.Code).toUpperCase(); })[0] || {};
    DB.me = { code:e.Code, name:e.Name, rights:'Employee', hq:e.HQ, zone:e.Zone, desig:e.Designation,
      doj:toISO(e.DateofJoining), bypass:Admin.isBypass(lc), bypassBy:lc.BypassBy || '',
      bypassNote:lc.BypassNote || '' };
    Preview.reset();
    document.body.classList.add('prev');
    Nav.build(); Router.go('home');
    /* pull fresh so "beech din ka scene" is genuinely current, not whatever was cached */
    Sync.now(false);
    toast(' Preview: ' + e.Name + ' \u2014 unka aaj ka live status. Kuch bhi save nahi hoga.', 3600);
  },
  /* the admin's own half-filled screens must not bleed into the rep's view */
  reset: function () {
    Field.store = null; Field.lines = []; Field.mode = 'order'; Field.ns = { front:'', inside:'' };
    Posm.store = null; Posm.ans = null; Posm.date = ''; Posm.need = 'Yes';
    Sec.edit = null; Sec.addPo = ''; Sec.addQ = '';
    Pjp.month = ''; Pjp.days = null; Pjp.loadedKey = ''; Pjp.hydratedAt = 0; Pjp._dirty = false;
    Appr.open = {}; Appr.filter = 'all'; Appr.kindF = 'all';
    Cam.clear();
    Flush.clear();                       /* nothing of the admin's is pending a save */
  },
  stop: function () {
    DB.me = Preview.real; Preview.on = false;
    Preview.reset();
    document.body.classList.remove('prev');
    Nav.build(); Router.go('admin'); toast('Preview band');
  }
};

/* ═══════════════ BYPASS — per-user relaxation, granted by an Admin/HOD ═══════════════
   Some reps genuinely cannot complete the full flow: a dead camera, a store that refuses photos, a
   rep who joined mid-cycle with no approved PJP yet. Rather than loosening the rules for everyone,
   an Admin/HOD switches it ON for that ONE user in Admin → Users.

   WAIVED (and this list is shown in the UI, so nobody has to guess):
     • photos stop being compulsory, and gallery upload is allowed where only the live camera was
     • the tab sequence PJP → Plan → Notify → Field stops blocking
     • a PJP can be submitted with days still empty, and outside the 27–1 window
   NEVER WAIVED: the data itself (store, distributor, town/beat, order status, remarks), the
   Master_* read-only rule, and the one-request guards — those stop duplicates, not effort.

   The server decides: the flag arrives on `me` from the pull (and on the login row), so a device
   cannot grant itself anything. */
var Bypass = {
  /* per user, or for the whole team from the console's Users tab */
  on: function () {
    if (/^(yes|true|1)$/i.test(String(DB.cfg('Global_Bypass', '') || ''))) return true;
    return !!(DB.me && DB.me.bypass);
  },
  by: function () { return (DB.me && DB.me.bypassBy) || ''; },
  note: function () { return (DB.me && DB.me.bypassNote) || ''; },
  /* what it waives, in the rep's language — used by the Home strip and the admin's confirm dialog */
  WAIVES:['Photo compulsory nahi rahegi (gallery se bhi chalega)',
          'Tab ka order (PJP → Plan → Notify → Field) nahi rokega',
          'PJP adhoora bhi bhej sakte ho, window ke bahar bhi'],
  strip: function () {
    if (!Bypass.on()) return '';
    return '<div class="strip w"><span class="g"></span><div class="m"><b>Bypass ON</b>' +
      '<i>· photo aur tab-order optional hain' + (Bypass.by() ? ' · ' + esc(Bypass.by()) : '') +
      (Bypass.note() ? ' · ' + esc(Bypass.note()) : '') + '</i></div>' +
      '<button class="btn ghost" onclick="Bypass.info()">Kya kya?</button></div>';
  },
  info: function () {
    UI.alert({ icon:'', title:'Bypass ON hai',
      msg:'Aapke liye ye restrictions hata di gayi hain:<br>• ' + Bypass.WAIVES.join('<br>• ') +
          '<br><br>Baaki sab wahi hai — store, distributor, town/beat, order status aur remarks ' +
          'bharna zaroori hai.' + (Bypass.by() ? '<br><br><b>Kisne di:</b> ' + esc(Bypass.by()) : '') +
          (Bypass.note() ? '<br><b>Reason:</b> ' + esc(Bypass.note()) : '') });
  }
};

/* ═══════════════ WORKFLOW GATE ═══════════════ */
var Gate = {
  /* 0 base · 1 PJP ok → Plan · 2 plan saved+notified → Field · 3 field activity → SEC/POSM/EOD */
  level: function () {
    if (Auth.isAdmin()) return 3;
    var code = DB.me.code, t = today();
    var pjp = DB.pjpMonth(code, t.slice(0, 7)).length > 0 ||
              DB.mine('PjpDraft').some(function (d) { return /approved/i.test(d.Status || ''); });
    if (!pjp) return 0;
    var plan = DB.find('DayPlan', code + '_' + t);
    if (!plan || !plan.PlanAt) return 1;
    if (!plan.NotifiedAt) return 1;
    var act = DB.mine('SecOrders').some(function (r) { return toISO(r.Date) === t; }) ||
              DB.mine('NewStores').some(function (r) { return toISO(r.Date) === t; }) ||
              DB.mine('PosmAudit').some(function (r) { return toISO(r.Date) === t; }) ||
              DB.mine('PosmRequirement').some(function (r) { return toISO(r.Date) === t; });
    return act ? 3 : 2;
  },
  /* Where does my newest PJP submission stand? The gate only unlocks Plan once an APPROVED plan
     exists for TODAY's month, so a rep with a pending submission was being told "PJP banao" —
     which reads as "your work is gone". This lets the messaging say what is actually happening. */
  pjpState: function () {
    var mine = DB.mine('PjpDraft').slice().sort(function (a, b) { return (+b.UpdatedAt || 0) - (+a.UpdatedAt || 0); });
    if (!mine.length) return { s:'none' };
    return { s:Appr.norm(mine[0].Status), month:mine[0].Month, row:mine[0] };
  },
  allowed: function (v) {
    /* the console's own screens, checked BEFORE bypass: a bypassed rep is excused the sequence, not
       promoted. An admin in the middle of a preview counts as an admin here — that back tab is his
       only way out. */
    if (Admin.ROUTE[v]) return Auth.isAdmin() || !!Preview.real;
    if (Auth.isAdmin()) return true;
    if (Bypass.on()) return true;                  /* the sequence is one of the waived rules */
    var l = Gate.level();
    if (v === 'plan')  return l >= 1;
    /* same exception as the shelf below: an order that exists can always be adjusted */
    if (v === 'field') return !!Field.editPo || (Gate.fieldDay() && l >= 2);
    /* the shelf is part of the visit — except when Sec order sent the rep back to add a product to an
       order that ALREADY exists: that day's sequence is history, and refusing him there would leave the
       adjustment impossible */
    if (v === 'stk') return !!Field.editPo || (Gate.fieldDay() && l >= 2);
    /* a travel claim is about days ALREADY worked, so it is never gated on today's plan */
    if (v === 'tada') return true;
    /* nor is downloading what he has already done */
    if (v === 'mydata') return true;
    if (v === 'sec' || v === 'posm') return Gate.fieldDay() && l >= 3;
    /* ── closing a day that never had a beat in it ──
       Level 3 means "a store was saved today", which a Meeting / Leave / Weekly Off / Holiday day can
       never reach — so gating EOD on it used to lock those days out of being closed at all. On a
       non-field day the saved-and-notified plan IS the whole day, so EOD opens straight off it. */
    if (v === 'eod') return Gate.fieldDay() ? l >= 3 : l >= 2;
    /* adjusting an order that already exists is not part of today's sequence — a rep gets that call
       whether or not he has punched anything since */
    if (v === 'fin') return true;
    /* PJP is a once-a-month job, and the WINDOW is the rule — not merely "is something approved".
       That distinction only shows up when data is removed: deleting a rep's plan on the 3rd used to
       swing the tab open again (nothing approved → open), which quietly reopened a deadline that had
       passed on the 1st. So, in order:
         · an admin's per-user switch, then the team-wide one, win outright;
         · inside the window (27th–1st) it is his job — open, unless that month is already approved;
         · outside it: open only while a submission is still in flight (the HOD owes a decision, or
           sent days back to be fixed), or for somebody who JOINED after the window shut and never had
           one. Nothing there at all — never started, or removed by an admin — stays shut, and an
           admin re-opens it from Users. */
    if (v === 'pjp') {
      var f = String((DB.me && DB.me.pjpOpen) || '') || String(DB.cfg('Global_PjpOpen', '') || '');
      if (/^yes$/i.test(f)) return true;
      if (/^no$/i.test(f)) return false;
      var wm = Pjp.winMonth();
      if (Pjp.approvedFor(wm)) return false;
      if (Pjp.winOpen()) return true;
      var ps2 = Gate.pjpState();
      if (ps2.month === wm && /pending|rejected|partial/.test(String(ps2.s))) return true;
      var doj2 = DB.doj(DB.me.code);
      if (doj2 && doj2 > Pjp.winShut()) return true;
      return false;
    }
    return true;
  },
  /* ── is today a day spent on a beat? ──
     Self Working / ME Sales Team / BA Supervisor are; Meeting / Activity, Leave, Sick Leave, Weekly
     Off and HO Holiday are not. The day's own saved plan decides it, falling back to what the approved
     master says before a plan exists. */
  fieldDay: function () {
    var r = DB.find('DayPlan', (DB.me.code || '') + '_' + today()) || {};
    var pjp = DB.pjpFor(DB.me.code, today());
    return Pjp.isField(Pjp.ww(r.WorkingWith || (pjp ? pjp.Ww : '') || 'Self Working'));
  },
  why: function (v) {
    var l = Gate.level();
    /* the day itself has no store visit in it — say so, and say the one way to change that, instead of
       repeating a sequence message the rep can never satisfy today */
    if (!Gate.fieldDay() && ['field', 'stk', 'sec', 'posm'].indexOf(v) >= 0 && !Field.editPo)
      return 'Aaj field day nahi hai (' + Pjp.ww(Plan.ww()) + ') — Field band hai. Kaam karna ho to ' +
             'Plan tab me Change PJP karo; warna sidha EOD save karke din close kar do.';
    if (v === 'plan' && l < 1) {
      var ps = Gate.pjpState();
      if (ps.s === 'pending') return 'PJP HOD ke paas hai (' + (monthName(ps.month) || ps.month) +
        ') — approve hone ke baad Plan khulega. Aapka bhara hua plan safe hai.';
      if (ps.s === 'rejected') return 'PJP reject hua — PJP tab me reason dekho aur dobara bhejo';
      return 'Pehle is month ka PJP banao aur HOD se approve karwao';
    }
    if (v === 'pjp') {
      var wm2 = Pjp.winMonth();
      if (Pjp.approvedFor(wm2))
        return monthName(wm2) + ' ka PJP approve ho gaya — agli PJP 27 tarikh se khulegi';
      if (/^no$/i.test(String((DB.me && DB.me.pjpOpen) || '')))
        return 'Admin ne aapka PJP band kar rakha hai — unse baat karo';
      /* the window shut and there is nothing here: this is what a removed plan looks like */
      return monthName(wm2) + ' ka PJP window ' + dmy(Pjp.winShut()) +
        ' ko band ho gaya — admin se khulwao';
    }
    if (v === 'field' && l < 2) {
      var p = DB.find('DayPlan', DB.me.code + '_' + today());
      if (p && p.PlanAt && !p.NotifiedAt) return 'Plan HOD ko bhejo (Notify) — tabhi Field khulega';
      return 'Pehle aaj ka Plan save karo';
    }
    if (l < 3) return 'Pehle Field me ek store ka kaam save karo';
    return 'Locked';
  },
  /* day lock — set on EOD save / Close Day, and always escapable */
  /* While previewing, the lock has to come from the REP's data — the admin's own localStorage lock
     says nothing about the rep's day. An Eod row for today is the durable "day closed" signal. */
  locked: function () {
    if (Preview.on) {
      var e = DB.find('Eod', (DB.me.code || '') + '_' + today());
      return !!(e && (e.ClosedAt || e.Ts || e.Sc !== undefined));
    }
    return Store.get(K.lock, {}).date === today();
  },
  lock: function (src) { Store.set(K.lock, { date:today(), at:new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }), src:src }); },
  unlock: function () { Store.del(K.lock); }
};

/* ═══════════════ NAV + ROUTER ═══════════════ */
/* Home carries the whole analysis: Dashboard / Calls & stores / Order vs delivery / Team, all of it
   period-switchable. The month roll-up that used to be its own tab lives inside it now. */
var TABS = [
  { v:'pjp',   g:'', t:'PJP' },
  { v:'home',  g:'', t:'Summary' },
  { v:'plan',  g:'', t:'Plan' },
  { v:'field', g:'', t:'Field' },
  { v:'stk',   g:'', t:'Stock' },
  /* 'sec' (the old "Orders" tab) is gone: the same orders are adjusted in Sec order and chased in
     Tracker, and its one unique table — the distributor's primary-order shortfall — is now a
     "Primary Order" tab in the EOD workbook. The route and module stay so old links still land. */
  { v:'fin',   g:'', t:'Sec order' },
  { v:'posm',  g:'', t:'POSM' },
  { v:'eod',   g:'', t:'EOD' },
  { v:'tada',  g:'', t:'TA/DA' },
  { v:'mydata', g:'', t:'My data' }
  /* Tracker and Approvals are VIEWS of the Summary screen now, not tabs of their own — they are both
     "where does my stuff stand", which is what Summary is for. Router.go still accepts 'trk' and 'appr'
     and lands on the right view, so every existing link into them keeps working. */
];
/* An admin/HOD does not punch orders — their bar IS the console. There is no "Console" tab any
   more and no chip strip inside it: the five screens are five real tabs, one tap each.
     admin  Summary · appr Approvals · ausers Users · adata Data · aprev Preview
   'admin' stays the id of the Summary screen so every existing link into the console still lands
   somewhere sensible.
   The full salesman strip appears only while previewing a rep, which is exactly when it is useful. */
var ADMIN_TABS = [
  { v:'admin',  g:'', t:'Summary' },
  { v:'appr',   g:'', t:'Approvals' },
  { v:'ausers', g:'', t:'Users' },
  { v:'adata',  g:'', t:'Data' },
  { v:'aprev',  g:'', t:'Preview' }
];
var Nav = {
  hidden:[],
  /* Red count = "something is waiting for YOU", WhatsApp style.
       Admin / HOD → PJPs and plan changes pending their decision.
       Employee    → their own requests that came back REJECTED, i.e. they must redo something.
     A rep's own PENDING request gets no badge: waiting is not a task. */
  badge: function (v) {
    /* ONE tab carries the number: Approvals for an Admin/HOD, and Summary for a salesman — because
       that is where his Approvals view now lives, and a badge on a tab that no longer exists is a
       badge nobody ever sees. */
    if (v !== (Auth.isAdmin() ? 'appr' : 'home')) return 0;
    var c = Nav.counts();
    /* a rep's Summary tab carries BOTH the things waiting for him: what came back rejected, and
       whatever the Notification centre is holding unread. They live one chip apart on the same
       screen, so two separate red numbers on one tab would only ever confuse. */
    return Auth.isAdmin() ? c.appr : c.appr + c.notif;
  },
  /* Counted from Appr.list() itself — the SAME list the Approvals screen shows — so the red number can
     never disagree with the queue. It covers PJP, plan changes and TA/DA; orders are excluded because
     they are a status change, not a decision, and new outlets / POSM requirements are not approvals
     at all any more — they live in the rep's own Tracker tab.
     Cached per render pass: Nav.build asks for it several times. */
  _c:null, _cAt:0,
  counts: function () {
    if (Nav._c && Date.now() - Nav._cAt < 400) return Nav._c;
    var out = { admin:0, appr:0, notif:0 };
    try {
      var list = Appr.list();
      if (Auth.isAdmin()) {
        out.admin = out.appr = list.filter(function (o) { return Appr.can(o); }).length;
      } else {
        /* a rep is nudged about what needs REDOING, not about waiting */
        out.appr = list.filter(function (o) {
          return o.status === 'rejected' || o.status === 'partial'; }).length;
        out.notif = Notif.unread();
      }
    } catch (e) {}
    Nav._c = out; Nav._cAt = Date.now();
    return out;
  },
  pill: function (n) { return n ? '<span class="badge">' + (n > 99 ? '99+' : n) + '</span>' : ''; },
  /* a tab that needs attention RIGHT NOW gets a dot: the PJP window is open and the plan is not
     approved yet, which is a deadline the rep cannot see anywhere else */
  hot: function (v) {
    if (v !== 'pjp' || Auth.isAdmin()) return false;
    try { return Pjp.winOpen() && !Pjp.approvedFor(Pjp.winMonth()); } catch (e) { return false; }
  },
  build: function () {
    var list = Auth.isAdmin() ? ADMIN_TABS.slice()
             : (Preview.on ? [{ v:'admin', g:'', t:'Admin' }].concat(TABS) : TABS.slice());
    /* ── every tab is on the bar ──
       Nothing hides behind "More" any more: the strip slides. Nav.after scrolls the current tab into
       view after every render, and an arrow on the edge says there is more that way — a rep should
       never have to know a tab exists to find it. */
    Nav.hidden = [];
    var el = $('nav');
    /* the nav paints itself, so it has to translate itself — its labels are the most visible words
       in the app and they were staying English in every language */
    el.innerHTML = I18n.tr(list.map(function (x) {
      return '<button data-v="' + x.v + '" onclick="Router.go(\'' + x.v + '\')" class="' +
        (x.v === Router.cur ? 'on' : '') + (Gate.allowed(x.v) ? '' : ' lk') + (Nav.hot(x.v) ? ' hot' : '') + '">' +
        '<span class="g">' + x.g + '</span><span>' + x.t + '</span>' + Nav.pill(Nav.badge(x.v)) + '</button>';
    }).join(''));
    /* when they all fit, spread them out as before */
    el.classList.toggle('fit', el.scrollWidth <= el.clientWidth + 2);
    Nav.after();
  },
  /* keep the current tab visible, and say which way the rest of them are.
     Only ever re-centre when the TAB CHANGED: the nav is rebuilt on every background sync too, and
     re-centring there would drag the strip back under the thumb of someone who had just slid it. */
  _on:'',
  after: function () {
    var el = $('nav'); if (!el) return;
    var on = el.querySelector('button.on');
    if (on && Nav._on !== Router.cur) {
      Nav._on = Router.cur;
      var max = el.scrollWidth - el.clientWidth;
      var want = on.offsetLeft - (el.clientWidth - on.offsetWidth) / 2;
      el.scrollLeft = Math.max(0, Math.min(max, want));
    }
    Nav.arrows();
  },
  arrows: function () {
    var el = $('nav'), l = $('nav_l'), r = $('nav_r');
    if (!el || !l || !r) return;
    var max = el.scrollWidth - el.clientWidth;
    l.classList.toggle('on', max > 4 && el.scrollLeft > 4);
    r.classList.toggle('on', max > 4 && el.scrollLeft < max - 4);
  },
  /* ── the desktop side panel folds away ──
     Remembered, so a wide screen opens the way it was left. On a phone the class does nothing: the
     rules that read it live inside the ≥900px block. */
  fold: function (on) {
    var next = on === undefined ? !document.body.classList.contains('navoff') : !!on;
    document.body.classList.toggle('navoff', next);
    try { Store.set(K.navoff, next ? '1' : ''); } catch (e) {}
    Nav.arrows();
  },
  restore: function () {
    try { if (Store.get(K.navoff) === '1') document.body.classList.add('navoff'); } catch (e) {}
  },
  slide: function (dir) {
    var el = $('nav'); if (!el) return;
    /* the strip scrolls smoothly, so scrollLeft only reaches its target a few frames later. The
       onscroll handler keeps the arrows honest while it moves; this is the settle-time fallback. */
    el.scrollLeft += dir * Math.max(160, el.clientWidth * 0.6);
    setTimeout(Nav.arrows, 700);
  },
  more: function () {
    var rest = (Nav.hidden && Nav.hidden.length ? Nav.hidden : TABS.slice(5)).slice();
    UI.sheet('Aur options', rest.map(function (x) {
      var n = Nav.badge(x.v);
      return '<button class="btn ghost" style="margin-bottom:8px;position:relative" onclick="UI.close();Router.go(\'' + x.v + '\')">' +
        x.g + ' ' + x.t + (n ? ' <span class="badge" style="position:static;margin-left:6px;box-shadow:none">' +
          (n > 99 ? '99+' : n) + '</span>' : '') + '</button>'; }).join('') +
      '<button class="btn ghost" onclick="UI.close();Auth.logout()"> Logout</button>');
  }
};
var Router = {
  cur:'home',
  go: function (v) {
    if (v === 'more') return Nav.more();
    /* ── Tracker and Approvals live inside Summary for a salesman ──
       Accepted here rather than rewritten at every call site, so the dozen existing buttons that say
       Router.go('appr') / Router.go('trk') still land exactly where the reader expects. An Admin/HOD
       keeps Approvals as a top-level tab: deciding requests IS their job, not a sub-view of a summary. */
    /* the Notification centre is a REP's screen — it is built out of his own stuck work. An
       Admin/HOD asking for it lands on Approvals, which is already their whole-team feed. */
    if (v === 'notif' && Auth.isAdmin()) v = 'appr';
    if ((v === 'trk' || v === 'appr' || v === 'notif') && !Auth.isAdmin()) { Home.view = v; v = 'home'; }
    Flush.all();                                   /* leaving a tab = save it */
    Flush.clear();
    if (!Gate.allowed(v)) { toast(Gate.why(v)); return; }
    Router.cur = v;
    DB.maybe();                                    /* sheet may have changed */
    render();
    Nav.build();
    window.scrollTo(0, 0);
  }
};
function render() {
  /* ── a re-render must NOT move the page ──
     Almost every action ends in render(): ticking a checkbox, changing a status, saving a note. The
     screen is rebuilt from scratch, and the browser used to land the reader back at the top — so
     ticking day 25 of a 31-day list meant scrolling down again to tick day 26. The scroll position is
     restored right after the paint, while layout is still synchronous.
     A real tab change still starts at the top: Router.go scrolls AFTER calling render(). */
  var y = window.pageYOffset || document.documentElement.scrollTop || 0;
  var f = ({ home:Home, pjp:Pjp, plan:Plan, field:Field, stk:Stk, sec:Sec, fin:Fin, posm:Posm, trk:Trk,
             eod:Eod, tada:Tada, mydata:My, appr:Appr,
             /* the console's screens: one module, four routes (Admin.html reads Router.cur) */
             admin:Admin, ausers:Admin, adata:Admin, aprev:Admin })[Router.cur];
  /* first ever paint and the data is still on its way — show a skeleton, never blank cards */
  /* every screen leaves through here, so ONE call translates the whole app */
  if (f && !DB.pulledAt && Api.n > 0) { $('view').innerHTML = I18n.tr(UI.skel()); return; }
  if (f) { try { $('view').innerHTML = I18n.tr(f.html()); if (f.after) f.after(); } catch (e) { $('view').innerHTML =
    '<div class="card"><h3>! Screen error</h3><div class="sub">' + esc(e.message) + '</div></div>'; } }
  if (y > 0 && (window.pageYOffset || document.documentElement.scrollTop || 0) !== y) window.scrollTo(0, y);
}

/* ═══════════════ UI kit ═══════════════ */
var UI = {
  sheet: function (title, body) {
    $('sheet').innerHTML = I18n.tr('<div class="sheet" onclick="if(event.target===this)UI.close()"><div class="in">' +
      '<h3 style="margin-bottom:10px">' + esc(title) + '</h3>' + body + '</div></div>');
  },
  close: function () { $('sheet').innerHTML = ''; },

  /* ── proper in-app dialogs ────────────────────────────────────────────────
     Replaces window.confirm / prompt / alert, which render as an ugly browser bar saying
     "localhost says…" and cannot be styled or translated. These return a Promise, are keyboard
     friendly (Esc = cancel, Enter = confirm) and look like the rest of the app.
       UI.confirm({title, msg, ok, cancel, danger}) -> Promise<boolean>
       UI.prompt({title, msg, label, value, ok, required, multiline}) -> Promise<string|null>
       UI.alert({title, msg, ok}) -> Promise<void>                                            */
  _dlg:null,
  dialog: function (o) {
    UI.dismiss();
    return new Promise(function (resolve) {
      var wrap = document.createElement('div');
      wrap.className = 'modal';
      wrap.innerHTML = I18n.tr(
        '<div class="modal-card" role="dialog" aria-modal="true">' +
          (o.icon ? '<div class="modal-ic ' + (o.danger ? 'bad' : '') + '">' + o.icon + '</div>' : '') +
          '<h3 class="modal-t">' + esc(o.title || '') + '</h3>' +
          (o.msg ? '<div class="modal-m">' + o.msg + '</div>' : '') +
          (o.input ? '<label class="f">' + esc(o.label || '') + '</label>' +
            (o.multiline
              ? '<textarea class="in" id="dlg_in" rows="3" placeholder="' + esc(o.placeholder || '') + '">' + esc(o.value || '') + '</textarea>'
              : '<input class="in" id="dlg_in" placeholder="' + esc(o.placeholder || '') + '" value="' + esc(o.value || '') + '">') +
            '<div class="modal-err" id="dlg_err"></div>' : '') +
          '<div class="modal-btns">' +
            (o.cancel === false ? '' : '<button class="btn ghost" id="dlg_no">' + esc(o.cancel || 'Cancel') + '</button>') +
            '<button class="btn ' + (o.danger ? 'bad' : '') + '" id="dlg_yes">' + esc(o.ok || 'OK') + '</button>' +
          '</div>' +
        '</div>');
      document.body.appendChild(wrap);
      UI._dlg = wrap;
      var fin = function (v) {
        if (!UI._dlg) return;
        document.removeEventListener('keydown', onKey, true);
        wrap.classList.add('out');
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 130);
        UI._dlg = null;
        resolve(v);
      };
      var yes = function () {
        if (!o.input) { if (o.grab) o.grab(); return fin(true); }
        var v = String(($('dlg_in') || {}).value || '').trim();
        if (o.required && !v) { $('dlg_err').textContent = o.requiredMsg || 'Ye field bharna zaroori hai'; return; }
        /* a dialog can carry its own extra fields (the Change-PJP selects). They must be read while
           the dialog is still mounted — reading them from the .then() would race the close animation. */
        if (o.grab) o.grab();
        fin(v);
      };
      var onKey = function (e) {
        if (e.key === 'Escape') { e.preventDefault(); fin(o.input ? null : false); }
        else if (e.key === 'Enter' && (!o.multiline || e.ctrlKey || e.metaKey)) { e.preventDefault(); yes(); }
      };
      wrap.querySelector('#dlg_yes').onclick = yes;
      var no = wrap.querySelector('#dlg_no');
      if (no) no.onclick = function () { fin(o.input ? null : false); };
      wrap.onclick = function (e) { if (e.target === wrap) fin(o.input ? null : false); };
      document.addEventListener('keydown', onKey, true);
      setTimeout(function () {
        var el = $('dlg_in') || wrap.querySelector('#dlg_yes');
        if (el) { el.focus(); if (el.select && o.input) el.select(); }
      }, 60);
    });
  },
  dismiss: function () {
    if (UI._dlg && UI._dlg.parentNode) UI._dlg.parentNode.removeChild(UI._dlg);
    UI._dlg = null;
  },
  confirm: function (o) { return UI.dialog(Object.assign({ icon:'', ok:'Haan', cancel:'Nahi' }, o)); },
  prompt:  function (o) { return UI.dialog(Object.assign({ icon:'', input:true, ok:'Bhejo', cancel:'Cancel' }, o)); },
  alert:   function (o) { return UI.dialog(Object.assign({ icon:'ℹ', ok:'Theek hai', cancel:false }, o)); },
  profile: function () {
    var s = Auth.session();
    UI.sheet('Profile', '<div class="lrow"><div class="m"><div class="t">' + esc(s.name) + '</div>' +
      '<div class="s">' + esc(s.code) + ' · ' + esc(s.rights) + ' · ' + esc(s.hq || '') + '</div></div></div>' +
      '<div class="lrow"><div class="m"><div class="t">Date of Joining</div><div class="s">' + dmy(s.doj) + '</div></div></div>' +
      '<div class="lrow"><div class="m"><div class="t">Last sync</div><div class="s">' +
        (DB.pulledAt ? new Date(DB.pulledAt).toLocaleString('en-IN') : 'never') + '</div></div></div>' +
      '<div class="btns"><button class="btn ghost" onclick="UI.close();Sync.now(true)"> Sync now</button>' +
      '<button class="btn bad" onclick="Auth.logout()">Logout</button></div>');
  },
  head: function (icon, title, sub) {
    return '<div class="card"><h3>' + (icon ? '<span class="ic">' + icon + '</span>' : '') + esc(title) + '</h3>' +
      (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div>';
  },
  empty: function (g, m) { return '<div class="empty"><span class="g">' + g + '</span>' + esc(m) + '</div>'; },
  /* shown instead of empty cards while the very first pull is still running */
  skel: function (msg) {
    var card = '<div class="card"><div class="skel" style="width:38%"></div>' +
      '<div class="skel" style="width:72%;margin-top:11px"></div>' +
      '<div class="skel" style="width:56%;margin-top:8px"></div></div>';
    return '<div class="strip b"><span class="g"><span class="spin"></span></span>' +
      '<div class="m"><b>' + esc(msg || 'Data load ho raha hai…') + '</b> <i>· sheet se aa raha hai</i></div></div>' +
      card + card + card;
  },

  /* ══ MULTI-SELECT ══
     o.items  [[value, label, hint]]      o.sel   the chosen values
     o.tgl    'Admin.tglKind'  → called with one value          o.all 'Admin.allKinds' → (1|0)
     o.q / o.onQ  a search box, shown once the list is long     o.max  rows before it scrolls
     Ticks are 28px, the row is 40px: this is a list a thumb uses, not a mouse. */
  multi: function (o) {
    var sel = o.sel || [], items = o.items || [];
    var has = function (v) { return sel.indexOf(v) >= 0; };
    var q = String(o.q || '').trim().toUpperCase();
    var show = q ? items.filter(function (x) {
      return (String(x[1]) + ' ' + String(x[0]) + ' ' + String(x[2] || '')).toUpperCase().indexOf(q) >= 0;
    }) : items;
    var h = '<div class="lrow" style="padding:2px 0 6px"><div class="m">' +
      '<div class="t" style="font-size:12.5px">' + esc(o.label || 'Chuno') +
        (sel.length ? ' — ' + sel.length : '') + '</div>' +
      (o.sub ? '<div class="s">' + esc(o.sub) + '</div>' : '') + '</div>' +
      '<button class="btn ghost xs" style="flex:0 0 auto" onclick="' + o.all + '(1)">Sab</button>' +
      '<button class="btn ghost xs" style="flex:0 0 auto" onclick="' + o.all + '(0)">Clear</button></div>';
    if (o.onQ && items.length > 10)
      h += '<input class="in" placeholder="' + esc(o.qph || 'Dhoondo') + '" value="' + esc(o.q || '') +
        '" oninput="' + o.onQ + '(this.value)">' +
        '<div class="hint" style="margin:4px 0 2px">' + show.length + ' / ' + items.length + '</div>';
    h += '<div class="pane" style="max-height:' + (o.max || 210) + 'px;margin-top:4px">';
    h += show.length ? show.map(function (x) {
      return '<label class="mrow' + (has(x[0]) ? ' on' : '') + '">' +
        '<input type="checkbox"' + (has(x[0]) ? ' checked' : '') + ' onchange="' + o.tgl +
          '(\'' + Appr.q(x[0]) + '\')">' +
        '<span class="m"><span class="t">' + esc(x[1]) + '</span>' +
        (x[2] ? '<span class="s">' + esc(x[2]) + '</span>' : '') + '</span></label>';
    }).join('') : '<div class="hint" style="padding:8px 2px">Kuch nahi mila</div>';
    return h + '</div>';
  },
  kpi: function (v, l, cls) { return '<div class="kpi ' + (cls || '') + '"><b>' + v + '</b><span>' + esc(l) + '</span></div>'; }
};

/* ═══════════════ SYNC driver ═══════════════ */
var Sync = {
  /* The Sync button is an explicit "get me everything" — always a FULL pull, never the light one.
     It also has to LOOK like it is working: the button spins and disables itself for the duration,
     because with the light sync the round trip can be quick enough to leave no trace at all. */
  now: function (loud, el) {
    if (Sync.busy) { toast('Sync already chal raha hai'); return; }
    Sync.busy = true;
    var btn = el || $('tb_sync'), txt = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Sync…'; }
    syncChip('Sheet se sync ho raha hai…');
    var done = function (msg) {
      Sync.busy = false;
      if (btn) { btn.disabled = false; btn.innerHTML = txt; }
      if (msg) syncChip(msg);
    };
    return Flush.all().then(function () { return Queue.drain(); })
      .then(function () { return DB.pull(loud); })
      .then(function (r) {
        render(); Nav.build();
        done(r && r.ok ? 'Sheet se sync ho gaya' : '! Sync fail — offline data');
      })
      .catch(function () { done('! Sync fail — offline data'); });
  },
  busy:false,

  init: function () {
    /* the 3-minute background sync is transactional-only; it upgrades itself to a full pull the moment
       the sheet's fingerprint changes (see DB.pull), so nothing can drift */
    setInterval(function () { if (Api.online() && Auth.session()) { Queue.drain(); DB.pull(false, { txn:true }).then(function () {
      if (Router.cur === 'home' || Router.cur === 'admin') render(); }); } }, 180000);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') Flush.all();
      else if (Auth.session()) { Queue.drain(); DB.maybe(); }
    });
    window.addEventListener('online', function () { Queue.drain(); DB.maybe(); });
    window.addEventListener('beforeunload', function () { Flush.all(); });
    window.addEventListener('resize', function () { clearTimeout(Sync._r); Sync._r = setTimeout(Nav.build, 200); });
    Live.start();
  }
};

/* ═══════════════ LIVE — no reload, no Sync button ═══════════════
   An HOD approves a request on their phone; the rep should SEE it, not go looking for it. Every 25
   seconds (only while the tab is visible, only when online) the app asks the cheapest question in the
   API — `action=ver`, which reads no sheet at all, just Drive's modified time. If that number has not
   moved, nothing happens and nothing is downloaded. If it has, the app pulls and re-renders.
   That is how an approval lands on the rep's screen, and a new request on the HOD's, on its own.
   The poll is deliberately QUIET: no progress bar, no chip — the screen simply updates. */
var Live = {
  ms:25000, t:null, on:false,
  start: function () {
    if (Live.t) clearInterval(Live.t);
    Live.t = setInterval(Live.tick, Live.ms);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') Live.tick();     /* back on screen → check at once */
    });
  },
  /* returns a promise and records WHY it skipped — a poller you cannot observe is a poller you cannot
     debug when someone says "it didn't update" */
  last:'',
  tick: function () {
    var skip = Live.on ? 'busy' : !Auth.session() ? 'no-session' : !Api.online() ? 'offline'
             : document.visibilityState === 'hidden' ? 'hidden'      /* don't poll a backgrounded tab */
             : Sync.busy ? 'syncing' : Api.n > 0 ? 'request-in-flight' : '';
    Live.last = skip || 'checking';
    if (skip) return Promise.resolve(skip);
    Live.on = true;
    return Api.get({ action:'ver' }, true).then(function (r) {
      Live.on = false;
      if (!r || !r.ok || !r.mver) { Live.last = 'no-answer'; return 'no-answer'; }
      if (DB.mver && r.mver === DB.mver) { Live.last = 'unchanged'; return 'unchanged'; }
      var before = Live.snap();
      DB.mver = r.mver;
      Live.last = 'pulling';
      return DB.pull(false).then(function () {
        render(); Nav.build();
        Live.announce(before, Live.snap());
        Live.last = 'updated';
        return 'updated';
      });
    }).catch(function (e) { Live.on = false; Live.last = 'error'; return 'error'; });
  },
  /* what the user is waiting on, so the change can be announced instead of just appearing */
  snap: function () {
    var s = { pend:0, mine:{} };
    try {
      var list = Appr.list();
      if (Auth.isAdmin()) s.pend = list.filter(function (o) { return Appr.can(o); }).length;
      list.forEach(function (o) { s.mine[o.key] = o.status; });
    } catch (e) {}
    return s;
  },
  announce: function (a, b) {
    if (Auth.isAdmin()) {
      if (b.pend > a.pend) toast((b.pend - a.pend) + ' nayi request aayi hai — Approvals dekho', 4200);
      return;
    }
    /* a rep only cares about their OWN request changing state */
    var msg = '';
    Object.keys(b.mine).forEach(function (k) {
      if (a.mine[k] && a.mine[k] !== b.mine[k] && b.mine[k] !== 'pending')
        msg = b.mine[k] === 'approved' ? 'HOD ne approve kar diya — aage badho'
                                       : 'HOD ne reject kiya — Requests me reason dekho';
    });
    if (msg) toast(msg, 5000);
  }
};

/* ═══════════════ XLSX WRITER ═══════════════
   A real .xlsx — multiple tabs, frozen headers, auto-filters, column widths, number/currency formats
   and coloured header rows — written by hand in ~120 lines. No SheetJS, nothing from a CDN, so the
   app stays a single offline-capable file. An .xlsx is just a ZIP of XML parts; we store the entries
   uncompressed (these reports are tens of KB) which needs only a CRC32, no deflate. */
var Zip = {
  tbl:null,
  crc: function (u8) {
    if (!Zip.tbl) { var t = [], c, n, k;
      for (n = 0; n < 256; n++) { c = n; for (k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
      Zip.tbl = t; }
    var r = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) r = Zip.tbl[(r ^ u8[i]) & 0xFF] ^ (r >>> 8);
    return (r ^ 0xFFFFFFFF) >>> 0;
  },
  u16: function (a, v) { a.push(v & 255, (v >>> 8) & 255); },
  u32: function (a, v) { a.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); },
  make: function (files) {
    var loc = [], cen = [], off = 0, d = new Date();
    var tm = ((d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2)) & 0xFFFF;
    var dt = (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF;
    files.forEach(function (f) {
      var nm = new TextEncoder().encode(f.name), data = f.data, crc = Zip.crc(data);
      var h = []; Zip.u32(h, 0x04034b50); Zip.u16(h, 20); Zip.u16(h, 0x0800); Zip.u16(h, 0);
      Zip.u16(h, tm); Zip.u16(h, dt); Zip.u32(h, crc); Zip.u32(h, data.length); Zip.u32(h, data.length);
      Zip.u16(h, nm.length); Zip.u16(h, 0);
      var c = []; Zip.u32(c, 0x02014b50); Zip.u16(c, 20); Zip.u16(c, 20); Zip.u16(c, 0x0800); Zip.u16(c, 0);
      Zip.u16(c, tm); Zip.u16(c, dt); Zip.u32(c, crc); Zip.u32(c, data.length); Zip.u32(c, data.length);
      Zip.u16(c, nm.length); Zip.u16(c, 0); Zip.u16(c, 0); Zip.u16(c, 0); Zip.u16(c, 0);
      Zip.u32(c, 0); Zip.u32(c, off);
      loc.push(new Uint8Array(h), nm, data); cen.push(new Uint8Array(c), nm);
      off += h.length + nm.length + data.length;
    });
    var cs = 0; cen.forEach(function (x) { cs += x.length; });
    var e = []; Zip.u32(e, 0x06054b50); Zip.u16(e, 0); Zip.u16(e, 0);
    Zip.u16(e, files.length); Zip.u16(e, files.length); Zip.u32(e, cs); Zip.u32(e, off); Zip.u16(e, 0);
    var all = loc.concat(cen, [new Uint8Array(e)]), tot = 0;
    all.forEach(function (x) { tot += x.length; });
    var buf = new Uint8Array(tot), p = 0;
    all.forEach(function (x) { buf.set(x, p); p += x.length; });
    return buf;
  }
};

var Xl = {
  /* style ids — they line up with the <cellXfs> order below */
  S:{ T:1, H:2, L:3, txt:4, int:5, money:6, dec:7, pct:8, date:9,
      tot:10, totM:11, totI:12, totD:13, totP:14, good:15, warn:16, bad:17, sub:18, wrap:19,
      /* every second data row carries the band version of its own format, so a row reads straight
         across without losing its number formatting */
      bTxt:20, bInt:21, bMoney:22, bDec:23, bPct:24, bDate:25, bWrap:26, dtm:30,
      K:27, V:28, T2:29 },
  /* the band twin of a style — used on alternate rows */
  BAND:{ 0:20, 4:20, 5:21, 6:22, 7:23, 8:24, 9:25, 19:26 },
  band: function (c) {
    if (!c || typeof c !== 'object') return c;
    var b = Xl.BAND[c.s || 0];
    return b ? { v:c.v, k:c.k, f:c.f, s:b } : c;
  },

  /* cell builders */
  t: function (v, s) { return { v:v == null ? '' : String(v), k:'s', s:s || 0 }; },
  n: function (v, s) { return { v:num(v), k:'n', s:s === undefined ? Xl.S.int : s }; },
  m: function (v, s) { return Xl.n(v, s || Xl.S.money); },
  d2: function (v, s) { return Xl.n(v, s || Xl.S.dec); },
  p: function (v, s) { return Xl.n(v, s || Xl.S.pct); },              /* v = 0..1 */
  /* headers and section labels are app copy, so they follow the chosen language too */
  h: function (v) { return Xl.t(I18n.s(v), Xl.S.H); },
  b: function (v) { return Xl.t(I18n.s(v), Xl.S.L); },
  dt: function (iso) {
    var s = toISO(iso); if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return Xl.t(s || '');
    var p2 = s.split('-'), ms = Date.UTC(+p2[0], +p2[1] - 1, +p2[2]);
    return { v:Math.round(ms / 864e5) + 25569, k:'n', s:Xl.S.date };  /* Excel serial */
  },
  /* a real date-TIME cell — the serial's FRACTION is the time of day. Built from LOCAL components on
     purpose: the rep saw 8:35 PM on their phone, so that is what the report has to say.
     Anything that is not a parseable moment is left as text rather than guessed at: the app also
     stores several time-ONLY strings ("08:35 PM" — PlanAt / NotifiedAt / ClosedAt), which have no
     date to anchor them, and a bare date is handed to Xl.dt so it does not render as "… 00:00". */
  dtm: function (v) {
    if (v == null || v === '') return Xl.t('');
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(v))) return Xl.dt(v);
    var d = (v instanceof Date) ? v : new Date(String(v));
    if (isNaN(d.getTime())) return Xl.t(String(v));
    var days = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5 + 25569;
    var frac = (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86400;
    return { v:days + frac, k:'n', s:Xl.S.dtm };
  },
  link: function (url, label) {
    if (!url) return Xl.t('');
    return { f:'HYPERLINK("' + String(url).replace(/"/g, '') + '","' + String(label || 'open').replace(/"/g, '') + '")',
             v:label || 'open', k:'s', s:Xl.S.txt };
  },

  esc: function (v) { return String(v == null ? '' : v)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  col: function (i) { var s = ''; i++; while (i > 0) { var r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - 1 - r) / 26; } return s; },
  /* how wide a column has to be to show what is IN it — a guessed width from the header alone is why
     store names used to sit under three hashes. Measured over the first 300 rows, clamped so one long
     remark cannot push the table off the page (it wraps instead). */
  widths: function (headers, rows, wrapAt) {
    return headers.map(function (h, i) {
      var w = String(h == null ? '' : h).length + 3;
      for (var r = 0; r < rows.length && r < 300; r++) {
        var c = rows[r][i];
        var v = c && typeof c === 'object' ? c.v : c;
        if (c && typeof c === 'object' && c.k === 'n' && c.s === Xl.S.date) v = 'dd-mm-yyyy';
        var n = String(v == null ? '' : v).length + 2;
        if (n > w) w = n;
      }
      return Math.min(wrapAt || 42, Math.max(9, w));
    });
  },

  cellXml: function (c, ref) {
    if (c === null || c === undefined || c === '') return '';
    if (typeof c === 'number') c = Xl.n(c);
    /* A BARE string in a row is always one of OUR labels — every piece of sheet data arrives wrapped by
       Xl.t / Xl.m / Xl.n. That separation is what makes it safe to translate here: the report follows
       the language the rep chose, and a store name or a remark is never touched. */
    else if (typeof c === 'string') c = Xl.t(I18n.s(c));
    var sa = c.s ? ' s="' + c.s + '"' : '';
    if (c.f) return '<c r="' + ref + '"' + sa + ' t="str"><f>' + Xl.esc(c.f) + '</f><v>' + Xl.esc(c.v) + '</v></c>';
    if (c.k === 'n') return '<c r="' + ref + '"' + sa + '><v>' + (isFinite(c.v) ? c.v : 0) + '</v></c>';
    return '<c r="' + ref + '"' + sa + ' t="inlineStr"><is><t xml:space="preserve">' + Xl.esc(c.v) + '</t></is></c>';
  },

  sheetXml: function (sh) {
    var x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">';
    /* sheetPr must come first, and it carries the tab colour + "fit to one page wide" */
    x += '<sheetPr><tabColor rgb="' + (sh.tab || 'FF1D4ED8') + '"/>' +
      '<pageSetUpPr fitToPage="1"/></sheetPr>';
    if (sh.freeze) x += '<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="' + sh.freeze +
      '" topLeftCell="A' + (sh.freeze + 1) + '" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>';
    else x += '<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>';
    x += '<sheetFormatPr defaultRowHeight="15"/>';
    if (sh.cols && sh.cols.length) x += '<cols>' + sh.cols.map(function (w, i) {
      return '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>'; }).join('') + '</cols>';
    x += '<sheetData>';
    (sh.rows || []).forEach(function (r, ri) {
      var ht = sh.rowH && sh.rowH[ri + 1] ? ' ht="' + sh.rowH[ri + 1] + '" customHeight="1"' : '';
      if (!r || !r.length) { x += '<row r="' + (ri + 1) + '"' + ht + '/>'; return; }
      x += '<row r="' + (ri + 1) + '"' + ht + '>';
      for (var ci = 0; ci < r.length; ci++) x += Xl.cellXml(r[ci], Xl.col(ci) + (ri + 1));
      x += '</row>';
    });
    x += '</sheetData>';
    if (sh.filter) x += '<autoFilter ref="' + sh.filter + '"/>';         /* must precede mergeCells */
    if (sh.merges && sh.merges.length) x += '<mergeCells count="' + sh.merges.length + '">' +
      sh.merges.map(function (m) { return '<mergeCell ref="' + m + '"/>'; }).join('') + '</mergeCells>';
    /* a report that prints badly is not finished: landscape, one page wide, a little margin */
    x += '<printOptions horizontalCentered="1"/>' +
      '<pageMargins left="0.4" right="0.4" top="0.6" bottom="0.5" header="0.3" footer="0.3"/>' +
      '<pageSetup orientation="' + (sh.portrait ? 'portrait' : 'landscape') +
      '" fitToWidth="1" fitToHeight="0" paperSize="9"/>';
    return x + '</worksheet>';
  },

  styles: function () {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;₹&quot;#,##0"/>' +
      '<numFmt numFmtId="165" formatCode="dd\\-mm\\-yyyy"/>' +
      /* 166: a real date-TIME, so "Billed at" sorts and filters as a moment instead of as text */
      '<numFmt numFmtId="166" formatCode="dd\\-mm\\-yyyy hh:mm"/></numFmts>' +
    '<fonts count="5">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="14"/><color rgb="FF1D4ED8"/><name val="Calibri"/></font>' +
      '<font><i/><sz val="9"/><color rgb="FF8890A6"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="10"/><color rgb="FF475069"/><name val="Calibri"/></font>' +        /* 5 label */
      '<font><b/><sz val="12"/><color rgb="FF1D4ED8"/><name val="Calibri"/></font></fonts>' +  /* 6 section */
    '<fills count="9">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF1D4ED8"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFEFF4FF"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFE8F7EF"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFDF6E7"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFFDEEEC"/><bgColor indexed="64"/></patternFill></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF7F9FD"/><bgColor indexed="64"/></patternFill></fill>' +   /* 7 band */
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF1F5FF"/><bgColor indexed="64"/></patternFill></fill></fills>' +  /* 8 title */
    '<borders count="3"><border/>' +
      '<border><top style="thin"><color rgb="FFB8C4DA"/></top></border>' +
      '<border><left style="thin"><color rgb="FFB8C4DA"/></left><right style="thin"><color rgb="FFB8C4DA"/></right>' +
        '<top style="thin"><color rgb="FFB8C4DA"/></top><bottom style="thin"><color rgb="FFB8C4DA"/></bottom></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="31">' +
      '<xf xfId="0"/>' +                                                                  /* 0 default */
      '<xf xfId="0" fontId="3" applyFont="1"/>' +                                          /* 1 title */
      '<xf xfId="0" fontId="2" fillId="2" borderId="2" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
        '<alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +            /* 2 header */
      '<xf xfId="0" fontId="1" applyFont="1"/>' +                                          /* 3 bold */
      '<xf xfId="0"/>' +                                                                   /* 4 text */
      '<xf xfId="0" numFmtId="3" applyNumberFormat="1"/>' +                                /* 5 #,##0 */
      '<xf xfId="0" numFmtId="164" applyNumberFormat="1"/>' +                              /* 6 money */
      '<xf xfId="0" numFmtId="2" applyNumberFormat="1"/>' +                                /* 7 0.00 */
      '<xf xfId="0" numFmtId="9" applyNumberFormat="1"/>' +                                /* 8 0% */
      '<xf xfId="0" numFmtId="165" applyNumberFormat="1"/>' +                              /* 9 date */
      '<xf xfId="0" fontId="1" fillId="3" borderId="1" applyFont="1" applyFill="1" applyBorder="1"/>' +      /* 10 total */
      '<xf xfId="0" fontId="1" fillId="3" borderId="1" numFmtId="164" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fontId="1" fillId="3" borderId="1" numFmtId="3" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fontId="1" fillId="3" borderId="1" numFmtId="2" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fontId="1" fillId="3" borderId="1" numFmtId="9" applyFont="1" applyFill="1" applyBorder="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fillId="4" applyFill="1"/>' +                                          /* 15 good */
      '<xf xfId="0" fillId="5" applyFill="1"/>' +                                          /* 16 warn */
      '<xf xfId="0" fillId="6" applyFill="1"/>' +                                          /* 17 bad  */
      '<xf xfId="0" fontId="4" applyFont="1"/>' +                                          /* 18 sub  */
      '<xf xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +    /* 19 wrap */
      /* 20–26: the same again on the band fill */
      '<xf xfId="0" fillId="7" applyFill="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf xfId="0" fillId="7" numFmtId="3" applyFill="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fillId="7" numFmtId="164" applyFill="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fillId="7" numFmtId="2" applyFill="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fillId="7" numFmtId="9" applyFill="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fillId="7" numFmtId="165" applyFill="1" applyNumberFormat="1"/>' +
      '<xf xfId="0" fillId="7" applyFill="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>' +
      /* 27 key label · 28 value · 29 section heading */
      '<xf xfId="0" fontId="5" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>' +
      '<xf xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>' +
      '<xf xfId="0" fontId="6" fillId="8" applyFont="1" applyFill="1" applyAlignment="1">' +
        '<alignment vertical="center"/></xf>' +
      /* 30 date-time */
      '<xf xfId="0" numFmtId="166" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
  },

  /* sheets = [{ name, cols, freeze, filter, merges, rows }] */
  /* `opt.blob` hands the workbook back as base64 (and skips the download) so it can be attached to a
     mail. Everything else about the file is identical - one builder, one workbook. */
  save: function (file, sheets, opt) {
    opt = opt || {};
    sheets = sheets.filter(Boolean);
    var enc = function (s) { return new TextEncoder().encode(s); };
    var names = {}, safe = sheets.map(function (sh, i) {
      var n = String(sh.name || ('Sheet' + (i + 1))).replace(/[\\\/\?\*\[\]:]/g, ' ').slice(0, 31) || ('Sheet' + (i + 1));
      while (names[n.toLowerCase()]) n = n.slice(0, 28) + '_' + (i + 1);
      names[n.toLowerCase()] = 1; return n;
    });
    var files = [
      { name:'[Content_Types].xml', data:enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
          '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') +
        '</Types>') },
      { name:'_rels/.rels', data:enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>') },
      { name:'xl/workbook.xml', data:enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        safe.map(function (n, i) { return '<sheet name="' + Xl.esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') +
        '</sheets></workbook>') },
      { name:'xl/_rels/workbook.xml.rels', data:enc('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') +
        '<Relationship Id="rId' + (sheets.length + 1) +
          '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
        '</Relationships>') },
      { name:'xl/styles.xml', data:enc(Xl.styles()) }
    ];
    sheets.forEach(function (sh, i) { files.push({ name:'xl/worksheets/sheet' + (i + 1) + '.xml', data:enc(Xl.sheetXml(sh)) }); });

    var TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    var blob = new Blob([Zip.make(files)], { type:TYPE });
    if (opt.blob) return new Promise(function (res, rej) {
      var fr = new FileReader();
      fr.onload = function () {
        var d = String(fr.result || ''), c = d.indexOf(',');
        res({ name:file + '.xlsx', type:TYPE, data:c >= 0 ? d.slice(c + 1) : d });
      };
      fr.onerror = function () { rej(new Error('read fail')); };
      fr.readAsDataURL(blob);
    });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = file + '.xlsx';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('' + file + '.xlsx — ' + sheets.length + ' tab download ho gaye', 3400);
  },

  /* a formatted block: title row, header row, data rows, optional total row */
  table: function (head, rows, opt) {
    opt = opt || {};
    var out = [head.map(Xl.h)];
    rows.forEach(function (r) { out.push(r); });
    if (opt.total) out.push(opt.total);
    return out;
  }
};

/* ═══════════════ SHARE / EXPORT ═══════════════ */
var Share = {
  wa: function (text) { window.open('https://wa.me/?text=' + encodeURIComponent(text), '_blank'); },
  mail: function (subject, text, to) {
    window.open('https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(to || '') +
      '&su=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(text), '_blank');
  },
  csv: function (name, rows) {
    var c = rows.map(function (r) { return r.map(function (x) {
      x = String(x == null ? '' : x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(','); }).join('\n');
    var b = new Blob(['﻿' + c], { type:'text/csv;charset=utf-8' });
    var a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
    toast('' + name + '.csv download ho gaya');
  }
};

/* ═══════════════ TODAY-PLAN CARD (the morning WhatsApp image) ═══════════════
   The rep's start-of-day message has to be a PICTURE in one fixed format: a picture cannot be edited
   on its way to the group, and the whole team already reads that layout. Drawn with the Canvas 2D
   API on purpose — html2canvas would be a ~200 KB CDN dependency inside a file that must keep
   working offline, and it renders differently on every browser. Here every pixel is ours.
   Design units are 520px wide; the PNG is 2x that (1040px), which is what WhatsApp shows sharp. */
var Card = {
  W:520, S:2, M:12, R:16,          /* canvas width, 2x scale, white margin, card corner radius */
  F:'"Segoe UI",Roboto,Arial,Helvetica,sans-serif',
  C:{ dark:'#0f2e1d', head2:'#cfe6d6', code:'#7a8b7e', meta:'#5a6b5e', ink:'#1a2b1e',
      tile:'#f0f6f1', line:'#e3ece5', row:'#eef2ee', band:'#edf5ef', green:'#2f7048',
      foot:'#8a9b8e', dash:'#cfe0d4', warnBg:'#fff6e6', warnInk:'#8a5a00' },
  _png:{},                         /* kind -> { key, blob, url } — warmed by the preview */
  /* Two cards, one drawing engine. The morning card is what the customer signed off on, so it keeps
     its own draw(); the EOD card reuses the header band, the name block and the row helpers so the
     two are visibly the same family of document. */
  KIND:{
    plan:{ data:'data',    draw:'draw',    sub:'Today Plan',       file:'plan',
           title:'Emerging Brand — Today Plan',  box:'pl_card' },
    eod: { data:'eodData', draw:'eodDraw', sub:'Day Report (EOD)', file:'eod',
           title:'Emerging Brand — Day Report',  box:'eod_card' }
  },

  /* ---------- helpers ---------- */
  fnt: function (g, w, s) { g.font = w + ' ' + s + 'px ' + Card.F; },
  rr: function (g, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  },
  /* wrap on words, and only split a token that cannot fit on a line by itself */
  wrap: function (g, s, max) {
    var words = String(s == null ? '' : s).split(/\s+/), out = [], cur = '';
    words.forEach(function (w) {
      var t = cur ? cur + ' ' + w : w;
      if (g.measureText(t).width <= max || !cur) {
        if (g.measureText(t).width > max && !cur) {                 /* one huge word */
          var part = '';
          for (var i = 0; i < w.length; i++) {
            if (g.measureText(part + w[i]).width > max && part) { out.push(part); part = ''; }
            part += w[i];
          }
          cur = part; return;
        }
        cur = t;
      } else { out.push(cur); cur = w; }
    });
    if (cur) out.push(cur);
    return out.length ? out : [''];
  },

  /* the HONASA wordmark already sits in the login gate as a data: URL, so drawing it never taints
     the canvas and needs no network */
  logo: function () {
    if (Card._logo !== undefined) return Promise.resolve(Card._logo);
    var el = document.querySelector('#login_gate .lg-toprow > div:first-child img') ||
             document.querySelector('#login_gate img');
    if (!el || !el.src) { Card._logo = null; return Promise.resolve(null); }
    if (el.complete && el.naturalWidth) { Card._logo = el; return Promise.resolve(el); }
    return new Promise(function (res) {
      var i = new Image();
      i.onload = function () { Card._logo = i; res(i); };
      i.onerror = function () { Card._logo = null; res(null); };
      i.src = el.src;
    });
  },

  /* ---------- what goes on the card ---------- */
  data: function () {
    var t = today(), r = Plan.row(), pjp = DB.pjpFor(DB.me.code, t), e = DB.emp(DB.me.code) || {};
    var s = Auth.session() || {};
    var dev0 = Plan.dev();          /* the day's own Change-PJP request, when there is one */
    var ww = r.WorkingWith || (pjp ? Pjp.ww(pjp.Ww) : 'Self Working');
    var fld = Pjp.isField(ww);
    var tg = Plan.tgt();
    var tdc = tg.slice(0, 6).reduce(function (a, x) { return a + x[1]; }, 0);
    var tot = tg.reduce(function (a, x) { return a + x[1]; }, 0);
    return {
      date:t, time:r.PlanAt || new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
      name:DB.me.name || s.name || '', code:DB.me.code || s.code || '',
      week:(r.Week || (pjp ? pjp.Week : '') || ''),
      zone:(e.Zone || s.zone || ''), hq:(e.HQ || s.hq || ''),
      /* the composed form — "With ME Sales Team — RAHUL", "Leave — medical · back at Monday".
         Translated HERE, not at paint time, so the width used for wrapping is the width of the text
         that actually gets drawn. */
      ww:I18n.s(Plan.wwFull(r) || ww), field:fld,
      /* an off day has no beat: showing the PJP's town next to "Leave" would be a lie */
      town:fld ? (r.Town || (pjp ? pjp.Town : '') || '—') : '—',
      beat:fld ? (r.Beat || (pjp ? pjp.Beat : '') || '—') : '—',
      state:fld ? (Plan.stateFor(r, pjp, r.Town || (pjp ? pjp.Town : '')) || '—') : '—',
      /* a sales focus means nothing on a day nobody is selling — shown only on a field day */
      focus:fld ? (r.Focus || (pjp ? pjp.Focus : '') || '') : '',
      offPjp:r.OffPjp ? (r.Approval || 'Pending') : '',
      /* ── an off-PJP day, spelled out ──
         "Off-PJP: Approved" on its own says a deviation happened but not what it was, so a manager
         reading the card on WhatsApp still had to ring up and ask. These are the same rows the Plan
         screen shows for the visit — where he actually is, and where the plan had said he would be. */
      offDet:r.OffPjp ? [
        ['State', Plan.stateFor(r, pjp, r.Town) || '—'],
        ['Town / City', r.Town || '—'],
        ['Beat / Market', r.Beat || '—'],
        ['Station', Pjp.stn(r.Station || (dev0 ? dev0.NewStation : ''))],
        ['PJP me tha', ((dev0 && dev0.PlannedTown) || (pjp ? pjp.Town : '') || '—') + ' / ' +
                       ((dev0 && dev0.PlannedBeat) || (pjp ? pjp.Beat : '') || '—')]
      ].concat(dev0 && dev0.Reason ? [['Reason', dev0.Reason]] : []) : [],
      /* an off day carries no counters — showing "7 SC Call" next to "aaj field day nahi" is the
         card contradicting itself */
      sc:fld ? (num(r.ScTarget) || num(DB.cfg('SC_Call_Target', 7)) || 7) : 0,
      nso:fld ? num(r.NsoTarget) : 0, posm:fld ? num(r.PosmTarget) : 0,
      rows:tg, tdc:tdc, tot:tot,
      mtd:num(DB.cfg('MTD @24 Days - Working', Math.round(tot * 24 * 100) / 100)),
      group:DB.cfg('Group_Name', 'Honasa Emerging Brands')
    };
  },

  /* the dark band with the logo, the company line and the date — identical on both cards */
  band: function (g, d, dry, sub, W, P, C, fill, put) {
    var hh = 68;
    fill(C.dark, 0, 0, W, hh);
    var lx = P;
    if (Card._logo) {
      var ih = 34, iwd = Math.round(ih * (Card._logo.naturalWidth || 476) / (Card._logo.naturalHeight || 133));
      var tw = iwd + 12, th = ih + 10;
      fill('#ffffff', P, (hh - th) / 2, tw, th, 8);
      if (!dry) g.drawImage(Card._logo, P + 6, (hh - ih) / 2, iwd, ih);
      lx = P + tw + 12;
    }
    Card.fnt(g, '800', 16);
    put('Honasa Consumer Limited', lx, 30, '#ffffff');
    Card.fnt(g, '800', 13.5);
    put('Emerging Brand · ' + sub, lx, 49, '#ffffff');
    Card.fnt(g, '800', 13);
    put(dmy(d.date), W - P, 28, '#ffffff', 'right');
    Card.fnt(g, '400', 11);
    put(d.time, W - P, 45, C.head2, 'right');
    return hh;
  },

  /* ---------- ONE draw routine, run twice ----------
     Pass 1 measures with dry=true (measureText still works, nothing is painted) so the canvas can be
     created at exactly the right height; pass 2 paints. One routine ⇒ the measured height and the
     painted height can never disagree. */
  draw: function (g, d, dry) {
    /* drawn from the CARD's own origin — png() translates by the white margin and clips the rounded
       corners, so the card can be a rounded panel without the maths knowing about it */
    var W = Card.W - Card.M * 2, P = 17, iw = W - P * 2, C = Card.C, y = 0;
    var fill = function (col, x, yy, w, h, r) {
      if (dry) return; g.fillStyle = col;
      if (r) { Card.rr(g, x, yy, w, h, r); g.fill(); } else g.fillRect(x, yy, w, h);
    };
    /* the card is an image, so its labels must be translated here too — measure and paint use the
       SAME translated text, or the two passes would disagree on the width */
    var put = function (s, x, yy, col, align) {
      if (dry) return; g.fillStyle = col; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic';
      g.fillText(I18n.s(String(s)), x, yy);
    };

    /* ── header band ── (shared with the EOD card, so the two look like one family) */
    y = Card.band(g, d, dry, 'Today Plan', W, P, C, fill, put) + 22;

    /* ── who / where ── */
    Card.fnt(g, '800', 19);
    put(d.name, P, y, C.dark);
    var nw = g.measureText(d.name).width;
    Card.fnt(g, '600', 13);
    put('(' + d.code + ')', P + nw + 7, y, C.code);
    y += 19;
    Card.fnt(g, '400', 12.5);
    put([dmy(d.date), d.week, (d.zone ? d.zone + ' / ' + d.hq : d.hq)].filter(Boolean).join(' · '), P, y, C.meta);
    y += 20;

    [['Working With: ', d.ww]]
      .concat(d.field ? [['State: ', d.state], ['Town/City: ', d.town], ['Beat/Market: ', d.beat]] : [])
      .concat(d.focus ? [['Focus: ', d.focus]] : [])
      .forEach(function (pair) {
        Card.fnt(g, '800', 13);
        var lw = g.measureText(pair[0]).width;
        put(pair[0], P, y, C.ink);
        Card.fnt(g, '400', 13);
        var lines = Card.wrap(g, pair[1], iw - lw);
        put(lines[0], P + lw, y, C.ink);
        for (var i = 1; i < lines.length; i++) { y += 18; put(lines[i], P, y, C.ink); }
        y += 22;
      });
    if (d.offPjp) {
      /* the heading, then the deviation itself line by line — a tinted box so a reader scanning the
         card sees at a glance that today is NOT the planned beat, and reads exactly where he is */
      var opad = 12, oaw = iw - opad * 2, olh = 17;
      /* measure every row first (a beat name or a reason can need two lines), then size the box to the
         total — the same measure-then-paint order the rest of this routine uses */
      var owrap = d.offDet.map(function (pr) {
        Card.fnt(g, '400', 12);
        var lw2 = g.measureText(pr[0] + ': ').width;
        return { lbl:pr[0] + ': ', lw:lw2, lines:Card.wrap(g, String(pr[1] == null ? '' : pr[1]), oaw - lw2) };
      });
      var oh = 23 + owrap.reduce(function (a, x) { return a + x.lines.length * olh; }, 0);
      fill(C.warnBg, P, y, iw, oh, 9);
      Card.fnt(g, '700', 12.5);
      put('Off-PJP: ' + d.offPjp, P + opad, y + 15, '#b4432f');
      var oy = y + 15;
      owrap.forEach(function (x) {
        oy += olh;
        Card.fnt(g, '700', 12);
        put(x.lbl, P + opad, oy, C.warnInk);
        Card.fnt(g, '400', 12);
        put(x.lines[0], P + opad + x.lw, oy, C.warnInk);
        for (var j = 1; j < x.lines.length; j++) { oy += olh; put(x.lines[j], P + opad, oy, C.warnInk); }
      });
      y += oh + 14;
    }

    /* ── the three counters ── */
    var th2 = 50, gap = 7, tw2 = (iw - gap * 2) / 3;
    [[d.sc, 'SC Call'], [d.nso, 'NSO'], [d.posm, 'Display MSL']].forEach(function (k, i) {
      var x = P + i * (tw2 + gap);
      fill(C.tile, x, y, tw2, th2, 9);
      Card.fnt(g, '800', 18);
      put(k[0], x + tw2 / 2, y + 25, C.dark, 'center');
      Card.fnt(g, '600', 10.5);
      put(k[1], x + tw2 / 2, y + 40, C.meta, 'center');
    });
    y += th2 + 22;

    /* ── the target block ── */
    if (d.field) {
      Card.fnt(g, '800', 13);
      put('Daily Order Target', P, y, C.dark);
      var hw = g.measureText('Daily Order Target').width;
      Card.fnt(g, '600', 11);
      put('(fixed · ₹L / Day)', P + hw + 6, y, C.code);
      y += 10;

      var top = y, x0 = P, bw = iw, ry = y;
      /* the box height is arithmetic, so the rounded clip can be set BEFORE the rows are painted —
         otherwise the dark TOTAL band and the green MTD band square off the bottom corners */
      var boxH = 6 * 24 + 26 + Math.max(0, d.rows.length - 6) * 26 + 30 + 30;
      if (!dry) { g.save(); Card.rr(g, x0, top, bw, boxH, 9); g.clip(); }
      var line = function (yy) { if (dry) return; g.strokeStyle = C.row; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x0, yy + .5); g.lineTo(x0 + bw, yy + .5); g.stroke(); };
      var row = function (label, val, o) {
        o = o || {};
        var h = o.h || 24;
        if (o.bg) fill(o.bg, x0, ry, bw, h);
        Card.fnt(g, o.lw || '400', o.fs || 12.5);
        put(label, x0 + 12, ry + h / 2 + 4.5, o.col || C.sub);
        Card.fnt(g, o.vw || '700', o.fs || 12.5);
        put(o.raw ? val : num(val).toFixed(2), x0 + bw - 12, ry + h / 2 + 4.5, o.col || C.sub, 'right');
        ry += h;
        if (!o.last) line(ry);
      };
      d.rows.forEach(function (x, i) {
        if (i < 6) row(x[0], x[1], { fs:12, vw:'500' });
        else row(x[0], x[1], { fs:13, lw:'600', col:C.ink, h:26 });
        if (i === 5) row('TDC — Total', d.tdc, { fs:13, lw:'800', vw:'800', col:C.dark, bg:C.band, h:26 });
      });
      row('TOTAL ORDER / DAY', d.tot, { fs:13.5, lw:'800', vw:'800', col:'#ffffff', bg:C.dark, h:30 });
      row('MTD @24 Working Days', d.mtd, { fs:13, lw:'800', vw:'800', col:'#ffffff', bg:C.green, h:30,
                                           raw:true, last:true });
      if (!dry) {
        g.restore();                                       /* end the rounded clip */
        g.strokeStyle = C.line; g.lineWidth = 1;
        Card.rr(g, x0 + .5, top + .5, bw - 1, (ry - top) - 1, 9); g.stroke();
      }
      y = ry + 16;
    } else {
      /* d.ww can carry the meeting type + duration + a hand-typed remark, which easily runs past
         one line — wrap it (and size the box to fit) instead of letting it run off the card. */
      var pad = 13, availW = iw - pad * 2, lh = 16;
      Card.fnt(g, '700', 13);
      var wLines = Card.wrap(g, 'Aaj field day nahi — ' + d.ww, availW);
      Card.fnt(g, '600', 11.5);
      var oLines = Card.wrap(g, 'Order target 0. SC / NSO / MSL bhi 0.', availW);
      var bh = 20 + (wLines.length + oLines.length - 1) * lh + 10;
      fill(C.warnBg, P, y, iw, bh, 9);
      var ty = y + 20;
      Card.fnt(g, '700', 13);
      wLines.forEach(function (ln) { put(ln, P + pad, ty, C.warnInk); ty += lh; });
      Card.fnt(g, '600', 11.5);
      oLines.forEach(function (ln) { put(ln, P + pad, ty, C.warnInk); ty += lh; });
      y += bh + 16;
    }

    /* ── footer ── */
    if (!dry) {
      g.strokeStyle = C.dash; g.lineWidth = 1;
      if (g.setLineDash) g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(P, y + .5); g.lineTo(W - P, y + .5); g.stroke();
      if (g.setLineDash) g.setLineDash([]);
    }
    y += 16;
    Card.fnt(g, '600', 11);
    put(d.group + ' · Daily Plan · ' + dmy(d.date), P, y, C.foot);
    return y + 14;
  },

  /* ══════════ the EOD card ══════════
     Everything the Excel's first tab says, in the order a reader asks for it: who and where, target vs
     achievement, where the orders stand, the brand split, and the day's extras. An image nobody can
     edit is the whole point, so it carries numbers, not inputs. */
  eodData: function () {
    var a = Eod.agg(), p = a.plan || {}, e = DB.emp(DB.me.code) || {}, s = Auth.session() || {};
    var st = function (x) { return a.ord.filter(function (o) { return String(o.Status) === x; }); };
    var sum = function (g2, f) { return g2.reduce(function (x, o) { return x + num(o[f]); }, 0); };
    var mrp = 0, units = 0, msl = 0, nonMsl = 0;
    a.lines.forEach(function (l) {
      units += num(l.Units); mrp += num(l.Units) * num(l.Mrp);
      if (/^msl$/i.test(String(l.MslStatus || ''))) msl += num(l.NsvLakh); else nonMsl += num(l.NsvLakh);
    });
    /* every brand the master knows about, not just the ones with a line punched today — a brand with
       zero NSV is exactly the fact the report has to carry, not a row that quietly disappears.
       Mamaearth is pinned to the BOTTOM whatever it sold: this is the Emerging Brands report, and
       Mamaearth heading the list on a good day buried the brands the report is actually about. */
    var brandSet = {};
    Field.uniq('Brand').forEach(function (b) { brandSet[b] = 1; });
    Object.keys(a.brand).forEach(function (b) { brandSet[b] = 1; });
    var isME = function (b) { return /mamaearth/i.test(String(b || '')); };
    var brands = Object.keys(brandSet).map(function (b) { return [b, num(a.brand[b])]; })
      .sort(function (x, y) {
        if (isME(x[0]) !== isME(y[0])) return isME(x[0]) ? 1 : -1;
        return y[1] - x[1];
      });
    var saved = DB.find('Eod', DB.me.code + '_' + a.t) || {}, br = Eod.brandRows(a);
    return {
      date:a.t, time:saved.ClosedAt || new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
      name:DB.me.name || s.name || '', code:DB.me.code || s.code || '',
      week:p.Week || '', zone:e.Zone || s.zone || '', hq:e.HQ || s.hq || '',
      desig:e.Designation || s.desig || '',
      asm:e.AsmName || '', hod:e.HodName || '',
      ww:I18n.s(p.WorkingWith || '—'),
      town:p.Town || '—', beat:p.Beat || '—', focus:p.Focus || '',
      /* label, target, achieved, kind: 0 = count, 1 = money, 2 = lakh */
      kpi:[['TC (Total calls)', num(p.ScTarget) || 7, a.tc, 0],
           ['PC (Productive calls)', num(p.ScTarget) || 7, a.pc, 0],
           ['Naye outlet (NSO)', num(p.NsoTarget), a.ns.length, 0],
           ['POSM audit', num(p.PosmTarget), a.pa.length, 0],
           ['MRP value', 0, a.value, 1],
           ['NSV (₹ Lakh)', 0, a.nsv, 2]],
      status:[['Billing Done', st('Billing Done').length, sum(st('Billing Done'), 'TotValue')],
              ['Order in Process', st('Order in Process').length, sum(st('Order in Process'), 'TotValue')],
              ['Cancel Order', st('Cancel Order').length, 0]],
      stores:a.ord.map(function (o) {
        return [o.StoreName || '—', I18n.s(String(o.Status || '')), num(o.TotValue)]; }),
      btgt:br.rows, btgtT:br.tT, btgtA:br.tA,
      btgt:br.rows, btgtT:br.tT, btgtA:br.tA,
      brands:brands, nsv:a.nsv, mrp:mrp, units:units, sku:a.lines.length,
      msl:msl, nonMsl:nonMsl,
      posmReq:a.pr.length,
      nso:a.ns.map(function (x) { return (x.StoreName || '') + (x.Town ? ' · ' + x.Town : ''); }),
      closed:saved.ClosedAt || '', remarks:saved.Remarks || '',
      group:DB.cfg('Group_Name', 'Honasa Emerging Brands')
    };
  },
  eodDraw: function (g, d, dry) {
    var W = Card.W - Card.M * 2, P = 17, iw = W - P * 2, C = Card.C, y = 0;
    var fill = function (col, x, yy, w, h, r) {
      if (dry) return; g.fillStyle = col;
      if (r) { Card.rr(g, x, yy, w, h, r); g.fill(); } else g.fillRect(x, yy, w, h);
    };
    var put = function (t, x, yy, col, align) {
      if (dry) return; g.fillStyle = col; g.textAlign = align || 'left'; g.textBaseline = 'alphabetic';
      g.fillText(I18n.s(String(t)), x, yy);
    };
    var sec = function (label) {
      y += 6;
      fill(C.band, 0, y - 12, W, 24);
      Card.fnt(g, '800', 11.5);
      put(label, P, y + 4, C.green);
      y += 24;
    };
    var row3 = function (a2, b2, c2, bold, col) {
      Card.fnt(g, bold ? '800' : '400', 12.5);
      put(a2, P, y, col || C.ink);
      put(b2, P + iw * .62, y, col || C.ink, 'right');
      put(c2, W - P, y, col || C.ink, 'right');
      y += 18;
    };
    var line = function () {
      if (!dry) { g.strokeStyle = C.line; g.lineWidth = 1;
        g.beginPath(); g.moveTo(P, y - 12.5); g.lineTo(W - P, y - 12.5); g.stroke(); }
    };

    y = Card.band(g, d, dry, 'Day Report (EOD)', W, P, C, fill, put) + 22;

    /* who / where — the same block as the morning card */
    Card.fnt(g, '800', 19);
    put(d.name, P, y, C.dark);
    var nw = g.measureText(d.name).width;
    Card.fnt(g, '600', 13);
    put('(' + d.code + ')', P + nw + 7, y, C.code);
    y += 19;
    Card.fnt(g, '400', 12.5);
    put([dmy(d.date), d.week, (d.zone ? d.zone + ' / ' + d.hq : d.hq), d.desig]
        .filter(Boolean).join(' · '), P, y, C.meta);
    y += 17;
    Card.fnt(g, '400', 12);
    put([d.town, d.beat].filter(function (x) { return x && x !== '—'; }).join(' / ') +
        (d.ww && d.ww !== '—' ? '  ·  ' + d.ww : ''), P, y, C.meta);
    y += 15;
    if (d.hod || d.asm) {
      Card.fnt(g, '400', 11.5);
      put([d.asm ? 'ASM: ' + d.asm : '', d.hod ? 'HOD: ' + d.hod : ''].filter(Boolean).join('  ·  '),
          P, y, C.foot);
      y += 15;
    }
    y += 6;

    /* headline tiles */
    var tiles = [[String(d.kpi[0][2]) + ' / ' + d.kpi[0][1], 'TC / SC'],
                 [String(d.kpi[1][2]), 'PC'],
                 ['₹' + lakh(d.nsv) + 'L', 'NSV'],
                 [String(d.kpi[2][2]), 'Naye outlet']];
    var tw = (iw - 3 * 8) / 4;
    tiles.forEach(function (t, i) {
      var x = P + i * (tw + 8);
      fill(C.tile, x, y, tw, 46, 8);
      Card.fnt(g, '800', 15);
      put(t[0], x + tw / 2, y + 21, C.dark, 'center');
      Card.fnt(g, '600', 9.5);
      put(t[1], x + tw / 2, y + 36, C.meta, 'center');
    });
    y += 56;

    sec('TARGET vs ACHIEVEMENT');
    Card.fnt(g, '800', 10.5);
    put('KYA', P, y, C.foot);
    put('TARGET', P + iw * .62, y, C.foot, 'right');
    put('ACHIEVE', W - P, y, C.foot, 'right');
    y += 15;
    d.kpi.forEach(function (k) {
      var fmt = function (v) { return k[3] === 1 ? inr(v) : k[3] === 2 ? lakh(v) + ' L' : String(v); };
      var ok = k[1] > 0 && k[2] >= k[1];
      line();
      row3(k[0], k[1] > 0 ? fmt(k[1]) : '—', fmt(k[2]), false, ok ? C.green : C.ink);
    });

    sec('ORDER STATUS');
    d.status.forEach(function (r) {
      line();
      row3(r[0], r[1] + ' store', r[2] ? inr(r[2]) : '—');
    });
    line();
    row3('TOTAL', d.sku + ' SKU · ' + Math.round(d.units) + ' units', inr(d.mrp) + ' MRP', true);

    if (d.btgt && d.btgt.length) {
      sec('BRAND-WISE — TARGET vs ACHIEVED (₹ LAKH)');
      Card.fnt(g, '800', 10.5);
      put('BRAND', P, y, C.foot);
      put('TARGET', P + iw * .62, y, C.foot, 'right');
      put('ACHIEVE', W - P, y, C.foot, 'right');
      y += 15;
      d.btgt.forEach(function (b) {
        line();
        row3(b[0], lakh(b[1]), lakh(b[2]), false, b[1] > 0 && b[2] >= b[1] ? C.green : C.ink);
      });
      line();
      row3('TOTAL', lakh(d.btgtT), lakh(d.btgtA), true);
    }
    if (d.brands.length) {
      sec('BRAND-WISE NSV — SHARE');
      d.brands.forEach(function (b) {
        var pct = d.nsv > 0 ? Math.round(b[1] / d.nsv * 100) : 0;
        line();
        row3(b[0], pct + '%', lakh(b[1]));
      });
    }

    if (d.stores.length) {
      sec('STORE-WISE');
      d.stores.slice(0, 12).forEach(function (o) {
        line();
        row3(o[0], o[1], o[2] ? inr(o[2]) : '—');
      });
      if (d.stores.length > 12) {
        line();
        Card.fnt(g, '400', 11.5);
        put('+ ' + (d.stores.length - 12) + ' aur store', P, y, C.foot);
        y += 18;
      }
    }

    sec('AUR BHI');
    line(); row3('MSL / Non-MSL (₹L)', lakh(d.msl), lakh(d.nonMsl));
    line(); row3('POSM chahiye', d.posmReq + ' store', '');
    d.nso.forEach(function (t, i) {
      line();
      Card.fnt(g, '400', 12);
      put((i === 0 ? 'Naye outlet: ' : '') + t, P, y, C.ink);
      y += 18;
    });
    if (d.remarks) {
      Card.fnt(g, '400', 12);
      var rl = Card.wrap(g, 'Remarks: ' + d.remarks, iw);
      y += 4;
      rl.forEach(function (t) { put(t, P, y, C.meta); y += 16; });
    }

    y += 8;
    if (!dry) {
      g.strokeStyle = C.dash; g.lineWidth = 1;
      if (g.setLineDash) g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(P, y + .5); g.lineTo(W - P, y + .5); g.stroke();
      if (g.setLineDash) g.setLineDash([]);
    }
    y += 16;
    Card.fnt(g, '600', 11);
    put(d.group + ' · Day Report (EOD) · ' + dmy(d.date) +
        (d.closed ? ' · closed ' + d.closed : ''), P, y, C.foot);
    return y + 14;
  },

  /* ---------- canvas → PNG ---------- */
  png: function (kind) {
    kind = kind || 'plan';
    var K = Card.KIND[kind];
    var d = Card[K.data]();
    var key = JSON.stringify(d);
    var have = Card._png[kind];
    if (have && have.key === key) return Promise.resolve(have);
    return Card.logo().then(function () {
      var c = document.createElement('canvas'), S = Card.S, M = Card.M, CW = Card.W - M * 2;
      c.width = Card.W * S; c.height = 10;
      var g = c.getContext('2d');
      g.setTransform(S, 0, 0, S, 0, 0);
      var h = Card[K.draw](g, d, true);                    /* measure — nothing is painted */
      var H = h + M * 2;
      c.height = Math.ceil(H * S);                         /* resizing clears the canvas */
      g = c.getContext('2d');
      g.setTransform(S, 0, 0, S, 0, 0);
      /* an opaque white page, never transparency: WhatsApp's dark mode paints a PNG's transparent
         corners BLACK, which would frame the card in black notches */
      g.fillStyle = '#ffffff'; g.fillRect(0, 0, Card.W, H);
      g.save();
      g.translate(M, M);
      Card.rr(g, 0, 0, CW, h, Card.R); g.clip();           /* rounds the dark header too */
      Card[K.draw](g, d, false);                           /* paint */
      g.restore();
      g.strokeStyle = Card.C.line; g.lineWidth = 1;
      Card.rr(g, M + .5, M + .5, CW - 1, h - 1, Card.R); g.stroke();
      return new Promise(function (res, rej) {
        var done = function (b) {
          if (!b) return rej(new Error('blob fail'));
          if (Card._png[kind] && Card._png[kind].url) URL.revokeObjectURL(Card._png[kind].url);
          Card._png[kind] = { key:key, blob:b, url:URL.createObjectURL(b),
                        data:c.toDataURL('image/png'),
                        name:K.file + '-' + d.code + '-' + d.date + '.png' };
          res(Card._png[kind]);
        };
        if (c.toBlob) c.toBlob(done, 'image/png');
        else done(null);
      });
    });
  },

  /* the preview both shows the rep what will be sent AND warms the blob, so the Send tap can call
     navigator.share inside its own user gesture (a share fired after a long async gap is refused) */
  preview: function (kind) {
    kind = kind || 'plan';
    var K = Card.KIND[kind], box = $(K.box); if (!box) return;
    Card.png(kind).then(function (o) {
      var b = $(K.box); if (!b) return;
      b.innerHTML = I18n.tr('<img src="' + o.data + '" alt="' + K.sub + '" ' +
        'style="width:100%;display:block;border:1px solid var(--line);border-radius:12px">');
    }).catch(function () {
      var b = $(K.box); if (b) b.innerHTML = I18n.tr('<div class="hint">Preview nahi ban paya — image ab bhi bhej sakte ho.</div>');
    });
  },

  /* ---------- share ---------- */
  send: function (el) {
    var r = Plan.row();
    if (!r.PlanAt) { toast('Pehle plan save karo'); return null; }
    return Busy.run('planimg_' + today(), el, 'Image bhej rahe hain…', function () {
      return Card.png().then(function (o) {
        var cap = Plan.msg();
        var f = null;
        try { f = new File([o.blob], o.name, { type:'image/png' }); } catch (e) {}
        var mark = function () { return Plan.markNotified(); };
        if (f && navigator.canShare && navigator.canShare({ files:[f] }) && navigator.share) {
          return navigator.share({ files:[f], title:'Emerging Brand — Today Plan', text:cap })
            .then(function () { toast('Image bhej di — Field khul gaya', 3000); return mark(); })
            .catch(function (e) {
              /* the rep closed the share sheet — nothing was sent, so nothing is marked */
              if (e && (e.name === 'AbortError' || /abort|cancel/i.test(e.message || ''))) {
                toast('Bhejna cancel ho gaya'); return null;
              }
              return Card.fallback(o, cap).then(mark);
            });
        }
        return Card.fallback(o, cap).then(mark);
      }).catch(function () {
        toast('! Image nahi ban payi — text bhej rahe hain');
        Share.wa(Plan.msg());
        return Plan.markNotified();
      });
    });
  },
  /* desktop / older browsers cannot attach a file to the share sheet: download it and open WhatsApp
     with the caption ready, then tell the rep in one line what to do */
  fallback: function (o, cap) {
    var a = document.createElement('a');
    a.href = o.url; a.download = o.name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    Share.wa(cap);
    return UI.alert({ icon:'', title:'Image download ho gayi',
      msg:'Is device par app seedha image share nahi kar sakta.<br><b>' + esc(o.name) + '</b> download ho gayi hai ' +
          'aur WhatsApp khul gaya hai — wahan <b>attach</b> karke bhej do.' });
  },
  /* full-size look before sending */
  zoom: function (kind) {
    Card.png(kind || 'plan').then(function (o) {
      UI.dialog({ icon:'', title:'Aisi image jayegi',
        msg:'<img src="' + o.data + '" style="width:100%;display:block;border-radius:10px;border:1px solid var(--line)">',
        ok:'Theek hai', cancel:false });
    });
  },

  /* ── share the EOD card ──
     The morning card also stamps NotifiedAt, which unlocks Field; an EOD image has nothing to unlock,
     so this is the same share flow with none of the gate machinery. */
  sendEod: function (el) {
    return Busy.run('eodimg_' + today(), el, 'Image bhej rahe hain…', function () {
      return Card.png('eod').then(function (o) {
        var cap = Eod.msg();
        var f = null;
        try { f = new File([o.blob], o.name, { type:'image/png' }); } catch (e) {}
        if (f && navigator.canShare && navigator.canShare({ files:[f] }) && navigator.share) {
          return navigator.share({ files:[f], title:'Emerging Brand — Day Report', text:cap })
            .then(function () { toast('EOD image bhej di', 3000); })
            .catch(function (e) {
              if (e && (e.name === 'AbortError' || /abort|cancel/i.test(e.message || '')))
                return toast('Bhejna cancel ho gaya');
              return Card.fallback(o, cap);
            });
        }
        return Card.fallback(o, cap);
      }).catch(function () {
        toast('! Image nahi ban payi — text bhej rahe hain');
        Share.wa(Eod.msg());
      });
    });
  }
};

/* ═══════════════ HOME ═══════════════ */
var Home = {
  /* dash · calls · ord · team */
  view:'dash', per:'M', month:'', metric:'nsv',
  /* a from–to the rep picked himself; both set = it wins over the rolling seven days */
  from:'', to:'',
  /* GARUDA went live in July — there is no data before it, so no period may reach back past it */
  start: function () { return String(DB.cfg('Go_Live_Month', '2026-07')).slice(0, 7); },
  mon: function () {
    var t = today().slice(0, 7);
    if (!Home.month || Home.month > t || Home.month < Home.start()) Home.month = t;
    return Home.month;
  },
  months: function () {
    var out = [], m = Home.start(), t = today().slice(0, 7), guard = 0;
    while (m <= t && guard++ < 60) {
      out.push(m);
      var y = +m.slice(0, 4), n = +m.slice(5, 7) + 1;
      if (n > 12) { n = 1; y++; }
      m = y + '-' + p2(n);
    }
    return out;
  },
  /* [from, to] for the chosen period — the ONE definition every number on the screen uses */
  range: function () {
    var t = today();
    if (Home.per === 'D') return [t, t];
    if (Home.per === 'W') {
      var s0 = Home.start() + '-01';
      if (Home.from && Home.to) {
        var a = Home.from < Home.to ? Home.from : Home.to, b = Home.from < Home.to ? Home.to : Home.from;
        return [a < s0 ? s0 : a, b > t ? t : b];
      }
      var d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 6);
      var f = iso(d);
      return [f < s0 ? s0 : f, t];
    }
    var m = Home.mon();
    var last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
    return [m + '-01', m === t.slice(0, 7) ? t : iso(last)];
  },
  rangeLbl: function () {
    var r = Home.range();
    return Home.per === 'D' ? dmy(r[0])
      : Home.per === 'W' ? dmy(r[0]) + ' – ' + dmy(r[1]) + ' (' + Home.days() + ' din)'
      : monthName(Home.mon()) + ' (1–' + (+r[1].slice(8, 10)) + ')';
  },
  /* "Jul 26" — the month AND the year, because a plain "Jul" stops meaning anything next year */
  monLbl: function (m) {
    return monthName(m).split(' ')[0].slice(0, 3) + ' ' + String(m).slice(2, 4);
  },
  days: function () { var r = Home.range();
    return Math.round((new Date(r[1] + 'T00:00:00') - new Date(r[0] + 'T00:00:00')) / 864e5) + 1; },
  inR: function (d) { var r = Home.range(), x = toISO(d); return !!x && x >= r[0] && x <= r[1]; },

  /* ── status buckets, one place ── */
  cancelled: function (s) { return /cancel|no.?order/i.test(String(s || '')); },
  billed: function (s) { return /billing|delivered/i.test(String(s || '')); },
  FIELD:/self working|me sales team|ba supervisor/i,
  /* which company a day was worked with — the whole Team view hangs off this one bucket */
  bucket: function (ww) {
    var w = String(ww || '');
    if (/me sales team/i.test(w)) return 'team';
    if (/ba supervisor/i.test(w)) return 'ba';
    if (/self working/i.test(w)) return 'self';
    return 'other';
  },
  BK:[['self', 'Self'], ['team', 'ME Sales team'], ['ba', 'BA supervisor']],

  /* ══ ONE aggregation for the whole screen ══
     Everything is derived from the rep's own rows for the chosen range, so no two cards can disagree
     about the same number. Cancelled / No-Order visits still count as a CALL but never as value. */
  agg: function () {
    var A = { tc:0, pc:0, scT:0, nsoT:0, posmT:0, fieldDays:0, planDays:0,
      placed:0, billed:0, pending:0, cancel:0, nsv:0, mrp:0, units:0,
      nso:0, posm:0, posmReq:0, eod:0,
      byBrand:{}, byCat:{}, bySub:{}, bySku:{}, byStore:{}, byDay:{}, byBucket:{},
      msl:{ u:0, v:0 }, non:{ u:0, v:0 }, mega:{}, ba:{},
      pjpPlanned:0, pjpCovered:0, offPjp:0, monthly:{}, pend:[],
      /* the split inside TC, and the four adherence numbers */
      visit:0, tel:0, workDays:0, onPjp:0, missed:0 };
    Home.BK.forEach(function (b) { A.byBucket[b[0]] = { days:0, tc:0, pc:0, nsv:0, nso:0 }; });
    A.byBucket.other = { days:0, tc:0, pc:0, nsv:0, nso:0 };

    var stores = DB.myStores(), sMap = {};
    stores.forEach(function (s) {
      if (s.CompanyCode) sMap[String(s.CompanyCode)] = s;
      if (s.ClientId) sMap[String(s.ClientId)] = s;
    });

    /* the plan tells us what the day was SUPPOSED to be — targets and the working-with bucket */
    var dayBk = {};
    DB.mine('DayPlan').forEach(function (p) {
      var d = toISO(p.Date); if (!d) return;
      dayBk[d] = Home.bucket(p.WorkingWith);
      if (!Home.inR(d)) return;
      A.planDays++;
      if (!Home.FIELD.test(String(p.WorkingWith || ''))) return;
      A.fieldDays++;
      A.scT += num(p.ScTarget) || num(DB.cfg('SC_Call_Target', 7)) || 7;
      A.nsoT += num(p.NsoTarget); A.posmT += num(p.PosmTarget);
    });

    DB.mine('SecOrders').forEach(function (o) {
      var d = toISO(o.Date), can = Home.cancelled(o.Status), bil = Home.billed(o.Status);
      if (d && !can) {
        var mk = d.slice(0, 7);
        if (!A.monthly[mk]) A.monthly[mk] = { nsv:0, placed:0, billed:0 };
        A.monthly[mk].nsv += num(o.TotNsvLakh);
        A.monthly[mk][bil ? 'billed' : 'placed']++;
      }
      if (!Home.billed(o.Status) && !can) A.pend.push(o);
      if (!Home.inR(d)) return;
      A.tc++;
      /* TC = store visits + telephonic; the order says which it was */
      if (/telephonic|phone/i.test(String(o.Source || ''))) A.tel++; else A.visit++;
      if (!A.byDay[d]) A.byDay[d] = { tc:0, pc:0, nsv:0, val:0 };
      A.byDay[d].tc++;
      var bk = dayBk[d] || 'other', B = A.byBucket[bk] || A.byBucket.other;
      B.tc++;
      if (can) { A.cancel++; return; }
      if (num(o.TotUnits) > 0) { A.pc++; A.byDay[d].pc++; B.pc++; }
      if (bil) A.billed++; else A.pending++;
      A.placed++;
      A.nsv += num(o.TotNsvLakh); B.nsv += num(o.TotNsvLakh);
      A.byDay[d].nsv += num(o.TotNsvLakh); A.byDay[d].val += num(o.TotValue);
      var key = String(o.CompanyCode || o.StoreName || ''), st = sMap[key] || {};
      var type = String(o.StoreType || st.StoreType || st.Type || '');
      if (key) {
        if (!A.byStore[key]) A.byStore[key] = { name:o.StoreName || (st.StoreName || key), type:type || '—', nsv:0, visits:0 };
        A.byStore[key].nsv += num(o.TotNsvLakh); A.byStore[key].visits++;
        (/mega/i.test(type) ? A.mega : A.ba)[key] = 1;
      }
    });

    DB.mine('SecOrderLines').forEach(function (l) {
      if (!Home.inR(l.Date) || Home.cancelled(l.Status)) return;
      var u = num(l.Units), v = num(l.NsvLakh), mv = u * num(l.Mrp);
      A.units += u; A.mrp += mv;
      var add = function (o, k) { if (!o[k]) o[k] = { u:0, v:0, mrp:0 }; o[k].u += u; o[k].v += v; o[k].mrp += mv; };
      add(A.byBrand, l.Brand || 'Other');
      add(A.byCat, l.Category || 'Other');
      add(A.bySub, l.SubCategory || 'Other');
      if (!A.bySku[String(l.Sku)]) A.bySku[String(l.Sku)] = { name:l.SkuName || l.Sku, brand:l.Brand || '', u:0, v:0, mrp:0 };
      A.bySku[String(l.Sku)].u += u; A.bySku[String(l.Sku)].v += v; A.bySku[String(l.Sku)].mrp += mv;
      (/^msl$/i.test(String(l.MslStatus || '')) ? A.msl : A.non).u += u;
      (/^msl$/i.test(String(l.MslStatus || '')) ? A.msl : A.non).v += v;
    });

    DB.mine('NewStores').forEach(function (r) {
      if (!Home.inR(r.Date)) return;
      A.nso++;
      var B = A.byBucket[dayBk[toISO(r.Date)] || 'other'] || A.byBucket.other; B.nso++;
    });
    DB.mine('PosmAudit').forEach(function (r) { if (Home.inR(r.Date)) A.posm++; });
    DB.mine('PosmRequirement').forEach(function (r) { if (Home.inR(r.Date)) A.posmReq++; });
    DB.mine('Eod').forEach(function (r) { if (Home.inR(r.Date)) A.eod++; });

    /* ── PJP adherence, the four numbers ──
       A working day is a planned FIELD day (weekly off, leave and holiday are not). Of those, a day is
       ON the plan when he worked the beat he had planned, OFF the plan when the change was approved,
       and MISSED when neither. An HOD's own marking (DayPlan.PjpStatus) beats all of it — he knows what
       actually happened. */
    var plans = {};
    DB.mine('DayPlan').forEach(function (p) { plans[toISO(p.Date)] = p; });
    var pjpDays = {};
    Home.months().forEach(function (m) {
      DB.pjpMonth(DB.me.code, m).forEach(function (p) {
        var d = toISO(p.Date);
        if (!Home.inR(d)) return;
        if (!Home.FIELD.test(String(p.Ww || p.Week || 'Self Working'))) return;
        pjpDays[d] = p;
      });
    });
    /* a day the rep planned himself (no master row yet) still counts as a working day */
    Object.keys(plans).forEach(function (d) {
      if (!Home.inR(d) || pjpDays[d]) return;
      if (Home.FIELD.test(String(plans[d].WorkingWith || ''))) pjpDays[d] = plans[d];
    });
    Object.keys(pjpDays).forEach(function (d) {
      A.workDays++;
      var p = plans[d] || {}, mark = String(p.PjpStatus || '').toLowerCase();
      var worked = !!A.byDay[d];
      if (mark) {
        if (/^on/.test(mark)) A.onPjp++;
        else if (/^off/.test(mark)) A.offPjp++;
        else A.missed++;
        return;
      }
      if (!worked) { A.missed++; return; }
      if (String(p.OffPjp || '') === 'Yes' && /approv/i.test(String(p.Approval || ''))) A.offPjp++;
      else A.onPjp++;
    });
    /* work on a day that was never a planned field day is off-plan too */
    Object.keys(A.byDay).forEach(function (d) { if (!pjpDays[d]) A.offPjp++; });
    Home.BK.concat([['other', 'Other']]).forEach(function (b) {
      var n = 0;
      Object.keys(A.byDay).forEach(function (d) { if ((dayBk[d] || 'other') === b[0]) n++; });
      A.byBucket[b[0]].days = n;
    });
    return A;
  },

  /* ══ small chart helpers — plain SVG, no library, readable on a phone ══ */
  bar: function (data, color) {
    var W = 320, H = 132, pl = 26, pb = 20, pt = 10;
    var iw = W - pl - 6, ih = H - pb - pt;
    var max = Math.max.apply(null, data.map(function (d) { return d.v; })) || 1;
    var bw = iw / Math.max(1, data.length) * .62, gap = iw / Math.max(1, data.length);
    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="cht" preserveAspectRatio="none">';
    for (var i = 0; i <= 3; i++) {
      var y = pt + ih * i / 3;
      s += '<line x1="' + pl + '" y1="' + y + '" x2="' + (W - 6) + '" y2="' + y + '" class="cg"/>' +
        '<text x="' + (pl - 4) + '" y="' + (y + 3) + '" class="cl" text-anchor="end">' +
        Home.n1(max * (1 - i / 3)) + '</text>';
    }
    data.forEach(function (d, i) {
      var bh = d.v > 0 ? Math.max(2, d.v / max * ih) : 0, x = pl + i * gap + (gap - bw) / 2, y = pt + ih - bh;
      s += '<rect x="' + x + '" y="' + y + '" width="' + bw + '" height="' + bh + '" rx="2" fill="' + color + '"/>' +
        '<text x="' + (x + bw / 2) + '" y="' + (H - 6) + '" class="cl" text-anchor="middle">' + esc(d.l) + '</text>' +
        (d.v > 0 ? '<text x="' + (x + bw / 2) + '" y="' + (y - 3) + '" class="cv" text-anchor="middle">' + Home.n1(d.v) + '</text>' : '');
    });
    return s + '</svg>';
  },
  n1: function (v) { return v >= 10 ? String(Math.round(v)) : (Math.round(v * 10) / 10).toFixed(1); },
  /* plan vs achievement — a labelled bar the rep can read in one look */
  pva: function (label, plan, act, sub) {
    var p = plan > 0 ? Math.round(act / plan * 100) : 0;
    var cls = p >= 100 ? 'g' : p >= 70 ? 'w' : 'r';
    return '<div class="pva"><div class="pva-h"><div><b>' + esc(label) + '</b><i>' + esc(sub || '') + '</i></div>' +
      '<div class="pva-n">' + Home.n1(act) + '<span>/ ' + Home.n1(plan) + '</span>' +
      '<span class="pill p-' + (cls === 'g' ? 'ok' : cls === 'w' ? 'warn' : 'bad') + '">' + p + '%</span></div></div>' +
      '<div class="pbar"><i class="' + cls + '" style="width:' + Math.min(100, p) + '%"></i></div></div>';
  },
  /* a share row — used by brand / category / MSL */
  share: function (label, v, tot, sub) {
    var p = tot > 0 ? Math.round(v / tot * 100) : 0;
    return '<div style="margin-bottom:9px"><div class="srow"><span>' + esc(label) + '</span>' +
      '<b>' + lakh(v) + ' L · ' + p + '%' + (sub ? ' <i>' + esc(sub) + '</i>' : '') + '</b></div>' +
      '<div class="pbar"><i style="width:' + p + '%"></i></div></div>';
  },
  tbl: function (head, rows, foot) {
    return '<div class="tw"><table><thead><tr>' + head.map(function (h, i) {
      return '<th' + (i ? ' class="num"' : '') + '>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' +
      (rows.length ? rows.map(function (r) { return '<tr>' + r.map(function (c, i) {
        return '<td' + (i ? ' class="num"' : '') + '>' + c + '</td>'; }).join('') + '</tr>'; }).join('')
        : '<tr><td colspan="' + head.length + '">Is period me kuch nahi</td></tr>') +
      (foot ? '<tr class="tot">' + foot.map(function (c, i) {
        return '<td' + (i ? ' class="num"' : '') + '><b>' + c + '</b></td>'; }).join('') + '</tr>' : '') +
      '</tbody></table></div>';
  },

  /* ══ the screen ══ */
  html: function () {
    var t = today(), code = DB.me.code;
    var plan = DB.find('DayPlan', code + '_' + t);
    var pjp = DB.pjpFor(code, t);
    var l = Gate.level();
    var ps = Gate.pjpState();
    var next = l === 0 ? (
        ps.s === 'pending'? { t:'PJP HOD ke paas hai', v:'appr',
                                s:(monthName(ps.month) || ps.month) + ' ka plan bheja hua hai — aapka bhara hua data safe hai, approval ka wait karo' }
      : ps.s === 'rejected' ? { t:'PJP reject hua', v:'pjp', s:'PJP tab me reason dekho aur dusra plan bhejo' }
      : ps.s === 'draft' && Gate.allowed('pjp')
                        ? { t:'PJP adhoora hai', v:'pjp', s:'Bhara hua plan wahin hai — poora karke HOD ko bhejo' }
      /* nothing filed and the window has shut — including the case where an admin removed it. Sending
         him to a tab that will refuse him is worse than saying so. */
      : !Gate.allowed('pjp')
                        ? { t:'PJP band hai', v:'home', s:I18n.s(Gate.why('pjp')) }
      :                   { t:'PJP banao', v:'pjp', s:'Is month ka beat plan banao aur HOD ko bhejo' })
      : l === 1 ? (plan && plan.PlanAt ? { t:'Plan HOD ko bhejo', s:'Notify karo — tabhi Field khulega', v:'plan' }
                                       : { t:'Aaj ka Plan save karo', s:'Town, beat aur target confirm karo', v:'plan' })
      : l === 2 ? { t:'Field shuru karo', s:'Store select karke order punch karo', v:'field' }
      : { t:'Kaam chalu hai', s:'Store complete karke EOD close karo', v:'eod' };

    var h = '';
    /* ── ONE block at the top: who, where, and the single next thing to do ──
       The next action used to be a pale banner UNDER the hero, competing with four other cards for
       attention. Folded in, on the blue, with a full-width button: there is exactly one obvious
       thing to tap when the app opens. */
    h += '<div class="card" style="background:linear-gradient(150deg,var(--blue),var(--blue-m));border:0;color:#fff;' +
        'box-shadow:0 8px 24px -12px rgba(29,78,216,.55)">' +
      '<div style="font-size:12px;opacity:.85;font-weight:700;letter-spacing:.02em">' +
        dmy(t) + (pjp && pjp.Week ? ' · ' + esc(pjp.Week) : '') + '</div>' +
      '<h3 style="color:#fff;font-size:21px;margin:5px 0 3px;letter-spacing:-.02em">Namaste, ' +
        esc((DB.me.name || '').split(' ')[0]) + '</h3>' +
      '<div style="font-size:12.5px;opacity:.92;line-height:1.5">' +
        (pjp ? 'Aaj ka PJP: <b>' + esc(pjp.Town || '—') + ' · ' + esc(pjp.Beat || '—') + '</b>'
             : 'Aaj ka PJP master me nahi mila') + '</div>' +
      /* the next action, inset on the hero — the one thing to tap */
      '<div style="margin-top:12px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.22);' +
        'padding:12px;border-radius:12px">' +
        '<div style="font-size:10.5px;font-weight:800;letter-spacing:.09em;opacity:.8">AB YE KARO</div>' +
        '<div style="font-size:15.5px;font-weight:800;margin:3px 0 2px;letter-spacing:-.01em">' +
          esc(next.t) + '</div>' +
        '<div style="font-size:12px;opacity:.9;line-height:1.45">' + esc(next.s) + '</div>' +
        '<button class="btn" style="margin-top:11px;background:#fff;color:var(--blue)" ' +
          'onclick="Router.go(\'' + next.v + '\')">' + esc(I18n.s('Chalo')) + ' →</button>' +
      '</div>' +
      (Gate.locked() ? '<div style="margin-top:10px;background:rgba(255,255,255,.16);padding:8px 10px;border-radius:10px;font-size:12px">Din lock hai — EOD tab se dobara khol sakte ho</div>' : '') +
      '</div>';

    h += Bypass.strip();

    /* ══ TWO LEVELS OF NAVIGATION ══
       Level 1 — Dashboard · Tracker · Approvals: three genuinely different screens.
       Level 2 — only inside Dashboard: Overview · Calls & Stores · Order v/s Delivery · Me v/s Team,
                 which are four cuts of the SAME period, which is why the date selector belongs with
                 them and not with the level above.
       "Today's work" used to sit above all of this. It is gone: the hero card already names the ONE
       next action, and a four-line checklist under it repeated that in a weaker form while pushing
       the actual dashboard below the fold. */
    var TV = [['dash', 'Dashboard'], ['trk', 'Tracker'], ['appr', 'Approvals'],
              ['notif', 'Notification']];
    var SV = [['overview', 'Overview'], ['calls', 'Calls & Stores'],
              ['ord', 'Order v/s Delivery'], ['team', 'Me v/s Team']];
    var top = Home.top(), sub = Home.sub();
    /* Tracker and Approvals are not measured over a period, and neither is the team table, so the date
       selector and the KPI strip would be answering a question none of them asks */
    var own = top !== 'dash';
    h += '<div class="card" style="padding:0 12px 12px"><div class="hnav" id="hm_chips">' +
      TV.map(function (x) {
        var n = x[0] === 'appr' ? Nav.counts().appr : x[0] === 'notif' ? Nav.counts().notif : 0;
        return '<button class="' + (top === x[0] ? 'on' : '') + '"' +
          (top === x[0] ? ' data-on="1"' : '') + ' onclick="Home.go(\'' + x[0] + '\')">' +
          esc(x[1]) + (n ? '<span class="badge">' + (n > 99 ? '99+' : n) + '</span>' : '') + '</button>';
      }).join('') + '</div>' + (own ? '' :
      '<div class="snav" id="hm_sub">' +
        SV.map(function (x) {
          return '<button class="' + (sub === x[0] ? 'on' : '') + '"' +
            (sub === x[0] ? ' data-on="1"' : '') + ' onclick="Home.go(\'' + x[0] + '\')">' +
            esc(x[1]) + '</button>'; }).join('') + '</div>' +
      (sub === 'team' ? '' :
      '<div class="seg" style="margin-top:10px">' +
        [['D', 'Today'], ['W', 'Days'], ['M', 'Month']].map(function (p) {
          return '<button class="' + (Home.per === p[0] ? 'on' : '') + '" onclick="Home.setPer(\'' + p[0] + '\')">' +
            esc(p[1]) + '</button>'; }).join('') + '</div>' +
      /* Days = the rolling seven, or any stretch the rep picks */
      (Home.per === 'W' ? '<div class="pair" style="margin-top:8px">' +
        '<div><label class="f">From</label><input class="in" type="date" min="' + Home.start() + '-01' +
          '" max="' + today() + '" value="' + esc(Home.from || Home.range()[0]) +
          '" onchange="Home.setDay(\'from\',this.value)"></div>' +
        '<div><label class="f">To</label><input class="in" type="date" min="' + Home.start() + '-01' +
          '" max="' + today() + '" value="' + esc(Home.to || Home.range()[1]) +
          '" onchange="Home.setDay(\'to\',this.value)"></div></div>' +
        '<div class="btns" style="margin-top:8px">' +
          '<button class="btn ghost sm" onclick="Home.last7()">Last 7 days</button>' +
          '<button class="btn ghost sm" onclick="Home.thisMonth()">This month</button></div>' : '') +
      (Home.per === 'M' ? '<div style="margin-top:8px"><label class="f">Month</label>' +
        '<select class="in" onchange="Home.setMon(this.value)">' + Home.months().slice().reverse()
          .map(function (m) {
            return '<option value="' + m + '"' + (Home.mon() === m ? ' selected' : '') + '>' +
              esc(Home.monLbl(m)) + '</option>'; }).join('') + '</select></div>' : '') +
      '<div class="hint" style="margin-top:8px">' + esc(Home.rangeLbl()) + ' · GARUDA ' +
      esc(monthName(Home.start()).split(' ')[0]) + ' se chalu</div>')) + '</div>';

    /* the three screens that came in from their own tabs — they build themselves whole */
    if (top === 'trk') return h + Trk.html();
    if (top === 'appr') return h + Appr.html();
    if (top === 'notif') return h + Notif.html();
    if (sub === 'team') return h + Home.teamHtml();

    var A = Home.agg();
    /* the four numbers a salesman is judged on, each with its own denominator */
    var dlv = A.billed + A.pending;
    h += '<div class="kpis">' +
      UI.kpi(A.tc, 'Calls' + (A.scT ? ' / ' + A.scT : ''), A.scT && A.tc >= A.scT ? 'g' : 'b') +
      UI.kpi(A.placed, 'Orders · ' + A.billed + ' billed', 'b') +
      UI.kpi(lakh(A.nsv), 'NSV ₹L', 'g') +
      UI.kpi((dlv ? Math.round(A.billed / dlv * 100) : 0) + '%', 'Billed %', A.billed === dlv && dlv ? 'g' : 'w') +
      '</div>';

    if (sub === 'overview') h += Home.dashHtml(A, plan);
    if (sub === 'calls') h += Home.callsHtml(A);
    if (sub === 'ord') h += Home.ordHtml(A);
    return h;
  },
  after: function () {
    /* keep the CURRENT item of each row in view, horizontally only. scrollIntoView moves the nearest
       scrollable ancestor on BOTH axes, which used to drag the page down to the nav on every render. */
    ['hm_chips', 'hm_sub'].forEach(function (id) {
      var s = $(id); if (!s) return;
      s.classList.toggle('fit', s.scrollWidth <= s.clientWidth + 2);
      var on = s.querySelector('[data-on="1"]');
      if (on) s.scrollLeft = Math.max(0, on.offsetLeft - (s.clientWidth - on.offsetWidth) / 2);
    });
  },
  /* ── one `view`, two levels read out of it ──
     Home.view still holds a single value, so every existing link (Router.go('appr'), the dashboard's
     own deep-links) keeps working untouched. top() says which primary tab that value belongs to and
     sub() which dashboard cut, defaulting to Overview. 'dash' is accepted as an alias for 'overview'
     because older links and the saved default both use it. */
  TOPS:{ trk:'trk', appr:'appr', notif:'notif' },
  SUBS:{ overview:1, calls:1, ord:1, team:1 },
  top: function () { return Home.TOPS[Home.view] || 'dash'; },
  sub: function () {
    if (Home.TOPS[Home.view]) return '';
    return Home.SUBS[Home.view] ? Home.view : 'overview';
  },
  go: function (v) { Home.view = v; render(); Home.after(); },
  setPer: function (p) { Home.per = p; render(); },
  setDay: function (k, v) { Home[k] = v; Home.per = 'W'; render(); },
  last7: function () { Home.from = ''; Home.to = ''; Home.per = 'W'; render(); },
  thisMonth: function () {
    var t = today();
    Home.from = t.slice(0, 7) + '-01'; Home.to = t; Home.per = 'W'; render();
  },
  setMon: function (m) { Home.month = m; Home.per = 'M'; render(); },
  setMetric: function (m) { Home.metric = m; render(); },

  /* ── 1. DASHBOARD ── */
  dashHtml: function (A, plan) {
    var t = today();
    /* Month shows the months; Days shows the days in the chosen stretch — the trend a rep asked for.
       ms is used further down by the month-wise order/billed table, whichever period is showing. */
    var ms = Home.months(), h, trend;
    if (Home.per === 'M') {
      trend = ms.slice(-6).map(function (m) {
        return { l:Home.monLbl(m), v:(A.monthly[m] || {}).nsv || 0 }; });
      h = '<div class="sec-title">Month-wise NSV (₹ Lakh)</div><div class="card">';
    } else {
      var r0 = Home.range(), keys = [], d0 = new Date(r0[0] + 'T00:00:00');
      for (var g = 0; g < 45; g++) {
        var k = iso(d0); if (k > r0[1]) break;
        keys.push(k); d0.setDate(d0.getDate() + 1);
      }
      if (keys.length > 14) keys = keys.slice(-14);          /* a phone can read fourteen bars */
      trend = keys.map(function (k2) {
        return { l:k2.slice(8, 10), v:(A.byDay[k2] || {}).nsv || 0 }; });
      h = '<div class="sec-title">Day-wise NSV (₹ Lakh)' +
        (keys.length < Home.days() ? ' — last ' + keys.length + ' din' : '') + '</div><div class="card">';
    }
    h += Home.bar(trend, 'var(--blue)') + '</div>';

    h += '<div class="sec-title">Order vs billed — month wise</div><div class="card">' +
      Home.tbl(['Month', 'Placed', 'Billed', 'Billed %', 'NSV ₹L'], ms.slice().reverse().map(function (m) {
        var r = A.monthly[m] || { nsv:0, placed:0, billed:0 }, tot = r.placed + r.billed;
        return [esc(monthName(m)), tot, r.billed, (tot ? Math.round(r.billed / tot * 100) : 0) + '%', lakh(r.nsv)];
      })) + '</div>';

    var bn = Object.keys(A.byBrand).sort(function (a, b) { return A.byBrand[b].v - A.byBrand[a].v; });
    h += '<div class="sec-title">Brand share</div><div class="card">' +
      (bn.length ? bn.slice(0, 8).map(function (b) {
        return Home.share(b, A.byBrand[b].v, A.nsv, Math.round(A.byBrand[b].u) + ' u'); }).join('')
        : UI.empty('', 'Is period koi order nahi')) + '</div>';

    h += '<div class="sec-title">Snapshot — ' + esc(Home.rangeLbl()) + '</div><div class="card">' +
      Home.tbl(['What', 'Value'], [
        ['TC (Total calls)', A.tc + (A.scT ? ' <span class="hint">/ ' + A.scT + ' SC</span>' : '')],
        ['PC (Productive calls)', A.pc + ' <span class="hint">' + (A.tc ? Math.round(A.pc / A.tc * 100) : 0) + '% strike rate</span>'],
        ['MRP value', inr(A.mrp)],
        ['NSV', lakh(A.nsv) + ' L'],
        ['Units', Math.round(A.units)],
        ['Naye outlet (NSO)', A.nso + (A.nsoT ? ' <span class="hint">/ ' + A.nsoT + '</span>' : '')],
        ['POSM audit', A.posm + (A.posmT ? ' <span class="hint">/ ' + A.posmT + '</span>' : '')],
        ['POSM chahiye', A.posmReq],
        ['EOD file kiye', A.eod + ' / ' + A.planDays + ' plan din'],
        ['Store visit kiye', Object.keys(A.byStore).length]
      ]) + '</div>';

    h += '<div class="sec-title">Din-wise</div><div class="card">' +
      Home.tbl(['Date', 'Calls', 'Order', 'Value', 'NSV L'],
        Object.keys(A.byDay).sort().reverse().map(function (d) {
          var g = A.byDay[d];
          return [dmy(d), g.tc, g.pc, inr(g.val), lakh(g.nsv)]; })) +
      '<div class="btns"><button class="btn ghost sm" onclick="Home.excel()">Month data download</button></div></div>';

    return h;
  },
  /* Home.todayHtml / Home.step are gone with the "Aaj ka kaam" checklist. The hero card above
     already names the ONE next action and links to it; a four-row restatement of the same thing
     only pushed the dashboard below the fold. */
  excel: function () { return Rep.orders(Home.mon()); },

  /* ── 2. CALLS & STORES ── */
  callsHtml: function (A) {
    var sc = num(DB.cfg('SC_Call_Target', 7)) || 7;
    var scT = A.scT || sc * Math.max(1, A.fieldDays);
    var h = '<div class="sec-title">Plan vs achieved</div><div class="card">' +
      Home.pva('TC (Total calls)', scT, A.tc,
        'SC ' + scT + ' · ' + A.fieldDays + ' field din × ' + sc + '/din') +
      /* TC is store visits PLUS telephonic — a rep is judged on the split, so both are shown */
      Home.pva('Store visits', scT, A.visit, 'TC me se store par gaye') +
      Home.pva('Telephonic calls', scT, A.tel, 'TC me se phone par liye') +
      Home.pva('PC (Productive calls)', Math.round((A.scT || sc) * .6), A.pc, 'Jitne store ne order diya') +
      Home.pva('Naye outlet (NSO)', A.nsoT || num(DB.cfg('NSO_Monthly_Target', 15)), A.nso, 'Plan ka NSO target') +
      Home.pva('POSM', A.posmT || A.fieldDays, A.posm, 'Audit kiye') +
      Home.pva('NSV (₹L)', num(DB.cfg('MTD @24 Days - Working', 36)), A.nsv, 'Month ka NSV target') +
      '</div>';

    var adh = A.workDays ? Math.round((A.onPjp + A.offPjp) / A.workDays * 100) : 0;
    h += '<div class="sec-title">PJP adherence</div><div class="card">' +
      '<div class="kpis" style="margin-bottom:0">' +
        UI.kpi(A.workDays, 'Total working days', 'b') +
        UI.kpi(A.onPjp, 'On planned PJP', A.onPjp ? 'g' : '') +
        UI.kpi(A.offPjp, 'Off PJP (approved change)', A.offPjp ? 'w' : '') +
        UI.kpi(A.missed, 'Missed', A.missed ? 'r' : 'g') +
      '</div>' +
      '<div class="hint" style="margin-top:8px">Working days me weekly off, leave aur holiday nahi gine ' +
      'jaate. Adherence ' + adh + '% — on-PJP aur approved off-PJP dono ginte hain. HOD kisi bhi din ko ' +
      'khud bhi mark kar sakta hai.</div></div>';

    var totMega = 0, totBa = 0;
    DB.myStores().forEach(function (s) {
      if (/mega/i.test(String(s.StoreType || s.Type || ''))) totMega++; else totBa++; });
    h += '<div class="sec-title">Store summary</div><div class="card">' +
      '<div class="kpis k3" style="margin-bottom:0">' +
        UI.kpi(Object.keys(A.byStore).length, 'Store visit kiye', 'b') +
        UI.kpi(Object.keys(A.mega).length + ' / ' + totMega, 'MEGA BA', 'w') +
        UI.kpi(Object.keys(A.ba).length + ' / ' + totBa, 'BA store', '') +
      '</div></div>';

    var top = Object.keys(A.byStore).sort(function (a, b) { return A.byStore[b].nsv - A.byStore[a].nsv; });
    h += '<div class="sec-title">Top performing stores</div><div class="card">' +
      Home.tbl(['Store', 'Visit', 'NSV L'], top.slice(0, 10).map(function (k) {
        var s = A.byStore[k];
        return ['<b>' + esc(s.name) + '</b><div class="hint">' + esc(s.type) + '</div>', s.visits, lakh(s.nsv)];
      }), top.length ? ['TOTAL', Object.keys(A.byStore).length, lakh(A.nsv)] : null) + '</div>';
    return h;
  },

  /* ── 3. ORDER vs DELIVERY ── */
  ordHtml: function (A) {
    var tot = A.placed + A.cancel;
    var pc = function (v) { return (tot ? Math.round(v / tot * 100) : 0) + '%'; };
    var h = '<div class="sec-title">Order status</div><div class="card">' +
      Home.tbl(['Status', 'Store', 'Share'], [
        ['Billed / delivered', A.billed, pc(A.billed)],
        ['Pending — billing baaki', A.pending, pc(A.pending)],
        ['No order / cancel', A.cancel, pc(A.cancel)]
      ], ['TOTAL', tot, '100%']) +
      '<div class="kpis k3" style="margin-top:10px;margin-bottom:0">' +
        UI.kpi(lakh(A.nsv), 'NSV ₹L', 'g') + UI.kpi(inr(A.mrp), 'MRP value', 'b') +
        UI.kpi(A.placed ? lakh(A.nsv / A.placed) : '0', 'Avg NSV / order', '') +
      '</div></div>';

    /* which orders are actually stuck — the whole point of the tab */
    var pend = A.pend.sort(function (a, b) { return String(a.Date).localeCompare(String(b.Date)); });
    h += '<div class="sec-title">Pending orders — billing nahi hui (' + pend.length + ')</div><div class="card">' +
      (pend.length ? Home.tbl(['Store', 'Din', 'Value', 'NSV L'], pend.slice(0, 40).map(function (o) {
        var age = Math.max(0, Math.round((Date.now() - new Date(toISO(o.Date) + 'T00:00:00').getTime()) / 864e5));
        return ['<b>' + esc(o.StoreName) + '</b><div class="hint">' + dmy(o.Date) + ' · ' + esc(o.PoNumber) + '</div>',
          age, inr(o.TotValue), lakh(o.TotNsvLakh)]; })) +
        '<div class="hint" style="margin-top:8px">Status Tracker tab se update karo — ASM se poochh ke.</div>' +
        '<div class="btns"><button class="btn ghost sm" onclick="Router.go(\'trk\')">Tracker kholo</button></div>'
        : UI.empty('', 'Ek bhi order pending nahi — sab billed')) + '</div>';

    /* zero on either side is a real number, not an absence of data — a rep with no Non-MSL sale
       still needs to see "0.00 L", not a card that quietly disappears. Home.share already guards
       the % of total against a zero denominator, so this never divides by zero either. */
    var mt = A.msl.v + A.non.v;
    h += '<div class="sec-title">MSL vs Non-MSL</div><div class="card">' +
      Home.share('MSL', A.msl.v, mt, Math.round(A.msl.u) + ' u') +
      Home.share('Non-MSL', A.non.v, mt, Math.round(A.non.u) + ' u') + '</div>';

    var cat = Object.keys(A.byCat).sort(function (a, b) { return A.byCat[b].v - A.byCat[a].v; });
    h += '<div class="sec-title">Category-wise</div><div class="card">' +
      Home.tbl(['Category', 'Units', 'NSV L', '%'], cat.slice(0, 12).map(function (c) {
        return [esc(c), Math.round(A.byCat[c].u), lakh(A.byCat[c].v),
          (A.nsv ? Math.round(A.byCat[c].v / A.nsv * 100) : 0) + '%']; })) + '</div>';

    var sub = Object.keys(A.bySub).sort(function (a, b) { return A.bySub[b].v - A.bySub[a].v; });
    h += '<div class="sec-title">Sub-category-wise</div><div class="card">' +
      Home.tbl(['Sub-category', 'Units', 'NSV L'], sub.slice(0, 12).map(function (c) {
        return [esc(c), Math.round(A.bySub[c].u), lakh(A.bySub[c].v)]; })) + '</div>';

    var sk = Object.keys(A.bySku).sort(function (a, b) { return A.bySku[b].v - A.bySku[a].v; });
    h += '<div class="sec-title">Top SKU</div><div class="card">' +
      Home.tbl(['#  Product', 'Units', 'NSV L'], sk.slice(0, 12).map(function (k, i) {
        var s = A.bySku[k];
        return [(i + 1) + '. <b>' + esc(s.name) + '</b><div class="hint">' + esc(s.brand) + '</div>',
          Math.round(s.u), lakh(s.v)]; })) + '</div>';
    return h;
  },

  /* ── 4. TEAM — me against the team, and against myself in each working mode ──
     A rep's device only ever holds their OWN rows, so the per-employee numbers come from a server
     aggregate (no other rep's raw data is ever sent). Admin/HOD already hold everything, so for them
     the same table is computed locally and needs no round trip. */
  teamHtml: function () {
    var r = Home.range();
    var T = Team.get(r[0], r[1]);
    if (T.wait) return '<div class="strip b"><span class="g"><span class="spin"></span></span>' +
      '<div class="m"><b>Team ka data aa raha hai…</b> <i>· sirf totals, kisi ka raw data nahi</i></div></div>';
    if (T.err) return '<div class="card"><div class="banner w"><span>!</span><div><b>Team view abhi ready nahi</b><br>' +
      '<span style="font-weight:500">' + esc(T.err) + '</span>' +
      '<div class="btns"><button class="btn sm" onclick="Team.load(true)">Dobara try karo</button></div></div></div></div>';

    var rows = (T.rows || []).slice();
    if (!rows.length) return '<div class="card">' + UI.empty('', 'Is period me team ka koi data nahi') + '</div>';

    var me = String(DB.me.code || '').toUpperCase();
    var v = function (e, k) { return num(e[k]); };
    rows.sort(function (a, b) { return v(b, 'nsv') - v(a, 'nsv') ||
      String(a.name || a.code).localeCompare(String(b.name || b.code)); });
    var mine = rows.filter(function (e) { return String(e.code).toUpperCase() === me; })[0];
    var rank = mine ? rows.indexOf(mine) + 1 : 0;
    var tot = { sc:0, tc:0, pc:0, nsv:0 };
    rows.forEach(function (e) { ['sc', 'tc', 'pc', 'nsv'].forEach(function (k) { tot[k] += v(e, k); }); });
    var n = rows.length || 1;

    var h = '<div class="kpis k3">' +
      UI.kpi(mine ? '#' + rank : '—', 'Team me rank (' + rows.length + ')', rank && rank <= 3 ? 'g' : 'b') +
      UI.kpi(mine ? lakh(v(mine, 'nsv')) : '0', 'Mera NSV ₹L', 'b') +
      UI.kpi(lakh(tot.nsv / n), 'Team average ₹L', mine && v(mine, 'nsv') >= tot.nsv / n ? 'g' : 'w') +
      '</div>';

    /* ── ONE table ──
       The salesman, then the four numbers everyone is judged on, for whatever period is selected —
       today, the stretch he picked, or the month. Everybody is listed, zero or not; and a day nobody
       was in the market for shows its letter instead of a row of zeros, because "Leave" and "did
       nothing" are not the same thing. */
    var MK = { L:'Leave', O:'Weekly off', M:'Meeting', H:'Holiday' };
    h += '<div class="sec-title">Team — ' + esc(Home.rangeLbl()) + '</div><div class="card">' +
      '<div class="tw"><table><thead><tr><th>Employee</th>' +
      '<th class="num">SC</th><th class="num">TC</th><th class="num">PC</th><th class="num">NSV ₹L</th>' +
      '</tr></thead><tbody>' +
      rows.map(function (e) {
        var mk = String(e.mark || '').toUpperCase().slice(0, 1);
        var away = mk && MK[mk] && !v(e, 'tc') && !v(e, 'nsv');
        var isMe = String(e.code).toUpperCase() === me;
        var cell = function (k, money) {
          if (away) return '<td class="num"><span class="pill p-grey" title="' + MK[mk] + '">' + mk + '</span></td>';
          return '<td class="num">' + (money ? lakh(v(e, k)) : String(Math.round(v(e, k)))) + '</td>';
        };
        return '<tr' + (isMe ? ' class="me"' : '') + '><td>' +
          (isMe ? '<b>' + esc(e.name || e.code) + '</b> <span class="pill p-blue">You</span>'
                : esc(e.name || e.code)) +
          '<div class="hint">' + esc(e.code) + (e.hq ? ' · ' + esc(e.hq) : '') + '</div></td>' +
          cell('sc') + cell('tc') + cell('pc') + cell('nsv', true) + '</tr>';
      }).join('') +
      '<tr class="tot"><td><b>TEAM TOTAL</b></td>' +
      '<td class="num"><b>' + Math.round(tot.sc) + '</b></td>' +
      '<td class="num"><b>' + Math.round(tot.tc) + '</b></td>' +
      '<td class="num"><b>' + Math.round(tot.pc) + '</b></td>' +
      '<td class="num"><b>' + lakh(tot.nsv) + '</b></td></tr>' +
      '</tbody></table></div>' +
      '<div class="hint" style="margin-top:8px">SC = scheduled calls (plan), TC = total calls, ' +
      'PC = productive calls, NSV ₹ lakh. <b>L</b> = leave, <b>O</b> = weekly off, <b>M</b> = meeting — ' +
      'us din market me nahi the. Sab employee dikhte hain, zero ho ya na ho.</div>' +
      '</div>';
    return h;
  }
};

/* ═══════════════ TEAM aggregate ═══════════════
   The one place that knows how to get per-employee numbers without shipping anyone's raw rows:
     • admin / HOD → computed locally, they already hold every row;
     • employee    → one small GET (`action=team`) that returns totals only.
   Cached per date-range so switching metric or tab does not re-fetch. */
var Team = {
  cache:{}, busy:'',
  key: function (f, t) { return f + '|' + t; },
  /* An older deployment of backend.gs returns per-bucket totals only (no flat sc/tc/pc/nsv). The table
     is flat now, so fill the flat numbers in from the buckets rather than showing a screen of zeros
     until the sheet's script is re-deployed. SC simply is not there to be had. */
  flat: function (rows) {
    (rows || []).forEach(function (e) {
      if (e.tc !== undefined || !e.b) return;
      e.tc = 0; e.pc = 0; e.nsv = 0; e.mrp = 0; e.nso = 0;
      Object.keys(e.b).forEach(function (k) {
        var b = e.b[k] || {};
        e.tc += num(b.tc); e.pc += num(b.pc); e.nsv += num(b.nsv); e.mrp += num(b.mrp); e.nso += num(b.nso);
      });
      e.nsv = Math.round(e.nsv * 10000) / 10000;
      if (e.sc === undefined) e.sc = 0;
      if (e.startDays === undefined) e.startDays = 0;
      e.old = true;                                   /* so the screen can say SC is unavailable */
    });
    return rows;
  },
  get: function (f, t) {
    if (Auth.isAdmin()) return { rows:Team.local(f, t), at:DB.pulledAt };
    var k = Team.key(f, t), c = Team.cache[k];
    if (c) return c;
    if (Team.busy !== k) Team.load(false, f, t);
    return { wait:true };
  },
  load: function (loud, f, t) {
    var r = Home.range(); f = f || r[0]; t = t || r[1];
    var k = Team.key(f, t), s = Auth.session();
    if (!s) return;
    if (loud) delete Team.cache[k];
    Team.busy = k;
    return Api.get({ action:'team', email:s.email, from:f, to:t }).then(function (res) {
      Team.busy = '';
      if (!res || !res.ok) {
        Team.cache[k] = { err:(res && res.error) || 'Server ne mana kar diya — backend.gs dobara deploy karna pad sakta hai' };
      } else {
        Team.cache[k] = { rows:Team.flat(res.rows || []), at:Date.now() };
      }
      if (Router.cur === 'home' && Home.sub() === 'team') render();
    }, function () {
      Team.busy = '';
      Team.cache[k] = { err:'Internet nahi mila — refresh karke dobara try karo' };
      if (Router.cur === 'home' && Home.sub() === 'team') render();
    });
  },
  /* admin / HOD path — the SAME shape the endpoint returns, computed locally because they already
     hold every row. Every employee appears, zero or not. */
  KIND: function (ww) {
    var w = String(ww || '');
    if (/sick leave|leave/i.test(w)) return 'L';
    if (/weekly off|off day|sunday/i.test(w)) return 'O';
    if (/holiday/i.test(w)) return 'H';
    if (/meeting|activity/i.test(w)) return 'M';
    if (Home.FIELD.test(w)) return 'F';
    return '';
  },
  local: function (f, t) {
    var inR = function (d) { var x = toISO(d); return !!x && x >= f && x <= t; };
    var one = f === t, sc0 = num(DB.cfg('SC_Call_Target', 7)) || 7;
    var out = {}, bk = {}, kind = {};
    var ens = function (code, name, hq) {
      var k = String(code || 'UNK').toUpperCase();
      if (!out[k]) { out[k] = { code:k, name:name || '', hq:hq || '', sc:0, tc:0, pc:0, nsv:0, mrp:0, nso:0,
          fieldDays:0, startDays:0, leave:0, off:0, meet:0, mark:'', b:{} };
        ['self','team','ba','other'].forEach(function (x) { out[k].b[x] = { days:0, tc:0, pc:0, nsv:0, mrp:0, nso:0 }; }); }
      if (name && !out[k].name) out[k].name = name;
      if (hq && !out[k].hq) out[k].hq = hq;
      return out[k];
    };
    (DB.m.Master_Employees || []).forEach(function (e) { ens(e.Code, e.Name, e.HQ); });
    DB.rows('DayPlan').forEach(function (p) {
      var d = toISO(p.Date); if (!d) return;
      var c = String(p.EmpCode).toUpperCase();
      bk[c + '|' + d] = Home.bucket(p.WorkingWith);
      if (!inR(d)) return;
      var k = Team.KIND(p.WorkingWith);
      kind[c + '|' + d] = k;
      var e = ens(c, p.EmpName, p.Hq);
      /* the day counts as STARTED only once the WhatsApp plan went out */
      if (Plan.started(p)) e.startDays++;
      if (k === 'F') { e.fieldDays++; e.sc += num(p.ScTarget) || sc0; }
      else if (k === 'L') e.leave++;
      else if (k === 'O' || k === 'H') e.off++;
      else if (k === 'M') e.meet++;
    });
    (DB.m.Master_PJP || []).forEach(function (r) {
      var d = toISO(r.Date); if (!d || !inR(d)) return;
      var c = String(r.Code || '').toUpperCase();
      if (kind[c + '|' + d]) return;
      var k = Team.KIND(r.Ww || r.Week);
      kind[c + '|' + d] = k;
      var e = ens(c, '', r.Hq);
      if (k === 'F') { e.fieldDays++; e.sc += sc0; }
      else if (k === 'L') e.leave++;
      else if (k === 'O' || k === 'H') e.off++;
      else if (k === 'M') e.meet++;
    });
    var seen = {};
    DB.rows('SecOrders').forEach(function (o) {
      if (!inR(o.Date)) return;
      var code = String(o.EmpCode || '').toUpperCase(), d = toISO(o.Date);
      var e = ens(code, o.EmpName), b = e.b[bk[code + '|' + d] || 'other'];
      e.tc++; b.tc++;
      if (!seen[code + '|' + d]) { seen[code + '|' + d] = 1; b.days++; }
      if (Home.cancelled(o.Status)) return;
      if (num(o.TotUnits) > 0) { e.pc++; b.pc++; }
      e.nsv += num(o.TotNsvLakh); b.nsv += num(o.TotNsvLakh);
      e.mrp += num(o.TotValue); b.mrp += num(o.TotValue);
    });
    DB.rows('NewStores').forEach(function (r) {
      if (!inR(r.Date)) return;
      var code = String(r.EmpCode || '').toUpperCase(), e = ens(code, r.EmpName);
      e.nso++;
      e.b[bk[code + '|' + toISO(r.Date)] || 'other'].nso++;
    });
    return Object.keys(out).map(function (k) { return out[k]; }).map(function (e) {
      if (!e.fieldDays) {
        e.mark = one ? (kind[e.code + '|' + f] || '')
          : (e.leave ? 'L' : e.off ? 'O' : e.meet ? 'M' : '');
        if (e.mark === 'F') e.mark = '';
      }
      return e;
    });
  }
};

/* ═══════════════ PJP — month beat plan ═══════════════ */
var Pjp = {
  month:'', days:null,
  /* ── the month this device is holding was deleted on the sheet ──
     A pull replaces every table, so the row is gone; but Pjp.days still holds the month in memory and
     Pjp.full() writes the WHOLE month on the next flush — which would re-create exactly what an admin
     removed. Unsaved typing is kept while the tab is still open to him; anything else is forgotten. */
  reconcile: function () {
    if (!Pjp.days || !Pjp.month) return false;
    if (DB.find('PjpDraft', Pjp.key())) return false;
    if (Pjp._dirty && Gate.allowed('pjp')) return false;
    Pjp.days = null; Pjp.loadedKey = ''; Pjp.hydratedAt = 0; Pjp._dirty = false;
    delete Flush.jobs.pjp;
    return true;
  },
  key: function () { return DB.me.code + '__' + Pjp.month; },
  draft: function () {
    var r = DB.find('PjpDraft', Pjp.key());
    if (!r) return { Key:Pjp.key(), EmpCode:DB.me.code, EmpName:DB.me.name, Month:Pjp.month, Status:'Draft', DaysJson:'{}' };
    return r;
  },
  /* Hydrate the in-memory day map ONCE per employee+month.
     It used to re-read DaysJson on every render — and because changing a dropdown re-renders, the
     rep's choice was instantly overwritten by the last saved copy, so nothing looked changeable.
     Now the sheet only re-hydrates when the month/employee changes, or when a NEWER draft arrives
     from the sheet while nothing local is unsaved (so another device's edit still wins, but never
     on top of what is being typed right now). */
  loadedKey:'', hydratedAt:0,
  load: function () {
    if (!Pjp.month) Pjp.month = Pjp.winMonth();
    var dr = Pjp.draft(), k = Pjp.key();
    var remote = +dr.UpdatedAt || 0;
    var stale = (Pjp.loadedKey !== k) || (!Pjp._dirty && remote > Pjp.hydratedAt);
    if (stale || !Pjp.days) {
      try { Pjp.days = JSON.parse(dr.DaysJson || '{}') || {}; } catch (e) { Pjp.days = {}; }
      /* Normalise every stored Working-With to a current option. Drafts saved before the label was
         shortened hold "Weekly Off (Sunday)"; without this the <select> would match nothing and
         silently show "Self Working", quietly changing what the rep had planned. */
      Object.keys(Pjp.days).forEach(function (d) {
        var r = Pjp.days[d]; if (!r) return;
        r.ww = Pjp.ww(r.ww || (new Date(d + 'T00:00:00').getDay() === 0 ? 'Weekly Off' : 'Self Working'));
      });
      /* ── Master_PJP flows in on its own ──
         Whatever the admin has already published for this rep and month IS the approved plan for those
         days, so it is loaded without anybody pressing anything (there used to be a "PJP se auto-fill"
         button for this, which meant a rep who never found it saw an empty month next to a master full
         of days). The master WINS over the draft on a published day — those days are read-only, so the
         draft cannot be the truth for them — except a day an HOD has explicitly sent back to be fixed,
         which is the one case the rep's own edit is the point. */
      var sentBack0 = {};
      Pjp.rejDays().forEach(function (k) { sentBack0[k] = 1; });
      DB.pjpMonth(DB.me.code, Pjp.month).forEach(function (r) {
        var d = toISO(r.Date); if (!d || sentBack0[d]) return;
        Pjp.days[d] = { ww:Pjp.ww(r.Ww), state:Plan.stateFor(null, r, r.Town),
          city:r.Town || '', beat:r.Beat || '', st:Pjp.stn(r.Station),
          rmk:r.Remarks || (Pjp.days[d] || {}).rmk || '' };
      });
      /* A day before this rep JOINED is not theirs to plan: the day list already refuses to render an
         input for it, but a day could still arrive here from an older draft or from Master_PJP — and
         DaysJson is what gets published back into the master on approval. Drop them at the source. */
      var doj0 = DB.doj(DB.me.code);
      if (doj0) Object.keys(Pjp.days).forEach(function (d) { if (d < doj0) delete Pjp.days[d]; });
      Pjp.loadedKey = k;
      Pjp.hydratedAt = remote || Date.now();
    }
    return dr;
  },
  ww: function (v) { var W = ['Self Working','ME Sales Team','BA Supervisor','Meeting / Activity','Weekly Off','Leave','Sick Leave','HO Holiday'];
    var s = String(v || '').trim();
    if (W.indexOf(s) >= 0) return s;
    if (/sunday|weekly/i.test(s)) return 'Weekly Off';
    if (/sick/i.test(s)) return 'Sick Leave';
    if (/leave/i.test(s)) return 'Leave';
    if (/meeting|activity/i.test(s)) return 'Meeting / Activity';
    if (/holiday/i.test(s)) return 'HO Holiday';
    if (/ba/i.test(s)) return 'BA Supervisor';
    if (/team/i.test(s)) return 'ME Sales Team';
    return 'Self Working'; },
  isField: function (w) { return ['Self Working','ME Sales Team','BA Supervisor'].indexOf(w) >= 0; },
  isMeet: function (w) { return /meeting|activity/i.test(String(w || '')); },
  /* what "done" means for a day, whatever kind it is — a FIELD day needs Town + Beat, and nothing
     else needs anything. One rule, used by the month coverage check and by the partial re-send table.
     A Meeting / Activity day used to also demand its Remarks here: a month away, nobody yet knows what
     the meeting will be about, and being unable to say so blocked the whole plan from being sent. The
     remark is asked on the DAY instead — Plan.check() makes it compulsory there, where the rep
     actually knows the answer. */
  incomplete: function (r) {
    var ww = Pjp.ww((r && r.ww) || 'Self Working');
    if (Pjp.isField(ww)) return !((r.city || '').trim() && (r.beat || '').trim());
    return false;
  },
  /* ── where the day is worked, in the policy's words ──
     Filled by the rep for every field day (HQ unless he says otherwise) and carried all the way into
     Master_PJP, so the TA/DA claim never has to guess whether a day was a local day or a trip. */
  STN:['HQ', 'Ex-HQ', 'Outstation'],
  stn: function (v) {
    var t = String(v || '').trim();
    if (/^out/i.test(t)) return 'Outstation';
    if (/^ex/i.test(t) || /ex.?hq/i.test(t)) return 'Ex-HQ';
    return 'HQ';
  },
  /* ── partial rejection ──
     An HOD can send back three days instead of a whole month. Those days — and ONLY those days —
     open up again for the rep; the rest of the month is read-only, because it has already been
     accepted and re-typing it would only introduce new mistakes. */
  partial: function () { return /partial/i.test(String(Pjp.draft().Status || '')); },
  rejDays: function () {
    if (!Pjp.partial()) return [];
    return Admin.rejDays(Pjp.draft());
  },
  /* ── the days Master_PJP already holds ──
     A published day is a decided day. The admin may publish one day, a week, or the whole month, and
     whatever is in there is the approved truth — the rep fills the REST and must not be able to type
     over what is already settled. Keyed by ISO date, read straight from the master every time so a
     sync that brings a new day locks it on the very next render. */
  masterDays: function () {
    var out = {};
    DB.pjpMonth(DB.me.code, Pjp.month).forEach(function (r) {
      var d = toISO(r.Date); if (d) out[d] = r;
    });
    return out;
  },
  /* may the rep touch THIS day?  `md` is masterDays(), passed in so a 31-day list reads the master
     once instead of thirty-one times. */
  editable: function (d, md) {
    var dr = Pjp.draft(), st = String(dr.Status || '');
    if (/approved|accepted/i.test(st)) return false;
    if (Pjp.partial()) return Pjp.rejDays().indexOf(d) >= 0;
    /* published in the master, and not one of the days an HOD has explicitly sent back */
    if ((md || Pjp.masterDays())[d]) return false;
    return true;
  },

  /* ── State → Town → Beat for one day ──
     State and Town come from the sheet (Master_Stores for this rep, plus whatever Master_PJP already
     holds), Town is filtered by the chosen State, and the Beat is typed by hand — a beat name is the
     rep's own words and no master can guess it. "add new…" is there so a town missing from the master
     can never block a month's plan. Repopulating the Town list is a DOM update, not a re-render, or
     the half-made choice on every other day row would be thrown away. */
  /* the Meeting/Activity twin of geo() — one required box instead of State/Town/Beat */
  rmk: function (d, r) {
    var q = "'" + d + "'";
    return '<label class="f">Remarks <span class="hint">(optional — din par poochha jayega)</span></label>' +
      '<textarea class="in" rows="2" id="pj_rmk_' + d + '" placeholder="Abhi pata ho to likho, warna chhod do" ' +
      'oninput="Pjp.set(' + q + ',\'rmk\',this.value)" onchange="Pjp.touch()">' + esc(r.rmk || '') + '</textarea>';
  },
  geo: function (d, r) {
    var st = r.state || Plan.stateOf(r.city) || (Plan.states()[0] || '');
    var q = "'" + d + "'";
    return '<div class="row two" style="margin-top:8px">' +
      '<div><label class="f">State</label>' + Pjp.sel(d, 'state', Plan.states(), st) + '</div>' +
      '<div><label class="f">Town / City</label>' + Pjp.sel(d, 'city', Plan.towns(st), r.city || '') + '</div>' +
      '</div>' +
      '<label class="f">Beat / Market <span class="hint">(khud likho)</span></label>' +
      '<input class="in" id="pj_beat_' + d + '" placeholder="Beat / market ka naam" value="' + esc(r.beat || '') +
      '" oninput="Pjp.set(' + q + ',\'beat\',this.value)" onchange="Pjp.touch()">';
  },
  sel: function (d, kind, list, cur) {
    var isNew = !!cur && list.indexOf(cur) < 0;
    var q = "'" + d + "','" + kind + "'";
    return '<select class="in" id="pj_' + kind + '_' + d + '" onchange="Pjp.pick(' + q + ',this)">' +
      '<option value="">— select —</option>' +
      list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
      '<option value="' + Plan.ADD + '"' + (isNew ? ' selected' : '') + '>add new…</option></select>' +
      '<input class="in" id="pj_' + kind + 'n_' + d + '" style="margin-top:5px;display:' + (isNew ? '' : 'none') +
      '" placeholder="Naya ' + esc(kind === 'city' ? 'town' : kind) + ' likho" value="' + (isNew ? esc(cur) : '') +
      '" oninput="Pjp.set(\'' + d + '\',\'' + kind + '\',this.value)">';
  },
  pick: function (d, kind, el) {
    var box = $('pj_' + kind + 'n_' + d);
    if (box) box.style.display = el.value === Plan.ADD ? '' : 'none';
    if (el.value === Plan.ADD) { if (box) { box.focus(); Pjp.set(d, kind, box.value); } return; }
    Pjp.set(d, kind, el.value);
    if (kind === 'city') Pjp.touch();
    /* a new State means a different Town list — rebuild that one select in place */
    if (kind === 'state') {
      var ts = $('pj_city_' + d); if (!ts) return;
      var list = Plan.towns(el.value), cur = (Pjp.days[d] || {}).city || '';
      ts.innerHTML = I18n.tr('<option value="">— select —</option>' +
        list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
        '<option value="' + Plan.ADD + '">add new…</option>');
      if (list.indexOf(cur) < 0) { ts.value = ''; Pjp.set(d, 'city', ''); }
    }
  },
  dates: function () {
    var a = Pjp.month.split('-'), y = +a[0], m = +a[1], n = new Date(y, m, 0).getDate(), out = [];
    for (var d = 1; d <= n; d++) out.push(y + '-' + p2(m) + '-' + p2(d));
    return out;
  },
  /* days before joining are not this rep's to plan */
  planDates: function () { var doj = DB.doj(DB.me.code);
    return Pjp.dates().filter(function (d) { return !doj || d >= doj; }); },
  /* A day needs planning only if its Working-With is a FIELD type. Off / Leave / Meeting days are
     complete by definition, and a Sunday the rep marks as Self Working DOES count. */
  cover: function () {
    var need = 0, done = 0, miss = [], off = 0;
    Pjp.planDates().forEach(function (d) {
      var sun = new Date(d + 'T00:00:00').getDay() === 0;
      var r = Pjp.days ? Pjp.days[d] : null;
      var ww = (r && r.ww) || (sun ? 'Weekly Off' : 'Self Working');
      if (!Pjp.isField(ww)) { off++; return; }
      need++;
      if (r && (r.city || '').trim() && (r.beat || '').trim()) done++; else miss.push(+d.slice(8, 10));
    });
    return { need:need, done:done, miss:miss, off:off };
  },
  /* ── the 27th-to-1st window ──
     A PJP for month M is filled between the 27th of M-1 and the 1st of M; that is when the PJP tab
     lights up in the nav. The moment HOD APPROVES it the tab closes and stays closed until the next
     27th. Until it is approved the rep may keep editing and re-send as often as he needs — each
     re-send replaces the previous request, so HOD never has two live copies to judge. */
  winMonth: function () {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    var y = t.getFullYear(), m = t.getMonth();
    if (t.getDate() >= 27) { m++; if (m > 11) { m = 0; y++; } }
    return y + '-' + p2(m + 1);
  },
  winOpen: function () { var d = new Date().getDate(); return d >= 27 || d === 1; },
  /* the window for month M closes on the 1st of M — the date the gate measures "too late" against */
  winShut: function () { return Pjp.winMonth() + '-01'; },
  approvedFor: function (mo) {
    var r = DB.find('PjpDraft', DB.me.code + '__' + mo);
    return !!(r && /approved|accepted/i.test(r.Status || ''));
  },
  /* editable = not yet approved. That is the whole rule: an unapproved plan is still the rep's job,
     whatever the date, and an approved one is finished. */
  windowOpen: function () {
    if (Auth.isAdmin() || Bypass.on()) return true;
    return !Pjp.approvedFor(Pjp.month);
  },
  html: function () {
    var dr = Pjp.load(), c = Pjp.cover(), doj = DB.doj(DB.me.code);
    /* only an APPROVED plan is frozen. While it is merely pending the rep can still edit and re-send:
       the new request supersedes the old one. */
    var lockAll = /approved|accepted/i.test(dr.Status || '');
    var locked = lockAll;                        /* the header still asks "is the month frozen?" */
    var pend = /pending/i.test(dr.Status || '');
    var part = Pjp.partial(), rejD = Pjp.rejDays();
    var h = UI.head('', 'Monthly PJP', 'Poore month ka beat plan — har din ka town aur beat bharo. <b>Auto-save on</b>, duplicate nahi banega.');
    h += '<div class="card"><label class="f">Month</label>' +
      '<input class="in" type="month" id="pjp_m" value="' + Pjp.month + '" onchange="Pjp.setMonth(this.value)">' +
      '<div class="kpis" style="margin-top:12px">' +
        UI.kpi(c.done + '/' + c.need, 'Field days filled', 'b') +
        UI.kpi((c.need ? Math.round(c.done / c.need * 100) : 0) + '%', 'Complete', c.done === c.need ? 'g' : 'w') +
        UI.kpi(c.miss.length, 'Pending', c.miss.length ? 'r' : 'g') + UI.kpi(c.off, 'Off / Leave', '') +
        UI.kpi(esc(dr.Status || 'Draft'), 'Status', locked ? 'g' : '') + '</div>' +
      '<div class="hint" style="margin-top:8px"> Har change turant <b>PjpDraft</b> tab me save hota hai (ek hi row per month — duplicate nahi banti). Approve hone par har din ki alag row <b>Master_PJP</b> me chali jayegi.</div>' +
      (dr.PublishedAt ? '<div class="banner g" style="margin-top:10px"><span></span><div>Ye plan <b>Master_PJP me publish</b> ho chuka hai (' + esc(dr.PublishedRows || '') + ' din).</div></div>' : '') +
      (doj ? '<div class="hint" style="margin-top:8px"> Joining' + dmy(doj) + ' — usse pehle ke din plan me count nahi hote.</div>' : '') +
      (Pjp.winOpen() && !locked ? '<div class="banner w" style="margin-top:10px"><span>!</span><div><b>PJP window khuli hai (27 se 1 tarikh)</b><br>' +
        '<span style="font-weight:500">' + esc(monthName(Pjp.winMonth())) + ' ka plan abhi bhar ke HOD ko bhej do.</span></div></div>' : '') +
      (locked ? '<div class="banner g" style="margin-top:10px"><span></span><div><b>' + esc(monthName(Pjp.month)) + ' approve ho gaya</b><br>' +
        '<span style="font-weight:500">Ab is month me change nahi hoga. Agli PJP <b>27</b> tarikh se khulegi.</span></div></div>' : '') +
      (part ? '<div class="banner r" style="margin-top:10px"><span>!</span><div><b>' + rejD.length +
        ' din reject hue hain</b><br><span style="font-weight:500">' +
        rejD.map(function (k) { return dmy(k); }).join(', ') +
        (dr.RejectReason ? ' — ' + esc(dr.RejectReason) : '') +
        '<br>Sirf yeh din edit ho sakte hain — baaki month approve hai. Theek karke dobara bhej do.</span></div></div>' : '') +
      (pend ? '<div class="banner b" style="margin-top:10px"><span></span><div><b>HOD ke paas hai</b><br>' +
        '<span style="font-weight:500">Approve hone tak aap edit karke dobara bhej sakte ho — naya request purane ko replace kar dega.</span></div></div>' : '') +
      '</div>';

    /* resumed-work banner: the draft came back from the sheet, so nothing needs refilling */
    if (c.done && !locked && !part)
      h += '<div class="banner b"><span></span><div><b>' + c.done + ' din pehle se bhare hue hain</b> — wahi wapas load kiye hain, dobara bharne ki zaroorat nahi.' +
        (dr.UpdatedAt ? ' <span class="hint">(last save: ' + esc(new Date(+dr.UpdatedAt).toLocaleString('en-IN')) + ')</span>' : '') + '</div></div>';
    if (c.miss.length && !locked && !part)
      h += '<div class="banner w"><span>!</span><div>' + c.miss.length + ' din pending hai (' + monthName(Pjp.month).split(' ')[0] + ' ' + c.miss.join(', ') + '). Har working day me City + Beat bharo ya Off karo.</div></div>';
    if (c.miss.length === 0 && !locked && !part)
      h += '<div class="banner g"><span></span><div>Poora month plan ho gaya — ab HOD ko bhej sakte ho.</div></div>';
    if (locked)
      h += '<div class="banner b"><span></span><div>Ye PJP <b>' + esc(dr.Status) + '</b> hai' + (dr.RejectReason ? ' — ' + esc(dr.RejectReason) : '') + '. Change karna ho to HOD se baat karo.</div></div>';

    /* the master's days are loaded on their own now (see Pjp.load) — read once for the whole list */
    var md = Pjp.masterDays(), mdN = Object.keys(md).length;
    if (mdN && !locked)
      h += '<div class="banner b"><span></span><div><b>' + mdN + ' din PJP me pehle se approve hain</b>' +
        '<br><span style="font-weight:500">Wo din apne aap aa gaye hain aur <b>lock</b> hain — change ' +
        'nahi honge. Baaki din aap bharo.</span></div></div>';

    h += '<div class="sec-title">Din-wise plan</div>';
    var dn = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    Pjp.dates().forEach(function (d) {
      var dd = +d.slice(8, 10), dow = new Date(d + 'T00:00:00').getDay(), sun = dow === 0;
      if (doj && d < doj) {
        h += '<div class="card" style="opacity:.6;padding:10px 14px"><div class="lrow" style="padding:0;border:0">' +
          '<div class="m"><div class="t">' + p2(dd) + ' ' + monthName(Pjp.month).split(' ')[0] + ' <span class="hint">' + dn[dow] + '</span></div>' +
          '<div class="s">Joining se pehle — plan required nahi</div></div><span class="pill p-grey">—</span></div></div>';
        return;
      }
      var r = Pjp.days[d] || { ww:sun ? 'Weekly Off' : 'Self Working', state:'', city:'', beat:'', st:'HQ' };
      /* A partially rejected month is locked EXCEPT on the days that came back; and a day already
         published in Master_PJP is locked whatever the draft says. */
      var locked = lockAll || !Pjp.editable(d, md);
      var sentBack = rejD.indexOf(d) >= 0;
      /* locked by the MASTER specifically (not merely by a whole-month approval) — worth naming on the
         row, because this is the one lock a rep meets on a month he is otherwise still filling */
      var fromMaster = !lockAll && !sentBack && !!md[d];
      /* Whether Town/Beat are needed depends ONLY on the Working-With value, never on the weekday.
         It used to be `isField(ww) && !sun`, so a Sunday switched to Self Working showed no inputs. */
      var f = Pjp.isField(r.ww), meet = Pjp.isMeet(r.ww);
      /* OFF means WEEKLY OFF and nothing else. A meeting, an activity or a leave day is not a field
         day either, but calling it "OFF" is wrong — it is time worked, just not on a beat. */
      var off = /weekly off/i.test(r.ww);
      var tag = f ? 'WK-' + Math.min(4, Math.floor((dd - 1) / 7) + 1)
        : off ? 'OFF' : /meeting|activity/i.test(r.ww) ? 'MEETING'
        : /sick/i.test(r.ww) ? 'SICK' : /leave/i.test(r.ww) ? 'LEAVE'
        : /holiday/i.test(r.ww) ? 'HOLIDAY' : 'OTHER';
      h += '<div class="card" style="padding:12px 14px;background:' +
        (sentBack ? '#fff6f5' : fromMaster ? '#f6f8fc' : (f ? '#fff' : (off ? '#fbfaf5' : '#fffaf8'))) +
        (sentBack ? ';border-color:var(--bad)' : '') + '">' +
        (sentBack ? '<div class="hint" style="color:var(--bad);font-weight:700;margin-bottom:6px">' +
          'Ye din reject hua tha — theek karo</div>' : '') +
        (fromMaster ? '<div class="hint" style="font-weight:700;margin-bottom:6px">' +
          'Ye din PJP me approve ho chuka hai — lock hai, change nahi hoga</div>' : '') +
        '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
          '<div style="font-weight:700;font-size:13.5px;min-width:74px">' + p2(dd) + ' ' + monthName(Pjp.month).split(' ')[0] +
          ' <span class="hint" style="font-weight:500">' + dn[dow] + '</span></div>' +
          '<span class="pill ' + (f ? 'p-blue' : off ? 'p-grey' : 'p-warn') + '">' + tag + '</span>' +
          (fromMaster ? '<span class="pill p-ok">Approved</span>' : '') +
          (locked ? '<span class="pill p-blue">' + esc(r.ww) + '</span>'
            : '<select class="in" style="width:auto;flex:1;min-width:150px;padding:7px 30px 7px 10px;font-size:12.5px" onchange="Pjp.set(\'' + d + '\',\'ww\',this.value)">' +
              ['Self Working','ME Sales Team','BA Supervisor','Meeting / Activity','Weekly Off','Leave','Sick Leave','HO Holiday']
              .map(function (o) { return '<option value="' + o + '"' + (o === r.ww ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') +
          (f ? (locked ? '<span class="pill p-grey">' + esc(Pjp.stn(r.st)) + '</span>'
            : '<select class="in" style="width:auto;padding:7px 30px 7px 10px;font-size:12.5px" onchange="Pjp.set(\'' + d + '\',\'st\',this.value)">' +
              Pjp.STN.map(function (o) { return '<option value="' + o + '"' + (o === Pjp.stn(r.st) ? ' selected' : '') + '>' + o + '</option>'; }).join('') + '</select>') : '') +
        '</div>' +
        (f ? (locked ? '<div class="sub">' + esc(r.state ? r.state + ' · ' : '') + esc(r.city || '—') + ' · ' + esc(r.beat || '—') + '</div>'
          : Pjp.geo(d, r) +
            ((r.city || '').trim() && (r.beat || '').trim() ? '' : '<div class="hint" style="margin-top:5px;color:#b7791f">! Town aur Beat dono bharo — tabhi ye din complete hoga.</div>')) : '') +
        (meet ? (locked ? '<div class="sub">' + esc(r.rmk || '—') + '</div>' : Pjp.rmk(d, r)) : '') +
        /* a day the HOD sent back gets its own Save, so the rep can store one day at a time and see it */
        /* the save row: the state on the left, the button on the right, and a rule above it so it
           does not sit flush against the Beat field */
        (sentBack ? '<div class="dsave">' +
          '<span>' + (Pjp.savedAt[d] ? 'Save ho gaya · ' + esc(Pjp.savedAt[d])
            : 'Save nahi hua') + '</span>' +
          '<button class="btn ok sm" onclick="Pjp.saveDay(\'' + d + '\',this)">Save</button></div>' : '') +
        '</div>';
    });

    /* ── the end of a partial fix: save both days, then send the month back ──
       Two buttons in the order the work happens, with the state of each returned day spelled out, so
       nobody sends a month back with one day still half-typed. */
    if (part) {
      var gaps0 = Pjp.partialGaps();
      var ready = rejD.filter(function (k) { return gaps0.indexOf(k) < 0; });
      h += '<div class="card"><h3>Ab dobara bhejo</h3>' +
        '<div class="sub">Reject wale din theek karke <b>save</b> karo, phir HOD ko dobara bhejo.</div>' +
        '<div class="tw" style="margin-top:10px"><table><thead><tr><th>Din</th><th>Bhara</th><th>Save</th></tr></thead><tbody>' +
        rejD.map(function (k) {
          var r2 = Pjp.days[k] || {}, ok = ready.indexOf(k) >= 0;
          return '<tr><td>' + dmy(k) + '</td>' +
            '<td>' + (ok ? '<span class="pill p-ok">Poora</span>' : '<span class="pill p-bad">Adhoora</span>') + '</td>' +
            '<td>' + (Pjp.savedAt[k] ? esc(Pjp.savedAt[k]) : '<span class="hint">—</span>') + '</td></tr>';
        }).join('') + '</tbody></table></div>' +
        '<div class="btns"><button class="btn ok" onclick="Pjp.saveAll(this)">Sab save karo</button></div>' +
        '<div class="btns"><button class="btn" onclick="Pjp.submit(this)"' +
          (ready.length === rejD.length ? '' : ' disabled') + '>HOD ko dobara bhejo</button></div>' +
        (ready.length === rejD.length ? '' :
          '<div class="hint" style="margin-top:6px;color:#b7791f">! Pehle har reject wale din ka Town aur ' +
          'Beat bharo — tabhi dobara bhej paoge.</div>') + '</div>';
    }

    /* ── the end of the month list: SAVE, then SEND ──
       Both used to sit in a card ABOVE thirty-one day rows, which is the one place a rep is not looking
       when he finishes typing the last day. They belong here, in the order the work happens: save what
       is on screen, then hand the month to the HOD. Autosave still runs on its own 1.2s debounce —
       Save is the button that says so out loud. */
    if (!part && !locked) {
      var blocked = (c.miss.length && !Bypass.on()) || !c.need || !Pjp.windowOpen();
      h += '<div class="card"><h3>PJP save karke HOD ko bhejo</h3>' +
        '<div class="sub">' + c.done + '/' + c.need + ' field din bhare hain' +
          (c.off ? ' · ' + c.off + ' din off / leave / meeting' : '') +
          (mdN ? ' · ' + mdN + ' din pehle se approved' : '') + '.</div>' +
        '<div class="btns"><button class="btn ok" onclick="Pjp.saveNow(this)">Save karo</button></div>' +
        '<div class="btns"><button class="btn" id="pjp_sub" onclick="Pjp.submit(this)"' +
          (blocked ? ' disabled' : '') + '>' +
          (pend ? 'Dobara bhejo (' + (num(dr.Revision) + 1) + ')' :
           (c.miss.length && Bypass.on()) ? 'Adhoora hi bhej do (bypass)' : 'HOD ko bhejo') + '</button></div>' +
        (Pjp.savedNow ? '<div class="hint" style="margin-top:6px">Save ho gaya · ' + esc(Pjp.savedNow) + '</div>'
          : (dr.UpdatedAt ? '<div class="hint" style="margin-top:6px">Last save: ' +
              esc(new Date(+dr.UpdatedAt).toLocaleString('en-IN')) + '</div>' : '')) +
        (c.miss.length && !Bypass.on() ?
          '<div class="hint" style="margin-top:6px;color:#b7791f">! ' + c.miss.length +
          ' field din ka Town aur Beat baaki hai (' + monthName(Pjp.month).split(' ')[0] + ' ' +
          c.miss.join(', ') + ') — tabhi bhej paoge.</div>' : '') +
        (!Pjp.windowOpen() ? '<div class="hint" style="margin-top:6px;color:#b7791f">! ' +
          'Ye month approve ho chuka hai — bhejna band hai.</div>' : '') + '</div>';
    }
    return h;
  },
  after: function () { Flush.reg('pjp', Pjp.flush); },
  setMonth: function (m) { Pjp.flush(); Pjp.month = m; Pjp.days = null; Pjp.loadedKey = ''; Pjp.hydratedAt = 0; render(); },
  set: function (d, k, v) {
    if (!Pjp.days) Pjp.load();
    /* a day the master has already decided is not the rep's to change — the row renders read-only, and
       this is the second lock, so a stale render or a hand-typed console call cannot get past it */
    if (!Pjp.editable(d)) return toast('Ye din PJP me approve ho chuka hai — change nahi hoga');
    if (!Pjp.days[d]) Pjp.days[d] = { ww:(new Date(d + 'T00:00:00').getDay() === 0 ? 'Weekly Off' : 'Self Working'), state:'', city:'', beat:'', st:'HQ' };
    Pjp.days[d][k] = k === 'ww' ? Pjp.ww(v) : v;
    Pjp._dirty = true;
    clearTimeout(Pjp._t);
    if (k === 'ww' || k === 'st') { Pjp.flush(); render(); }        /* dropdown = discrete choice, save now */
    else Pjp._t = setTimeout(Pjp.flush, 1200);                      /* typing = debounce */
  },
  /* which days the rep has explicitly saved in this sitting — shown on the row, so "did it save?"
     is answerable without leaving the screen */
  savedAt:{},
  /* an explicit Save. Autosave already runs on a 1.2s debounce, but a rep fixing two rejected days
     wants to SEE that both are stored before he sends the month back. */
  /* the send-again summary has to be honest about what is filled. A re-render on every keystroke
     would steal the caret, so it happens when a returned day loses focus — and only in the partial
     flow, where there are two or three rows, not thirty-one. */
  touch: function () { if (!Pjp.partial()) return; Pjp.flush(); render(); },
  saveDay: function (d, el) {
    Pjp._dirty = true;
    var p = Pjp.flush();
    Pjp.savedAt[d] = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    return Busy.run('pjpsave_' + d, el, 'Save\u2026', function () {
      return (p || Promise.resolve()).then(function () { render(); toast('Save ho gaya'); });
    });
  },
  saveAll: function (el) {
    Pjp._dirty = true;
    var p = Pjp.flush(), now = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    Pjp.rejDays().forEach(function (d) { Pjp.savedAt[d] = now; });
    return Busy.run('pjpsaveall', el, 'Save\u2026', function () {
      return (p || Promise.resolve()).then(function () { render(); toast('Sab din save ho gaye'); });
    });
  },
  /* the whole month, on demand. Autosave has almost certainly already written it; this is the button
     that lets a rep SEE that before he hands the month over, which is the one thing the debounce
     cannot say for itself. */
  savedNow:'',
  saveNow: function (el) {
    Pjp._dirty = true;
    var p = Pjp.flush();
    Pjp.savedNow = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    return Busy.run('pjpsavenow', el, 'Save\u2026', function () {
      return (p || Promise.resolve()).then(function () { render(); toast('Poora month save ho gaya'); });
    });
  },
  /* Merge over what the sheet already holds. Pjp.days only ever contains the days this device has
     loaded or touched; writing it raw could replace a full month with the two days being fixed. */
  merged: function () {
    var out = {};
    try { out = JSON.parse(Pjp.draft().DaysJson || '{}') || {}; } catch (e) { out = {}; }
    Object.keys(Pjp.days || {}).forEach(function (k) { out[k] = Pjp.days[k]; });
    return out;
  },
  /* ── the whole month, always ──
     What gets published is DaysJson, and DaysJson used to hold only the days that existed as objects —
     the ones the rep had touched. Every untouched day (a Sunday he never opened, a day left on its
     default) was simply absent, so it never reached Master_PJP; and a draft thinned by an older build
     stayed thin for ever. This fills in every planned date of the month from, in order: what is in
     memory, what the sheet already holds, what the master already holds, and the default a fresh day
     would show — which is exactly what the rep is looking at on screen. */
  full: function () {
    var out = Pjp.merged(), master = {};
    DB.pjpMonth(DB.me.code, Pjp.month).forEach(function (r) { master[toISO(r.Date)] = r; });
    Pjp.planDates().forEach(function (d) {
      if (out[d] && (out[d].ww || out[d].city || out[d].beat)) {
        out[d].ww = Pjp.ww(out[d].ww || (new Date(d + 'T00:00:00').getDay() === 0 ? 'Weekly Off' : 'Self Working'));
        out[d].st = Pjp.stn(out[d].st);
        return;
      }
      var m = master[d];
      if (m) {
        out[d] = { ww:Pjp.ww(m.Ww || m.Week), state:Plan.stateFor(null, m, m.Town),
                   city:m.Town || '', beat:m.Beat || '', st:Pjp.stn(m.Station) };
        return;
      }
      /* never touched, never published: store what the screen shows for it */
      var sun = new Date(d + 'T00:00:00').getDay() === 0;
      out[d] = { ww:sun ? 'Weekly Off' : 'Self Working', state:'', city:'', beat:'', st:'HQ' };
    });
    /* a day before joining is not this rep's to plan, and must never be published */
    var doj = DB.doj(DB.me.code);
    if (doj) Object.keys(out).forEach(function (d) { if (d < doj) delete out[d]; });
    return out;
  },
  flush: function () {
    if (!Pjp._dirty || !Pjp.days) return null;
    Pjp._dirty = false;
    var c = Pjp.cover(), dr = Pjp.draft();
    return DB.save('PjpDraft', { Key:Pjp.key(), EmpCode:DB.me.code, EmpName:DB.me.name, Month:Pjp.month,
      Status:dr.Status || 'Draft', DaysJson:JSON.stringify(Pjp.full()),
      Coverage:c.done + '/' + c.need, UpdatedAt:Date.now() }, { quiet:true });
  },
  /* Pjp.autofill() is gone: Pjp.load() reads Master_PJP into the month on its own, so there is nothing
     left for a button to do. What the master holds also LOCKS those days — see Pjp.editable. */
  /* which returned days are still short of a Town or a Beat */
  partialGaps: function () {
    return Pjp.rejDays().filter(function (d) { return Pjp.incomplete((Pjp.days || {})[d] || {}); });
  },
  submit: function (el) {
    var c = Pjp.cover(), dr0 = Pjp.draft(), part = Pjp.partial();
    if (/approved|accepted/i.test(dr0.Status || '')) { render(); return toast('Ye month approve ho chuka hai'); }
    if (!c.need) return toast('Kam se kam ek field day plan karo');
    /* ── a partial re-send is judged ONLY on the days that came back ──
       The rest of the month is already approved and locked; asking for full-month coverage here made
       the rep re-plan work the HOD had accepted, and a real month can carry days the master left
       blank, which would block the re-send forever. */
    if (part) {
      var gaps = Pjp.partialGaps();
      if (gaps.length && !Bypass.on())
        return toast(gaps.map(function (d) { return dmy(d); }).join(', ') +
          ' — in dino ka Town/Beat ya Remarks bharo', 4200);
    } else if (c.miss.length && !Bypass.on()) return toast('Pehle poora month plan karo');
    /* Re-sending is allowed while the request is only PENDING — the rep fixes what HOD objected to
       and sends again; the new copy REPLACES the old one, which is why the HOD stamp and the reject
       reason are wiped and the revision is bumped. */
    var again = /pending|partial/i.test(dr0.Status || ''), rev = num(dr0.Revision) + 1;
    return UI.confirm({ icon:'', title:again ? 'Naya request bhejna hai?' : 'PJP HOD ko bhejna hai?',
      msg:'<b>' + esc(monthName(Pjp.month)) + '</b> ka plan — <b>' + c.done + '/' + c.need +
          ' field din</b> bhare hue hain.' +
          (again ? '<br>Purana request cancel ho jayega — HOD ko sirf yehi naya dikhega.'
                 : '<br>Approve hone tak aap edit karke dobara bhej sakte ho.'),
      ok:'Haan, bhej do', cancel:'Abhi nahi' }).then(function (go) {
      if (!go) return;
      Pjp._dirty = true;
      /* the days that came back are the days the HOD has to look at next — carry them across so the
         review can open on exactly those, highlighted */
      var fixed = part ? Pjp.rejDays() : [];
      return Busy.run('pjp_' + Pjp.key(), el, 'Bhej raha hai…', function () { return DB.save('PjpDraft', { Key:Pjp.key(), EmpCode:DB.me.code, EmpName:DB.me.name, Month:Pjp.month,
      Status:'Pending', DaysJson:JSON.stringify(Pjp.full()), Coverage:c.done + '/' + c.need,
      Revision:rev, HodAt:'', HodBy:'', HodRole:'', RejectReason:'', RejectedDaysJson:'',
      FixedDaysJson:fixed.length ? JSON.stringify(fixed) : '',
      SubmittedAt:new Date().toISOString(), UpdatedAt:Date.now() }).then(function () {
      Log.add('PJP', again ? 'Re-submitted r' + rev : 'Submitted', Pjp.month, c.done + '/' + c.need + ' days');
      render(); toast(again ? 'Naya request bheja — purana cancel' : 'PJP HOD ko chala gaya');
    }); });
    });
  }
};

/* ═══════════════ PLAN — today ═══════════════ */
var Plan = {
  id: function () { return DB.me.code + '_' + today(); },
  row: function () { return DB.find('DayPlan', Plan.id()) || {}; },
  dev: function () { return DB.find('Deviation', DB.me.code + '_' + today()); },

  /* ── Working-With options, labelled the way the previous app labelled them ── */
  WW:[['Self Working','Self Working'], ['ME Sales Team','With ME Sales Team'],
      ['BA Supervisor','With BA Supervisor'], ['Meeting / Activity','Meeting / Activity'],
      ['Weekly Off','Weekly Off'], ['Leave','Leave'], ['Sick Leave','Sick Leave'],
      ['HO Holiday','HO Holiday']],
  ACT:['Zero Day Meeting','Gate Meeting','HO Meeting','Market Activity','Exhibition',
       'KNOP Activity','Virtual Meeting','HR Meeting'],
  DUR:['Full Day','Half Day','1 hr','2 hrs','3 hrs','4 hrs','5 hrs','6 hrs'],

  /* The rep's choice is sticky for the day. It is NOT re-derived on every render — that was the
     R61/R62 bug class, where a re-render read the last saved copy back over a fresh choice. */
  wwSel:'', mode:'', dayKey:'',
  /* a new day (or a different rep in preview) must not inherit yesterday's transient choice */
  sync: function () {
    var k = (DB.me.code || '') + '_' + today();
    if (Plan.dayKey !== k) { Plan.dayKey = k; Plan.wwSel = ''; Plan.mode = ''; }
  },
  ww: function () {
    Plan.sync();
    if (Plan.wwSel) return Plan.wwSel;
    var r = Plan.row(), pjp = DB.pjpFor(DB.me.code, today());
    return Pjp.ww(r.WorkingWith || (pjp ? pjp.Ww : '') || 'Self Working');
  },
  setWw: function (v) { Plan.sync(); Plan.wwSel = v; render(); },
  /* PJP mode is only possible when an approved PJP exists for today */

  /* ── master-driven geography ── every dropdown is built from the sheet, and always offers
     "➕ Add new" so a rep is never stuck when the master has nothing for them ── */
  ADD:'__add__',
  uniq: function (a) { var s = {}, o = []; a.forEach(function (x) {
    x = String(x == null ? '' : x).trim(); if (x && !s[x.toUpperCase()]) { s[x.toUpperCase()] = 1; o.push(x); } });
    return o.sort(); },
  /* ── the geo mapping, for ANY employee ──
     The rep's own screens ask about themselves; an HOD editing a rep's plan has to be offered the
     REP's states and towns, not their own. One implementation, an optional code. */
  empStores: function (code) {
    if (!code || String(code).toUpperCase() === String(DB.me.code || '').toUpperCase()) return DB.myStores();
    var e = DB.emp(code) || {};
    var nm = String(e.Name || '').toUpperCase().replace(/\s+/g, ' ').trim(), cd = String(code).toUpperCase();
    var all = DB.m.Master_Stores || [];
    var mine = all.filter(function (s) {
      var a = String(s.EmAsm || '').toUpperCase().replace(/\s+/g, ' ').trim();
      return a && (a === nm || a === cd); });
    return mine.length ? mine : all;
  },
  statesOf: function (code) {
    return Plan.uniq(Plan.empStores(code).map(function (s) { return s.State; })); },
  townsOf: function (code, state) {
    var st = String(state || '').toUpperCase().trim();
    var fromStores = Plan.empStores(code).filter(function (s) {
      return !st || String(s.State || '').toUpperCase().trim() === st; }).map(function (s) { return s.City; });
    var fromPjp = (DB.m.Master_PJP || []).filter(function (p) {
      return String(p.Code).toUpperCase() === String(code).toUpperCase() &&
             (!st || !Plan.stateOfFor(code, p.Town) ||
              String(Plan.stateOfFor(code, p.Town)).toUpperCase() === st); })
      .map(function (p) { return p.Town; });
    return Plan.uniq(fromStores.concat(fromPjp).filter(function (x) {
      return !/^(leave|sunday|off day|weekly off|holiday|meeting.*)$/i.test(String(x || '').trim()); })); },
  stateOfFor: function (code, town) { return Plan.stateIn(Plan.empStores(code), town); },
  states: function () {
    return Plan.uniq(DB.myStores().map(function (s) { return s.State; })); },
  towns: function (state) {
    var st = String(state || '').toUpperCase().trim();
    var fromStores = DB.myStores().filter(function (s) {
      return !st || String(s.State || '').toUpperCase().trim() === st; }).map(function (s) { return s.City; });
    /* the rep's own PJP towns count as master data too — that is where a beat's town comes from */
    var fromPjp = (DB.m.Master_PJP || []).filter(function (p) {
      return String(p.Code).toUpperCase() === String(DB.me.code).toUpperCase() &&
             (!st || !Plan.stateOf(p.Town) || String(Plan.stateOf(p.Town)).toUpperCase() === st); })
      .map(function (p) { return p.Town; });
    return Plan.uniq(fromStores.concat(fromPjp).filter(function (x) {
      return !/^(leave|sunday|off day|weekly off|holiday|meeting.*)$/i.test(String(x || '').trim()); })); },
  beats: function (town) {
    var tw = String(town || '').toUpperCase().trim();
    return Plan.uniq((DB.m.Master_PJP || []).filter(function (p) {
      return String(p.Code).toUpperCase() === String(DB.me.code).toUpperCase() &&
             (!tw || String(p.Town || '').toUpperCase().trim() === tw); })
      .map(function (p) { return p.Beat; })
      .filter(function (b) { return !/^(leave|sunday|off day|weekly off|holiday|meeting.*)$/i.test(String(b || '').trim()); })); },
  /* ── which state is this town in? ──
     Master_PJP's Town is typed by a human and Master_Stores' City is typed by another, so an exact
     match is not good enough: "Gurgaon" vs "GURGAON ", "New Delhi" vs "Delhi", "Lucknow (East)" vs
     "Lucknow". Exact first, then a contains-either-way match, and it never guesses across states. */
  norm: function (v) { return String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); },
  stateIn: function (list, town) {
    var t = Plan.norm(town); if (!t) return '';
    var hit = list.filter(function (s) { return Plan.norm(s.City) === t; })[0];
    if (hit && hit.State) return String(hit.State).trim();
    hit = list.filter(function (s) {
      var c = Plan.norm(s.City);
      return c && (c.indexOf(t) === 0 || t.indexOf(c) === 0); })[0];
    if (hit && hit.State) return String(hit.State).trim();
    hit = list.filter(function (s) {
      var c = Plan.norm(s.City);
      return c && (c.indexOf(t) >= 0 || t.indexOf(c) >= 0); })[0];
    return hit ? String(hit.State || '').trim() : '';
  },
  stateOf: function (town) { return Plan.stateIn(DB.myStores(), town); },
  /* the whole chain, in the order the answers are trustworthy:
       what the rep already saved today -> what the MASTER says for today's beat -> the store master
       -> and if this rep only ever works in one state, that one. */
  stateFor: function (r, pjp, town) {
    var v = (r && r.State) || (pjp && (pjp.State || pjp.ChangedState)) || '';
    v = String(v || '').trim();
    if (v) return v;
    v = Plan.stateOf(town);
    if (v) return v;
    var all = Plan.states();
    return all.length === 1 ? all[0] : '';
  },

  /* a select built from the master, with the escape hatch as the last option */
  pickSel: function (kind, list, cur) {
    var isNew = cur && list.indexOf(cur) < 0;
    return '<select class="in" id="pl_' + kind + '_sel" onchange="Plan.other(\'' + kind + '\',this)">' +
      (list.length ? '' : '<option value="">— master me kuch nahi mila —</option>') +
      list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
      '<option value="' + Plan.ADD + '"' + (isNew ? ' selected' : '') + '>add new…</option>' +
      '</select>' +
      '<div id="pl_' + kind + '_add" style="display:' + (isNew || !list.length ? '' : 'none') + ';margin-top:6px">' +
        '<input class="in" id="pl_' + kind + '_new" placeholder="Naya ' + esc(kind) + ' likho" value="' +
        (isNew ? esc(cur) : '') + '"></div>';
  },
  /* show/hide the "new value" box without a re-render — a render here would throw away the other
     two half-made choices */
  other: function (kind, el) {
    var box = $('pl_' + kind + '_add');
    if (box) box.style.display = el.value === Plan.ADD ? '' : 'none';
    if (kind === 'state') Plan.reTown(el.value);
    if (kind === 'town') Plan.reBeat(el.value);
  },
  reTown: function (state) {
    var sel = $('pl_town_sel'); if (!sel) return;
    var list = Plan.towns(state);
    sel.innerHTML = I18n.tr((list.length ? '' : '<option value="">— master me kuch nahi mila —</option>') +
      list.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') +
      '<option value="' + Plan.ADD + '"> Add new…</option>');
    if (!list.length) sel.value = Plan.ADD;
    Plan.other('town', sel);
  },
  reBeat: function (town) {
    var sel = $('pl_beat_sel'); if (!sel) return;
    var list = Plan.beats(town);
    sel.innerHTML = I18n.tr((list.length ? '' : '<option value="">— master me kuch nahi mila —</option>') +
      list.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') +
      '<option value="' + Plan.ADD + '"> Add new…</option>');
    if (!list.length) sel.value = Plan.ADD;
    var box = $('pl_beat_add'); if (box) box.style.display = sel.value === Plan.ADD ? '' : 'none';
  },
  /* one reader for both modes: readonly input (approved PJP) or select + "add new" box (change) */
  pickVal: function (kind) {
    var sel = $('pl_' + kind + '_sel');
    if (sel) return sel.value === Plan.ADD ? val('pl_' + kind + '_new') : String(sel.value || '').trim();
    return val('pl_' + kind);
  },

  /* ── the extra fields each Working-With opens, like the previous app ── */
  wwBracket: function (ww, r) {
    var d = Plan.detail(r);
    if (ww === 'ME Sales Team' || ww === 'BA Supervisor')
      return '<label class="f">' + (ww === 'ME Sales Team' ? 'Sales person ka naam' : 'BA Supervisor ka naam') +
        ' <span class="req">*</span></label><input class="in" id="pl_wwname" value="' + esc(d.name || '') +
        '" placeholder="' + (ww === 'ME Sales Team' ? 'Sales person name' : 'BA Supervisor name') + '">';
    if (ww === 'Meeting / Activity')
      return '<label class="f">Meeting / Activity type <span class="req">*</span></label>' +
        '<select class="in" id="pl_act"><option value="">Type chuno…</option>' +
        Plan.ACT.map(function (a) { return '<option value="' + esc(a) + '"' + (d.act === a ? ' selected' : '') + '>' + esc(a) + '</option>'; }).join('') +
        '</select>' +
        '<div class="row two"><div><label class="f">Duration</label><select class="in" id="pl_dur">' +
        Plan.DUR.map(function (x) { return '<option value="' + esc(x) + '"' + (d.dur === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
        '</select></div>' +
        '<div><label class="f">Remark <span class="req">*</span></label>' +
        '<input class="in" id="pl_rmk" value="' + esc(d.rmk || '') + '" placeholder="Short remark"></div></div>';
    if (ww === 'Leave' || ww === 'Sick Leave')
      return '<label class="f">Reason <span class="req">*</span></label>' +
        '<input class="in" id="pl_reason" value="' + esc(d.reason || '') + '" placeholder="Leave ka reason">' +
        '<label class="f">Remark <span class="req">*</span></label>' +
        '<input class="in" id="pl_rmk" value="' + esc(d.rmk || '') + '" placeholder="Short remark">';
    return '';
  },
  /* WwDetail is stored as JSON so a bracket field can be read back exactly as it was typed */
  detail: function (r) {
    try { return JSON.parse((r || Plan.row()).WwDetail || '{}') || {}; } catch (e) { return {}; }
  },
  /* the one-line human form, used on the WhatsApp card and in messages */
  wwFull: function (r) {
    r = r || Plan.row();
    var base = Pjp.ww(r.WorkingWith || 'Self Working'), d = Plan.detail(r);
    if (d.name) return base + ' — ' + d.name;
    if (base === 'Meeting / Activity')
      return base + (d.act ? ' — ' + d.act : '') + (d.dur ? ' (' + d.dur + ')' : '') + (d.rmk ? ' · ' + d.rmk : '');
    if (/leave/i.test(base)) return base + (d.reason ? ' — ' + d.reason : '') + (d.rmk ? ' · ' + d.rmk : '');
    return base;
  },

  picked:null,                 /* {state, town, beat} captured by the Change-PJP popup */

  html: function () {
    var t = today(), pjp = DB.pjpFor(DB.me.code, t), r = Plan.row(), dev = Plan.dev();
    var ww = Plan.ww(), field = Pjp.isField(ww);
    var pend = dev && /pending/i.test(dev.Status || '');

    /* ── WAITING FOR APPROVAL ──
       While a change is with the HOD the approved plan is no longer the truth and the requested one is
       not yet the truth, so showing the "PJP approved" card would be showing a plan that does not
       apply. The whole screen becomes the request and its status. ── */
    if (pend) {
      /* Appr.gap takes a DURATION, not two timestamps — passing the raw epoch printed "20663 days" */
      var wait = Appr.gap(Date.now() - (Appr.ts(dev.UpdatedAt || dev.Ts) || Date.now()));
      return UI.head('', 'HOD approval ka wait', dmy(t) + ' · aapki Change PJP request HOD ke paas hai.') +
        '<div class="card"><div class="c-h"><h3>Waiting for approval</h3>' +
          '<span class="pill p-warn">HOD ke paas</span></div>' +
          '<table class="ap-t"><tr><td>Kya maanga</td><td><b>' + esc(dev.NewTown || '') + ' / ' +
            esc(dev.NewBeat || '') + '</b></td></tr>' +
          '<tr><td>Working With</td><td>' + esc(Pjp.ww(dev.NewWw || ww)) + '</td></tr>' +
          '<tr><td>Station</td><td>' + esc(Pjp.stn(dev.NewStation)) + '</td></tr>' +
          '<tr><td>PJP me tha</td><td>' + esc((dev.PlannedTown || '—') + ' / ' + (dev.PlannedBeat || '—')) + '</td></tr>' +
          '<tr><td>Aapka reason</td><td>' + esc(dev.Reason || '—') + '</td></tr>' +
          '<tr><td>Request bheja</td><td>' + esc(Appr.when ? Appr.when(dev.UpdatedAt || dev.Ts) : '') +
            (wait ? ' · pending: ' + esc(wait) : '') + '</td></tr></table>' +
          '<div class="hint" style="margin-top:10px">Approve hone par ye screen apne aap khul jayegi — ' +
          'reload karne ki zaroorat nahi. Tab tak target aur WhatsApp band hai.</div>' +
          Plan.rejNote(dev) +
        '</div>' +
        '<div class="card"><div class="btns" style="margin-top:0">' +
          '<button class="btn ghost" onclick="Sync.now(true)">Check for approval</button>' +
          '<button class="btn ghost" onclick="Router.go(\'appr\')">Meri requests</button></div></div>';
    }

    var h = UI.head('', 'Aaj ka Plan', dmy(t) + ' · plan save karke HOD ko notify karo — tabhi Field khulega.');

    /* ── ONE card, and it is READ-ONLY. This is what the HOD approved; the only way to alter any of it
          — including Working With — is the Change PJP button, which opens a request. ── */
    var left = Plan.left(dev);
    h += '<div class="card"><div class="c-h"><h3>PJP approved</h3>' +
      '<button class="btn ghost xs" onclick="Plan.changeOpen()"' + (left ? '' : ' disabled') + '>' +
        (left ? 'Change PJP' : 'Change limit over') + '</button></div>' +
      '<div class="hint">*Approved by HOD — kuch bhi badalna ho to Change PJP dabao, sidha edit nahi hota.' +
      (dev && num(dev.TryCount) ? ' Aaj ' + num(dev.TryCount) + '/' + Plan.MAXCHG + ' change ho chuke hain' +
        (left ? ' — ' + left + ' bacha hai.' : ' — limit poori.') : '') + '</div>';

    var shTown = (r.OffPjp && r.Town) || (pjp ? pjp.Town : '') || '';
    var shBeat = (r.OffPjp && r.Beat) || (pjp ? pjp.Beat : '') || '';
    /* Town / State / Beat only mean anything on a FIELD day — a Meeting / Leave / Off / Holiday day
       has no beat, so showing these (with whatever the master happens to hold in those columns for a
       non-field day, which is sometimes garbage left over from an old row) only confused the screen
       into looking like two different plans at once. A non-field day shows nothing here at all — the
       Working With line and its own bracket below (Meeting type, Duration, Remark…) is the whole story. */
    if (!pjp && !r.OffPjp) {
      /* short, and it says what the master actually holds — a rep who sees "no plan" on a day the
         sheet clearly has needs the fact, not a paragraph */
      var near = DB.pjpNear(DB.me.code, t);
      h += '<div class="banner w" style="margin-top:8px"><span>!</span><div>' +
        'Is month ka PJP update nahi hai. Kuch galat lage to admin se baat karo.' +
        (near.has ? '<br><span style="font-weight:500">Master me is month ke ' + near.has +
          ' din hain — aaj ka nahi.</span>' : '') + '</div></div>';
    } else if (field) {
      h += '<div style="margin-top:10px"><label class="f">State</label>' +
        '<input class="in lk" readonly value="' + esc(Plan.stateFor(r, pjp, shTown) || '—') + '"></div>' +
        '<div class="row two"><div><label class="f">Town / City</label>' +
        '<input class="in lk" id="pl_town" readonly value="' + esc(shTown || '—') + '"></div>' +
        '<div><label class="f">Beat / Market</label>' +
        '<input class="in lk" id="pl_beat" readonly value="' + esc(shBeat || '—') + '"></div></div>' +
        (pjp ? '<div class="fbox">' + esc(pjp.Week || '') +
          (pjp.Focus ? ' · Focus: ' + esc(pjp.Focus) :
            ' · <i>No focus brand for today, make the most of whatever you can</i>') + '</div>' : '');
    }

    /* Working With is part of the approved plan, so it is displayed, not offered as a dropdown. The
       hidden input keeps Plan.save reading from ONE place whichever way the value was chosen. */
    h += '<label class="f" style="margin-top:14px">Working With</label>' +
      '<input class="in lk" readonly value="' + esc(Plan.wwFull(r) || ww) + '">' +
      '<input type="hidden" id="pl_ww" value="' + esc(ww) + '">' +
      /* the ONE place that used to render Meeting-type/duration, Remark, Leave-reason etc. was the
         Change-PJP popup — a day already approved AS a Meeting/Leave day had no such popup open,
         so there was nothing on screen to satisfy Plan.check()'s requirement for it. Same fields,
         same ids, so Plan.save() reads them exactly as it already did. */
      (Plan.wwBracket(ww, r) ? '<div style="margin-top:8px">' + Plan.wwBracket(ww, r) + '</div>' : '') +
      Plan.rejNote(dev) + '</div>';
    if (dev && /rejected/i.test(dev.Status))
      h += '<div class="banner r"><span></span><div>HOD ne change reject kiya' +
        (dev.HodRemarks ? ': ' + esc(dev.HodRemarks) : '') + '. Dobara bhejo ya PJP wala beat karo.</div></div>';

    /* ── a day with no beat in it, spelled out ──
       The target belongs to a FIELD day only, and so do the Field / Stock / POSM tabs. Saying "no
       target" was not enough: a rep then tapped Field, found it locked, and had no idea whether
       something was broken or whether that was the point. So this says all three things — what today
       is, which tabs are shut, and the two ways forward (close the day from EOD, or Change PJP and
       actually go out). Gate.allowed / Gate.why enforce exactly the same rule. */
    if (!field)
      h += '<div class="banner w"><span>!</span><div><b>Aaj field day nahi — ' + esc(ww) + '</b><br>' +
        '<span style="font-weight:500">Koi order / SC / NSO target nahi, aur <b>Field · Stock · POSM ' +
        'band</b> hain.<br>Plan save karke HOD ko bhejo — uske baad sidha <b>EOD</b> se din close ' +
        'kar do.<br>Aaj kaam karna hai? Upar <b>Change PJP</b> dabao aur din ko field day banao — ' +
        'tabhi Field khulega.</span>' +
        '<div class="btns"><button class="btn sm" onclick="Router.go(\'eod\')">EOD kholo</button>' +
        '<button class="btn ghost sm" onclick="Plan.changeOpen()"' + (left ? '' : ' disabled') + '>' +
        (left ? 'Change PJP' : 'Change limit over') + '</button></div></div></div>';

    if (field) {
      var sc = num(r.ScTarget) || num(DB.cfg('SC_Call_Target', 7)) || 7;
      h += '<div class="card"><h3>Aaj ka target</h3>' +
        '<div class="row three"><div><label class="f">SC (calls)</label><input class="in" id="pl_sc" type="number" value="' + sc + '"></div>' +
        '<div><label class="f">NSO (naye outlet)</label><input class="in" id="pl_nso" type="number" value="' + (num(r.NsoTarget) || 1) + '"></div>' +
        '<div><label class="f">POSM</label><input class="in" id="pl_posm" type="number" value="' + (num(r.PosmTarget) || 1) + '"></div></div>' +
        '<div class="tw" style="margin-top:12px"><table><thead><tr><th>Brand</th><th class="num">Target ₹L / din</th></tr></thead><tbody>' +
        Plan.tgt().map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="num">' + x[1].toFixed(2) + '</td></tr>'; }).join('') +
        '<tr><td><b>TOTAL</b></td><td class="num"><b>' + Plan.tgt().reduce(function (a, x) { return a + x[1]; }, 0).toFixed(2) + '</b></td></tr>' +
        '</tbody></table></div></div>';
    }

    /* Save is OUTSIDE the target block: a Leave / Meeting day still has to be saved and sent */
    h += '<div class="card"><div class="btns" style="margin-top:0">' +
      '<button class="btn" onclick="Plan.save(false,this)">Save plan</button></div>' +
      (r.PlanAt ? '<div class="hint" style="margin-top:8px">Save: ' + esc(r.PlanAt) + (r.NotifiedAt ? ' · Notified: ' + esc(r.NotifiedAt) : ' · notify pending') + '</div>' : '') +
      '</div>';

    /* ── the morning WhatsApp image ── */
    h += '<div class="card"><h3>Din ki shuruaat — WhatsApp image</h3>' +
      '<div class="sub">Yahi image group me jaati hai — <b>edit nahi ho sakti</b>. Bhejne ke baad Field tab khul jayega.</div>' +
      (r.PlanAt ? '<div id="pl_card" style="margin-top:12px"><div class="skel" style="height:150px;border-radius:12px"></div></div>'
                : '<div class="banner w" style="margin-top:10px"><span>i</span><div>Pehle <b>plan save</b> karo — uske baad image ban jayegi.</div></div>') +
      '<div class="btns">' +
      '<button class="btn ok two" onclick="Card.send(this)" ' + (r.PlanAt ? '' : 'disabled') + '>' +
        (r.NotifiedAt ? 'Send again' : 'Send WhatsApp') +
        '<span class="who">' + esc(Plan.recips()) + '</span></button>' +
      '<button class="btn ghost" onclick="Card.zoom()" ' + (r.PlanAt ? '' : 'disabled') + '>Preview</button>' +
      '</div>' +
      '</div>';
    return h;
  },
  after: function () {
    Flush.reg('plan', function () { return Plan.row().PlanAt ? Plan.save(true) : null; });
    /* draws the card and caches the PNG, so the Send tap can share inside its own user gesture */
    if (Plan.row().PlanAt) Card.preview();
  },
  tgt: function () {
    return [['TDC – Face Wash', num(DB.cfg('TDC_FW', .3))], ['TDC – Sunscreen', num(DB.cfg('TDC_SUNSCREEN', .1))],
      ['TDC – Serum', num(DB.cfg('TDC_SERUM', .15))], ['TDC – FMDC / Moisturisers', num(DB.cfg('TDC_FMDC/MOISTURISERS', .15))],
      ['TDC – Combo', num(DB.cfg('TDC_COMBO', .1))], ['TDC – Rest', num(DB.cfg('TDC_REST', .1))],
      ['BBlunt (BB)', num(DB.cfg('BB', .25))], ['Aqualogica (AQ)', num(DB.cfg('AQ', .15))],
      ['Dr. Sheth\'s (DRS)', num(DB.cfg('DRS', .1))], ['ME Color Care (CC)', num(DB.cfg('CC', .1))]];
  },

  /* A day can be re-planned TWICE. The first version refused a second change once the first was
     approved, which is wrong: a market can shut after the rep has already moved. The cap is on the
     number of requests (TryCount), not on the outcome of the first one. */
  MAXCHG:2,
  left: function (dev) { return Math.max(0, Plan.MAXCHG - num(dev && dev.TryCount)); },

  /* ── Change PJP: a popup, not a second form on the page ── */
  changeOpen: function () {
    var t = today(), pjp = DB.pjpFor(DB.me.code, t), r = Plan.row();
    var ex = Plan.dev();
    if (ex && /pending/i.test(ex.Status || '')) return toast('Request already sent — HOD approval ka wait karo');
    if (!Plan.left(ex)) return toast('Aaj ' + Plan.MAXCHG + ' change ho chuke hain — kal se naya din', 4200);
    var curTw = (r.OffPjp && r.Town) || (pjp ? pjp.Town : '') || '';
    var curSt = Plan.stateFor(r, pjp, curTw) || (Plan.states()[0] || '');
    var curWw = Plan.ww();
    Plan.picked = null;
    UI.prompt({
      icon:'', title:'Change PJP',
      /* the selects are read by o.grab() BEFORE the dialog closes — reading them from .then() would
         race the close animation */
      grab: function () { Plan.picked = { state:Plan.pickVal('state'), town:Plan.pickVal('town'),
                                          beat:Plan.pickVal('beat'), ww:val('pl_ww2') || curWw,
                                          stn:val('pl_stn2') || Plan.station(),
                                          det:Plan.grabBracket(val('pl_ww2') || curWw) }; },
      msg:'<div class="hint" style="margin:0 0 10px">Yahi ek jagah hai jahan plan badal sakte ho. Mapping sheet se ' +
          'aati hai — na mile to <b>add new…</b> chuno, HOD approval ke baad master me add hoga.</div>' +
          /* Working With lives HERE now: the card itself is read-only */
          '<label class="f">Working With</label>' +
          '<select class="in" id="pl_ww2" onchange="Plan.chgWw(this.value)">' +
          Plan.WW.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (curWw === o[0] ? ' selected' : '') + '>' +
            esc(o[1]) + '</option>'; }).join('') + '</select>' +
          '<div id="pl_wwx">' + Plan.wwBracket(curWw, r) + '</div>' +
          '<div id="pl_geo">' + Plan.geoFields(curWw, curSt, curTw) + '</div>' +
          Plan.rejNote(ex),
      label:'Reason (HOD ko dikhega)', placeholder:'e.g. distributor meeting, market band tha…',
      multiline:true, required:true, requiredMsg:'Reason likhna zaroori hai',
      ok:'Send for approval', cancel:'Cancel'
    }).then(function (reason) {
      if (!reason) return;
      Plan.sendDev(null, reason);
    });
  },
  /* ── today's station ──
     An approved Change PJP wins (that is the whole point of it), then whatever the plan itself says:
     the day row already saved on DayPlan, the published Master_PJP row, or the rep's own draft for the
     month. HQ only when nothing says otherwise. */
  station: function () {
    var t = today(), r = Plan.row(), dev = Plan.dev();
    if (dev && /approved/i.test(String(dev.Status || '')) && dev.NewStation) return Pjp.stn(dev.NewStation);
    if (r && r.Station) return Pjp.stn(r.Station);
    var m = DB.pjpFor(DB.me.code, t);
    if (m && m.Station) return Pjp.stn(m.Station);
    var dr = DB.find('PjpDraft', DB.me.code + '__' + t.slice(0, 7));
    if (dr) {
      try {
        var days = JSON.parse(dr.DaysJson || '{}') || {};
        if (days[t] && days[t].st) return Pjp.stn(days[t].st);
      } catch (e) {}
    }
    return 'HQ';
  },
  /* the State/Town/Beat trio only makes sense for a field day — a Leave has no beat */
  geoFields: function (ww, st, tw) {
    if (!Pjp.isField(ww)) return '<div class="hint" style="margin-top:8px">Ye field day nahi hai — ' +
      'town/beat ki zaroorat nahi.</div>';
    /* a changed day can also become a trip — the claim later depends on this, so it is asked here */
    return '<label class="f">Station (HQ / Ex-HQ / Outstation)</label>' +
      '<select class="in" id="pl_stn2">' + Pjp.STN.map(function (o) {
        return '<option value="' + o + '"' + (o === Plan.station() ? ' selected' : '') + '>' + o +
          '</option>'; }).join('') + '</select>' +
      '<label class="f">State</label>' + Plan.pickSel('state', Plan.states(), st) +
      '<label class="f">Town / City</label>' + Plan.pickSel('town', Plan.towns(st), tw) +
      '<label class="f">Beat / Market</label>' + Plan.pickSel('beat', Plan.beats(tw), '');
  },
  /* swapping Working-With inside the popup swaps its bracket fields and the geo block, WITHOUT
     re-rendering the screen behind the dialog (that would close it) */
  chgWw: function (v) {
    var b = $('pl_wwx'); if (b) b.innerHTML = I18n.tr(Plan.wwBracket(v, Plan.row()));
    var g = $('pl_geo');
    if (g) {
      var pjp = DB.pjpFor(DB.me.code, today()), r = Plan.row();
      var tw = (r.OffPjp && r.Town) || (pjp ? pjp.Town : '') || '';
      g.innerHTML = I18n.tr(Plan.geoFields(v, Plan.stateFor(r, DB.pjpFor(DB.me.code, today()), tw) ||
        (Plan.states()[0] || ''), tw));
    }
  },
  /* read whichever bracket fields the chosen Working-With put on screen */
  grabBracket: function (ww) {
    var d = {};
    if (ww === 'ME Sales Team' || ww === 'BA Supervisor') d.name = val('pl_wwname');
    if (ww === 'Meeting / Activity') { d.act = val('pl_act'); d.dur = val('pl_dur'); d.rmk = val('pl_rmk'); }
    if (ww === 'Leave' || ww === 'Sick Leave') { d.reason = val('pl_reason'); d.rmk = val('pl_rmk'); }
    return d;
  },
  /* which beats the HOD has already refused, shown wherever a new beat is being chosen */
  rejNote: function (dev) {
    var rej = Plan.rejectedList(dev);
    return rej.length ? '<div class="hint" style="margin-top:8px">Reject ho chuke hain: <b>' +
      rej.map(function (x) { return esc((x.town || '') + ' / ' + (x.beat || '')); }).join('</b>, <b>') +
      '</b> — inme se koi dobara nahi bhej sakte, naya beat chuno.</div>' : '';
  },

  /* who the morning image is meant for — named on the send button in small light text, built from
     the rep's own hierarchy so it never advertises a role the master doesn't have */
  recips: function () {
    var e = DB.emp(DB.me.code) || {};
    var out = [];
    if (e.HodName) out.push('HOD');
    if (e.ZmName)  out.push('ZM');
    if (e.RsmName) out.push('RSM');
    if (e.AsmName) out.push('ASM');
    return out.length ? out.join(' · ') : 'HOD · ZM · RSM · ASM';
  },
  /* the bracket fields are required exactly where the previous app required them */
  check: function (ww) {
    if (ww === 'ME Sales Team' || ww === 'BA Supervisor')
      return val('pl_wwname') ? '' : (ww === 'ME Sales Team' ? 'Sales person ka naam bharo' : 'BA Supervisor ka naam bharo');
    if (ww === 'Meeting / Activity')
      return !val('pl_act') ? 'Meeting / Activity type chuno' : (!val('pl_rmk') ? 'Remark likho' : '');
    if (ww === 'Leave' || ww === 'Sick Leave')
      return !val('pl_reason') ? 'Leave ka reason likho' : (!val('pl_rmk') ? 'Remark likho' : '');
    return '';
  },
  save: function (quiet, el) {
    var t = today(), pjp = DB.pjpFor(DB.me.code, t), e = DB.emp(DB.me.code) || {};
    var ww = val('pl_ww') || Plan.ww(), field = Pjp.isField(ww);
    var town = field ? Plan.pickVal('town') : '';
    var beat = field ? Plan.pickVal('beat') : '';
    var state = field ? (Plan.pickVal('state') || Plan.stateOf(town)) : '';
    if (!quiet) {
      var bad = Plan.check(ww);
      if (bad) { toast(bad); return null; }
      if (field && !town) { toast('Town / City chuno'); return null; }
      if (field && !beat) { toast('Beat / Market chuno'); return null; }
    }
    /* the bracket answers travel as JSON so they can be read back into the same inputs */
    var d = {};
    if (ww === 'ME Sales Team' || ww === 'BA Supervisor') d.name = val('pl_wwname');
    if (ww === 'Meeting / Activity') { d.act = val('pl_act'); d.dur = val('pl_dur'); d.rmk = val('pl_rmk'); }
    if (ww === 'Leave' || ww === 'Sick Leave') { d.reason = val('pl_reason'); d.rmk = val('pl_rmk'); }
    /* off-PJP = a different Working-With than the approved plan, or (on a field day only) a
       different beat. Town/Beat mean nothing on a non-field day, so comparing them there — against
       whatever the master happens to hold in those columns for a Meeting/Leave/Off day — used to
       flag a plan as "off-PJP" purely because an HOD had switched the day's type from the console.
       If the Working-With itself already matches what the master says, the day IS on-PJP. */
    var same = function (a, b) { return String(a || '').toUpperCase().trim() === String(b || '').toUpperCase().trim(); };
    var off = !pjp || !same(ww, Pjp.ww(pjp.Ww)) || (field && (!same(town, pjp.Town) || !same(beat, pjp.Beat)));
    var r = Plan.row();
    return DB.save('DayPlan', { Id:Plan.id(), Date:t, Zone:e.Zone || '', Hq:e.HQ || '',
      WorkingWith:ww, WwDetail:JSON.stringify(d), Town:town, Beat:beat, State:state,
      Focus:pjp ? (pjp.Focus || '') : '', Week:pjp ? (pjp.Week || '') : '',
      Station:Plan.station(), OffPjp:off ? 'Yes' : '', Approval:off ? (Plan.dev() ? Plan.dev().Status : 'Pending') : 'PJP',
      ScTarget:field ? (num(val('pl_sc')) || 7) : 0, NsoTarget:field ? num(val('pl_nso')) : 0,
      PosmTarget:field ? num(val('pl_posm')) : 0,
      PlanJson:JSON.stringify({ tgt:Plan.tgt() }), PlanAt:r.PlanAt || new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
      NotifiedAt:r.NotifiedAt || '', StartAt:r.StartAt || '' }, { quiet:!!quiet }).then(function () {
      if (!quiet) { Log.add('Plan', 'Saved', t, (town || ww) + (beat ? ' / ' + beat : '')); toast('Plan save ho gaya'); render(); Nav.build(); }
    });
  },
  /* text-only send. The Plan screen no longer offers it (the morning message is the image) — it stays
     as the automatic fallback inside Card.send for a device that cannot attach a file. */
  notify: function (el) {
    var r = Plan.row();
    if (!r.PlanAt) return toast('Pehle plan save karo');
    Share.wa(Plan.msg());
    return Busy.run('notify_' + today(), el, 'Bhej raha hai…', function () {
      return Plan.markNotified();
    });
  },
  /* Notifying the HOD is what unlocks the Field tab, so the stamp lives in ONE place — both the image
     share and the text share go through it and can never disagree. A cancelled share never gets here.
     THIS is the start of the day: StartAt is the full timestamp of the moment the plan went out, and
     every "din shuru" count in the app reads it (falling back to NotifiedAt for older rows). */
  started: function (r) { return !!(r && (r.StartAt || r.NotifiedAt)); },
  markNotified: function () {
    var r = Plan.row();
    if (!r.PlanAt) return Promise.resolve(null);
    return DB.save('DayPlan', Object.assign({}, r, {
      NotifiedAt:new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }),
      StartAt:r.StartAt || new Date().toISOString() }))
      .then(function () {
        Log.add('Plan', 'Notified', today(), 'day start');
        render(); Nav.build();
        toast('Plan bhej diya — din shuru, Field khul gaya');
      });
  },
  msg: function () {
    var r = Plan.row(), t = today();
    var L = ['*GARUDA — Daily Plan*', dmy(t) + ' · ' + DB.me.name + ' (' + DB.me.code + ')', ''];
    L.push('Working With : ' + (Plan.wwFull(r) || '—'));
    L.push('Town / Beat  : ' + (r.Town || '—') + ' / ' + (r.Beat || '—'));
    if (Pjp.isField(r.WorkingWith) && r.Focus) L.push('Focus        : ' + r.Focus);
    L.push('');
    L.push('Target — Calls ' + (r.ScTarget || 0) + ' · NSO ' + (r.NsoTarget || 0) + ' · POSM ' + (r.PosmTarget || 0));
    L.push('Order target : ₹' + Plan.tgt().reduce(function (a, x) { return a + x[1]; }, 0).toFixed(2) + ' L');
    L.push('');
    L.push('_Sent from GARUDA_');
    return L.join('\n');
  },
  /* Rejected proposals are remembered per day, so the same beat cannot be sent again. */
  rejectedList: function (dev) {
    if (!dev) return [];
    try { return JSON.parse(dev.RejectedJson || '[]') || []; } catch (e) { return []; }
  },
  isRejected: function (dev, town, beat) {
    var k = (town + '|' + beat).toUpperCase().replace(/\s+/g, ' ').trim();
    return Plan.rejectedList(dev).some(function (x) {
      return ((x.town || '') + '|' + (x.beat || '')).toUpperCase().replace(/\s+/g, ' ').trim() === k; });
  },
  /* The button states itself instead of silently allowing a re-send. */
  /* Driven by the Change-PJP popup: it captured state/town/beat into Plan.picked while it was still
     mounted, and hands the reason in here. */
  sendDev: function (el, reason) {
    var t = today(), pjp = DB.pjpFor(DB.me.code, t);
    var p = Plan.picked || {};
    var nw = p.ww || Plan.ww(), fld = Pjp.isField(nw);
    var town = fld ? (p.town || '') : '', beat = fld ? (p.beat || '') : '';
    if (fld && !town) return toast('Town / City chuno');
    if (fld && !beat) return toast('Beat / Market chuno');
    if (!reason) return toast('Reason likhna zaroori hai');
    var ex = Plan.dev();
    /* already waiting → never queue a second request (this is what used to fire 3 times) */
    if (ex && /pending/i.test(ex.Status || '')) { render(); return toast('Request already sent — HOD approval ka wait karo'); }
    /* two changes a day, whatever the outcome of the first */
    if (!Plan.left(ex)) { render(); return toast('Aaj ' + Plan.MAXCHG + ' change ho chuke hain — kal se naya din', 4200); }
    /* HOD rejected this exact beat → must propose a different one */
    if (Plan.isRejected(ex, town, beat))
      return toast('Ye beat HOD ne reject kiya tha — koi dusra beat chuno', 4200);
    return Busy.run('dev_' + t, el, 'Bhej raha hai\u2026', function () {
      var r0 = Plan.row();
      return DB.save('Deviation', { Id:DB.me.code + '_' + t, Date:t,
        /* "from where I am now", not "from the original master row" — on a SECOND change of the day the
           original is no longer where the rep is, and the HOD needs to see the real move */
        PlannedTown:(r0.OffPjp && r0.Town) || (pjp ? pjp.Town : ''),
        PlannedBeat:(r0.OffPjp && r0.Beat) || (pjp ? pjp.Beat : ''),
        NewTown:town, NewBeat:beat, NewWw:nw, NewStation:fld ? Pjp.stn(p.stn) : '',
        Reason:reason, Status:'Pending',
        TryCount:num(ex && ex.TryCount) + 1, RejectedJson:JSON.stringify(Plan.rejectedList(ex)),
        UpdatedAt:Date.now(), Ts:new Date().toISOString() }).then(function () {
        /* Record the proposed beat on the day plan, and CLEAR NotifiedAt: whatever was sent on WhatsApp
           earlier described a different beat, so it has to go out again once the HOD approves. That also
           puts the button back to "Send WhatsApp" instead of "Send again", and re-locks Field until the
           new plan is actually sent. */
        return DB.save('DayPlan', Object.assign({}, Plan.row(), { Id:Plan.id(), Date:t,
          State:p.state || '', Town:town, Beat:beat, WorkingWith:nw,
          Station:fld ? Pjp.stn(p.stn) : '',
          WwDetail:JSON.stringify(p.det || {}), OffPjp:'Yes', Approval:'Pending',
          NotifiedAt:'', StartAt:'' }), { quiet:true });
      }).then(function () {
        Log.add('Deviation', 'Submitted', t, town + '/' + beat + ' \u2014 ' + reason);
        render(); Nav.build();
        toast('HOD ko request chali gayi \u2014 ab wait karo');
      });
    });
  }
};

/* ═══════════════ FIELD — store loop ═══════════════ */
var Field = {
  store:null, lines:[], mode:'order', ns:{ front:'', inside:'' },
  /* set only when Sec order sent us here to extend an existing order */
  editPo:'',
  /* ── has this visit cleared its gate? ──
     Derived, never stored: a flag would drift out of step with the photo. A store visit needs the shop
     photo (waived by bypass); a telephonic call needs nothing; either way the rep must first say which
     it is, so a bypassed user is not silently skipped past the question. */
  srcSet:false,
  ready: function () {
    if (!Field.store || !Field.srcSet || Field.none()) return false;
    return Field.phone() || Cam.ok('entry') || Bypass.on();
  },
  /* the one door from the gate to the order page */
  toOrder: function () {
    if (!Field.ready()) return toast('Pehle shop ka photo lo');
    Router.go('stk');
  },
  html: function () {
    if (Gate.locked()) return Field.lockedHtml();
    /* the day is a Meeting / Leave / Off / Holiday — there is no store visit in it. Router.go already
       refuses the tab, but an admin previewing, or a link from somewhere else, can still land here. */
    if (!Gate.fieldDay() && !Field.editPo && !Auth.isAdmin()) return Field.noFieldHtml();
    var h = UI.head('', 'Field — store visit', 'Store select karo product add karo submit. Ek store ke baad POSM.');
    h += '<div class="card"><div class="btns" style="margin:0">' +
      '<button class="btn ' + (Field.mode === 'order' ? '' : 'ghost') + '" onclick="Field.setMode(\'order\')">Order</button>' +
      '<button class="btn ' + (Field.mode === 'new' ? '' : 'ghost') + '" onclick="Field.setMode(\'new\')"> Naya outlet</button>' +
      '</div></div>';
    return h + (Field.mode === 'order' ? Field.orderHtml() : Field.newHtml());
  },
  /* ── Field on a day that has no beat ──
     The twin of the Plan screen's banner, worded from this side: why this screen is empty, and the two
     ways on. Nothing here saves anything — a non-field day has nothing to punch by definition. */
  noFieldHtml: function () {
    var r = Plan.row(), ww = Pjp.ww(r.WorkingWith || Plan.ww());
    return UI.head('', 'Field band hai', dmy(today()) + ' · aaj field day nahi hai.') +
      '<div class="banner w"><span>!</span><div><b>Aaj ' + esc(Plan.wwFull(r) || ww) + ' hai</b><br>' +
      '<span style="font-weight:500">Is din koi store visit nahi hai, isliye Field, Stock aur POSM ' +
      'band hain. Din close karna ho to sidha <b>EOD</b> me jao.<br>Agar aaj market jaana hai to ' +
      'pehle <b>Plan tab me Change PJP</b> karke din ko field day banao — approve hone par Field ' +
      'apne aap khul jayega.</span></div></div>' +
      '<div class="card"><div class="btns" style="margin-top:0">' +
      '<button class="btn" onclick="Router.go(\'eod\')">EOD — din close karo</button>' +
      '<button class="btn ghost" onclick="Router.go(\'plan\')">Plan / Change PJP</button></div></div>';
  },
  lockedHtml: function () {
    var l = Store.get(K.lock, {});
    return '<div class="banner w"><span></span><div><b>Aaj ka din lock hai</b>' + (l.at ? ' (' + esc(l.at) + ')' : '') +
      ' — ' + (l.src === 'eod' ? 'EOD save ho gaya tha' : 'Close Day dabaya gaya tha') + ', isliye naya order save nahi hoga.' +
      '<br><span style="font-weight:500">Aur stores karne hain? Din dobara khol lo — baad me EOD phir save karna hoga.</span>' +
      '<div class="btns"><button class="btn sm" onclick="Field.reopen()"> Din dobara kholo</button></div></div></div>';
  },
  reopen: function () {
    UI.confirm({ icon:'', title:'Din dobara kholna hai?',
      msg:'Aap aage stores punch kar paoge.<br><b>Dhyan rahe:</b> baaki stores add karne ke baad EOD dobara Save karna hoga \u2014 figures phir se calculate honge.',
      ok:'Haan, kholo', cancel:'Nahi' }).then(function (go) {
      if (!go) return;
      Gate.unlock(); Log.add('Day', 'Reopened', today(), '');
      render(); Nav.build(); toast(' Din khul gaya \u2014 aage kaam karo');
    });
  },
  setMode: function (m) { Field.mode = m; render(); },

  /* ---------- order punch ---------- */
  orderHtml: function () {
    var stores = DB.myStores();
    var sN = 0;                       /* step numbers are counted, not written, because the photo
                                     step disappears for a telephonic order */
    var h = '<div class="card"><h3><span class="ic">' + (++sN) + '</span>Store select karo</h3>' +
      '<input class="in" id="f_search" placeholder=" Store name ya code" oninput="Field.filterStores()" style="margin-top:10px">' +
      '<div id="f_stores" class="slist"></div>';
    if (Field.store) h += '<div class="banner g" style="margin-top:10px"><span></span><div><b>' + esc(Field.store.StoreName) + '</b><br>' +
      '<span style="font-weight:500">' + esc(Field.store.City || '') + ' · ' + esc(Field.store.CompanyCode || '') +
      ' · DB: ' + esc(Field.store.DbName || '—') + '</span></div></div>';
    h += '</div>';
    if (!Field.store) return h;

    /* ─── STEP 2 — what kind of visit is this? ───
       Asked before anything else, because the answer decides whether a photo is owed. */
    var done = Field.ready();
    h += '<div class="card" id="f_step2"><h3><span class="ic">' + (++sN) + '</span>Order kaise aa raha hai?</h3>' +
      '<div class="seg" style="margin-top:8px">' +
      '<button type="button" class="' + (Field.srcSet && !Field.phone() && !Field.none() ? 'on' : '') +
        '" onclick="Field.setSrc(\'Store Visit\')">Store visit</button>' +
      '<button type="button" class="' + (Field.phone() ? 'on' : '') + '" onclick="Field.setSrc(\'Telephonic Call\')">Telephonic</button>' +
      '</div><div class="seg-n"><span>Shop me ja rahe ho — photo lagega</span>' +
      '<span class="w">Phone par order — photo aur POSM skip</span></div>' +
      (Field.srcSet ? '' : '<div class="hint" style="margin-top:8px">Ek chuno — uske baad order page khulega.</div>') +
      '</div>';
    if (!Field.srcSet) return h;

    /* ─── No order ───
       A visit with nothing to punch: no products, no order lines. The reason IS the record, so it is the
       only thing asked for, and then the rep carries straight on to POSM — the shelf still has to be
       audited whether or not an order came out of the call. */
    if (Field.none()) {
      if (Cam.has('entry')) h += '<div class="banner g"><span></span><div><b>Shop ka photo ho gaya</b>' +
        '<br><span style="font-weight:500">Visit ka proof save hai. Ab sirf reason bharo.</span></div></div>';
      h += '<div class="card"><h3><span class="ic">' + (++sN) + '</span>Order kyun nahi bana?</h3>' +
        '<div class="sub">Reason select karo — product aur photo ki zaroorat nahi. Save karte hi POSM khul jayega.</div>' +
        '<label class="f">Reason <span class="req">*</span></label>' +
        '<select class="in" id="f_norsn" onchange="Field.noRsn(this.value)">' +
          '<option value="">— select —</option>' +
          ['Stock Issue','Transport Issue','Overdue','Collection Issue','Damage & Expiry',
           'Official Issue','Shop Closed','Other']
          .map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') + '</select>' +
        '<label class="f">Remarks <span class="req" id="f_norm_r" style="display:none">*</span></label>' +
        '<input class="in" id="f_norm" placeholder="Shop ne kya kaha (optional)">' +
        '<div class="btns"><button class="btn" onclick="Field.saveNone(this)">Save karke POSM par jao</button>' +
        '<button class="btn ghost" onclick="Field.setSrc(\'Store Visit\')">Wapas — order punch karo</button></div></div>';
      return h;
    }

    /* ─── STEP 3 — the shop photo, before stepping inside ───
       A store visit cannot proceed without it; a telephonic call never sees it. */
    if (!Field.phone()) {
      h += '<div class="card"><h3><span class="ic">' + (++sN) + '</span>Shop ka photo</h3>' +
        '<div class="sub">Dukaan me andar jaane se <b>pehle</b> shop ke bahar ka ek photo lo — board aur entry ' +
        'dono dikhne chahiye. ' + (Bypass.on() ? 'Aapke liye ye optional hai (bypass ON) — gallery se bhi chalega.'
                                               : 'Ye live camera se hi hoga, gallery se nahi.') + '</div>' +
        '<div class="ph-g" style="margin-top:10px">' +
          Cam.tile('entry', 'Shop ka photo', true, { live:true, sendJs:'Field.photoMeta()', cbJs:'Field.entryDone' }) + '</div>' +
        (done ? '<div class="btns two"><button class="btn" onclick="Field.toOrder()">Punch order</button>' +
                '<button class="btn warn" onclick="Field.setSrc(\'Cancel Order\')">No order</button></div>'
              : '<div class="hint" style="margin-top:8px">Photo lete hi order page khul jayega.</div>') +
        '</div>';
      if (!done) return h;
    }

    /* the products come from the Stock tab now — that screen has the shelf counts next to every SKU,
       which is the only place the choice can honestly be made. This screen is the review. */
    h += '<div class="card"><div class="c-h"><h3>Product</h3>' +
      '<button class="btn ghost xs" onclick="Router.go(\'stk\')">Stock se add karo</button></div>' +
      '<div class="sub">Stock tab me shop aur distributor ka stock dikhta hai — wahin se product add karo.</div>' +
      '<div class="hint" style="margin-top:8px">Ye visit: <b>' + esc(Field.src) + '</b>' +
        (Field.phone() ? '' : (Cam.has('entry') ? ' · shop ka photo ho gaya' : ' · photo bypass')) +
        ' — <a class="pl" onclick="Field.srcSet=false;render()">badlo</a></div></div>';

    Field.lineStep = ++sN;
    h += '<div class="card"><h3><span class="ic">' + Field.lineStep + '</span>Order lines' + (Field.lines.length ? ' (' + Field.lines.length + ')' : '') + '</h3><div id="f_lines"></div></div>';

    /* the source moved to step 2; it is carried here as a hidden field so Field.submit still reads it
       from one place */
    h += '<div class="card"><h3><span class="ic">' + (++sN) + '</span>Status &amp; submit</h3>' +
      '<input type="hidden" id="f_src" value="' + esc(Field.src) + '">' +
      '<div class="hint">Order source: <b>' + esc(Field.src) + '</b> — badalna ho to upar step 2 me jao.</div>' +
      '<label class="f">Status</label><select class="in" id="f_status" onchange="Field.renderReason()">' +
        ['Order in Process','Billing Done','Cancel Order'].map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') + '</select>' +
      '<div id="f_reason"></div>' +
      '<label class="f">Remarks</label><textarea class="in" id="f_remarks" rows="2"></textarea>' +
      '<div class="btns"><button class="btn" onclick="Field.submit(this)"> Submit &amp; aage badho</button></div></div>';
    return h;
  },
  after: function () {
    if (Field.mode === 'order' && !Gate.locked()) { Field.filterStores(); Field.renderProds(); Field.renderLines(); Field.renderReason(); }
    Flush.reg('field', function () { return null; });   /* nothing partial goes to the sheet by design */
  },
  uniq: function (f, keep) { var s = {}, o = [];
    DB.products().forEach(function (p) {
      if (keep && !keep(p)) return;
      var v = String(p[f] || '').trim(); if (v && !s[v]) { s[v] = 1; o.push(v); } });
    return o.sort(); },
  filterStores: function () {
    var q = val('f_search').toUpperCase(), box = $('f_stores'); if (!box) return;
    var list = DB.myStores().filter(function (s) {
      return !q || String(s.StoreName).toUpperCase().indexOf(q) >= 0 || String(s.CompanyCode).toUpperCase().indexOf(q) >= 0; });
    box.innerHTML = I18n.tr(list.length ? list.slice(0, 60).map(function (s, i) {
      return '<div class="lrow" onclick="Field.pick(' + DB.myStores().indexOf(s) + ')" style="cursor:pointer">' +
        '<div class="m"><div class="t">' + esc(s.StoreName) + '</div><div class="s">' + esc(s.City || '') + ' · ' +
        esc(s.StoreType || '') + ' · ' + esc(s.CompanyCode || '') + '</div></div><span class="pill p-blue">Select</span></div>';
    }).join('') : UI.empty('', q ? 'Koi store nahi mila' : 'Aapke naam par koi store mapped nahi hai'));
  },
  pick: function (i) {
    /* an index that no longer exists (the store list changed under a stale render) must not take the
       screen down with it */
    var st = DB.myStores()[i];
    if (!st) return toast('Ye store list me nahi mila — Sync karo');
    Field.store = st;
    Cam.clear(['entry']);                       /* new store = new visit photo */
    Field.lines = [];
    Field.src = 'Store Visit';
    Field.srcSet = false;                       /* the visit has not declared itself yet */
    Stk.open = ''; Stk.qty = {}; Stk.q = '';
    /* the stock read starts NOW so the shelf is already loaded by the time the photo is taken — but
       the rep stays here until the visit has cleared its gate */
    Stock.load(String(Field.store.ClientId || Field.store.CompanyCode || ''),
               String(Field.store.DbCode || ''));
    render();
    setTimeout(function () {
      var el = $('f_step2');
      var card = el && el.closest ? el.closest('.card') : el;
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 80);
  },
  /* Order source is asked BEFORE the photo, because a telephonic order has no shop to photograph —
     choosing it must skip the whole photo gate rather than fail it at the end. */
  src:'Store Visit', lineStep:5,
  phone: function () { return Field.src === 'Telephonic Call'; },
  none: function () { return Field.src === 'Cancel Order'; },
  setSrc: function (v) {
    Field.src = v;
    /* "No order" IS an answer to the question, so the gate has been engaged — it just does not clear
       it. ready() stays false while none() is true, which is what keeps the order page shut. */
    Field.srcSet = true;
    /* nothing left to ask on a phone order — no shop to photograph, so go and build the order */
    if (v === 'Telephonic Call' && Field.store) return Router.go('stk');
    render();
  },
  /* A Cancel-Order visit: one SecOrders row with Status 'Cancel Order', zero lines, the reason, and
     on to POSM. It goes through the same table and the same DFR push as every other visit, so the
     day's call count and the reports cannot disagree with what the rep did. */
  /* "Other" is not a reason — it is the absence of one, so the words become compulsory. Toggled in
     place, because a re-render here would throw away whatever the rep has already typed. */
  noRsn: function (v) {
    var star = $('f_norm_r'), box = $('f_norm'), other = v === 'Other';
    if (star) star.style.display = other ? '' : 'none';
    if (box) box.placeholder = I18n.s(other ? 'Reason likho — zaroori hai' : 'Shop ne kya kaha (optional)');
  },
  saveNone: function (el) {
    var s = Field.store; if (!s) return toast('Pehle store select karo');
    var reason = val('f_norsn'), rem = val('f_norm');
    if (!reason) return toast('Reason select karo');
    if (reason === 'Other' && !String(rem || '').trim())
      return toast('Other chuna hai — Remarks me reason likho', 4000);
    /* no PO for a visit that produced no order — see Field.novId */
    var t = today(), po = Field.novId(s);
    var order = { PoNumber:po, Date:t, Source:'Store Visit', StoreType:s.StoreType || '',
      ClientId:String(s.ClientId || ''), CompanyCode:String(s.CompanyCode || ''), StoreName:s.StoreName,
      City:s.City || '', State:s.State || '', DbCode:String(s.DbCode || ''), DbName:s.DbName || '',
      Status:'Cancel Order', Reason:reason, Remarks:rem, StatusAt:new Date().toISOString(),
      TotSku:0, TotUnits:0, TotValue:0, TotNsvLakh:0, LinesJson:'[]' };
    return Busy.run('order', el, 'Save ho raha hai…', function () {
      return DB.save('SecOrders', order).then(function () { return Dfr.push(); }).then(function () {
        Log.add('Order', 'Cancel Order', po, s.StoreName + ' · ' + reason);
        Posm.store = s; Field.lines = []; Field.store = null; Field.src = 'Store Visit';
        Nav.build();
        toast(s.StoreName + ' — no order (' + reason + ') save · ab POSM karo', 4000);
        Router.go('posm');
      });
    });
  },
  /* The shop photo GATES the visit, so filling it has to open the rest of the screen. Cam.paint only
     redraws the tile, which is why the order steps stayed hidden until the rep left the tab and came
     back. Called from the tile's own cb and from the "Order punch karo" button. */
  /* the shutter is the hand-off: the photo is what the rep came here to do, and the order page is
     what comes next. Called by the camera tile's own callback and by the button under it. */
  /* used to auto-jump to the order screen the instant the photo was captured LOCALLY (before the
     Drive upload even confirms) — which raced past this very render() and the "Punch order / No
     order" choice underneath it was never reached in the normal flow. The rep now sees that choice
     and picks one; Field.toOrder() is the only door to 'stk'. */
  entryDone: function () { render(); },
  /* stable id for everything photographed at this store today, so re-taking a slot overwrites
     the same Photos row instead of adding another */
  visitId: function (s) {
    s = s || Field.store || {};
    return (DB.me.code || '') + '_' + today() + '_' + String(s.CompanyCode || s.ClientId || 'NA');
  },
  prods: function () {
    var b = val('f_brand'), m = val('f_msl'), q = val('f_psearch').toUpperCase();
    var c = val('f_cat'), sc = val('f_sub');
    return DB.products().filter(function (p) {
      if (b && String(p.Brand) !== b) return false;
      if (c && String(p.Category) !== c) return false;
      if (sc && String(p.SubCategory) !== sc) return false;
      var isM = /^msl$/i.test(String(p.MslStatus || ''));
      if (m === 'MSL' && !isM) return false;
      if (m === 'Non-MSL' && isM) return false;
      if (q && String(p.Name).toUpperCase().indexOf(q) < 0 && String(p.Code).toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
  },
  /* picking a brand narrows the categories to that brand's own, and picking a category narrows the
     sub-categories — chained the way the master data is actually shaped */
  onBrand: function () { Field.fillCats(); Field.renderProds(); },
  onCat: function () { Field.fillSubs(); Field.renderProds(); },
  fillCats: function () {
    var b = val('f_brand'), sel = $('f_cat'); if (!sel) return;
    var cur = sel.value;
    var list = Field.uniq('Category', function (p) { return !b || String(p.Brand) === b; });
    sel.innerHTML = '<option value="">Sab category</option>' +
      list.map(function (c) { return '<option value="' + esc(c) + '"' + (c === cur ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('');
    Field.fillSubs();
  },
  fillSubs: function () {
    var b = val('f_brand'), c = val('f_cat'), sel = $('f_sub'); if (!sel) return;
    var cur = sel.value;
    var list = Field.uniq('SubCategory', function (p) {
      return (!b || String(p.Brand) === b) && (!c || String(p.Category) === c); });
    sel.innerHTML = '<option value="">Sab sub-category</option>' +
      list.map(function (x) { return '<option value="' + esc(x) + '"' + (x === cur ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('');
  },
  renderProds: function () {
    var box = $('f_prods'); if (!box) return;
    var list = Field.prods();
    box.innerHTML = I18n.tr('<div class="hint" style="margin-bottom:6px">' + list.length + ' SKU' + (list.length > 80 ? ' — brand/search se narrow karo' : '') + '</div>' +
      (list.length ? list.slice(0, 80).map(function (p) {
        return '<div class="lrow" onclick="Field.add(\'' + esc(p.Code) + '\')" style="cursor:pointer">' +
          '<div class="m"><div class="t">' + esc(p.Name) + '</div><div class="s">' + esc(p.Brand || '') + ' · ' + esc(p.Code) +
          ' · MRP ' + inr(p.MRP) + (/^msl$/i.test(String(p.MslStatus || '')) ? ' · <b>MSL</b>' : '') + '</div>' +
          /* category / sub-category on its own line: it is how the rep and the master both describe a SKU */
          '<div class="s">' + esc(p.Category || '—') + (p.SubCategory ? ' › ' + esc(p.SubCategory) : '') + '</div></div>' +
          '<span class="pill p-ok">+ Add</span></div>'; }).join('') : UI.empty('', 'Koi product nahi mila')));
  },
  add: function (code) {
    var p = DB.products().filter(function (x) { return String(x.Code) === String(code); })[0];
    if (!p) return;
    var ex = Field.lines.filter(function (l) { return l.Sku === String(p.Code); })[0];
    if (ex) { ex.Units = num(ex.Units) + 1; ex.Value = num(ex.Units) * num(p.MRP); }
    else Field.lines.push({ Sku:String(p.Code), SkuName:p.Name, Brand:p.Brand, Category:p.Category,
      SubCategory:p.SubCategory, Mrp:num(p.MRP), Units:1, Value:num(p.MRP), MslStatus:p.MslStatus || '' });
    Field.renderLines();
    /* jump to the line that was just added — the list of products is long and the rep could not see
       whether the tap had registered */
    Field.toLines();
    toast('' + p.Name);
  },
  /* the count in the "Order lines" heading is rendered by html(), so it is refreshed here too */
  toLines: function () {
    var box = $('f_lines'); if (!box) return;
    var card = box.closest ? box.closest('.card') : null;
    var h3 = card && card.querySelector('h3');
    if (h3) h3.innerHTML = '<span class="ic">' + (Field.lineStep || 5) + '</span>' + I18n.s('Order lines') +
      (Field.lines.length ? ' (' + Field.lines.length + ')' : '');
    if (card && card.scrollIntoView) card.scrollIntoView({ behavior:'smooth', block:'center' });
  },
  renderLines: function () {
    var box = $('f_lines'); if (!box) return;
    if (!Field.lines.length) { box.innerHTML = I18n.tr(UI.empty('', 'Abhi koi product add nahi kiya')); return; }
    var tu = 0, tv = 0;
    box.innerHTML = I18n.tr(Field.lines.map(function (l, i) {
      tu += num(l.Units); tv += num(l.Value);
      return '<div class="oline"><div class="oline-h"><div class="m">' +
          '<div class="t">' + esc(l.SkuName) + '</div>' +
          '<div class="hint">' + esc(l.Brand || '') + ' · MRP ' + inr(l.Mrp) + '</div></div>' +
          /* small, top-right — it used to be a full-width button that wrapped onto its own line */
          '<button class="oline-x" onclick="Field.del(' + i + ')">Remove</button></div>' +
        '<div class="oline-n">' +
          '<span class="lbl">Units</span>' +
          '<input class="in" id="fl_u' + i + '" type="number" min="0" value="' + num(l.Units) + '">' +
          '<span class="lbl">MRP value</span>' +
          '<input class="in v" id="fl_v' + i + '" type="number" min="0" value="' + num(l.Value) + '">' +
          '<button class="btn ok" onclick="Field.saveLine(' + i + ')">Save</button>' +
        '</div></div>';
    }).join('') + '<div class="lrow" style="border:0"><div class="m"><b>' + Field.lines.length + ' SKU · ' + tu + ' units</b></div>' +
      '<div style="text-align:right"><div class="s">MRP value</div><b>' + inr(tv) +
      '</b><div class="s">NSV ' + lakh(tv * .6 / 1e5) + ' L</div></div></div>');
  },
  setLine: function (i, k, v) {
    var l = Field.lines[i]; if (!l) return;
    l[k] = num(v);
    if (k === 'Units') l.Value = num(v) * num(l.Mrp);
    Field.renderLines();
  },
  /* Save beside the numbers — on a phone the rep taps Submit without the input ever losing focus, so
     relying on onchange alone silently dropped the last thing they typed. */
  saveLine: function (i) {
    var l = Field.lines[i]; if (!l) return;
    var u = num(val('fl_u' + i)), v = num(val('fl_v' + i));
    l.Units = u;
    l.Value = (v && v !== num(l.Value)) ? v : u * num(l.Mrp);   /* a hand-typed value wins */
    Field.renderLines();
    toast(l.SkuName + ' — ' + u + ' units · ' + inr(l.Value));
  },
  del: function (i) { Field.lines.splice(i, 1); Field.renderLines(); },
  renderReason: function () {
    var box = $('f_reason'); if (!box) return;
    var st = val('f_status');
    box.innerHTML = I18n.tr((st === 'Cancel Order')
      ? '<label class="f">Reason <span class="req">*</span></label><select class="in" id="f_rsn">' +
        ['Stock Issue','Transport Issue','Overdue','Collection Issue','Damage & Expiry','Official Issue','Shop Closed','Other']
        .map(function (o) { return '<option value="' + o + '">' + o + '</option>'; }).join('') + '</select>' : '');
  },
  photoMeta: function () {
    var s = Field.store || {};
    return { module:'Visit', store:s.StoreName || '', companyCode:s.CompanyCode || '',
             recordId:Field.visitId(s), date:today() };
  },
  submit: function (el) {
    if (Busy.busy('order')) return toast('Ruko — order save ho raha hai');
    if (!Field.store) return toast('Store select karo');
    /* never trust the disabled button — but a bypassed user, and a telephonic order, are allowed through */
    if (!Cam.ok('entry') && !Bypass.on() && !Field.phone()) return toast('Pehle shop ka photo lo');
    var st = val('f_status'), src = val('f_src'), rem = val('f_remarks');
    var noOrder = st === 'Cancel Order';
    if (!noOrder && !Field.lines.length) return toast('Product add karo (ya Cancel Order select karo)');
    if (noOrder && !val('f_rsn')) return toast('Reason select karo');
    if (!noOrder && Field.lines.some(function (l) { return !num(l.Units); })) return toast('Har product ki units bharo');

    var s = Field.store, t = today();
    var po = Field.po(s), tu = 0, tv = 0;
    Field.lines.forEach(function (l) { tu += num(l.Units); tv += num(l.Value); });
    var nsv = tv * .6 / 1e5;

    var order = { PoNumber:po, Date:t, Source:src, StoreType:s.StoreType || '', ClientId:String(s.ClientId || ''),
      CompanyCode:String(s.CompanyCode || ''), StoreName:s.StoreName, City:s.City || '', State:s.State || '',
      DbCode:String(s.DbCode || ''), DbName:s.DbName || '', Status:st, Reason:val('f_rsn'), Remarks:rem,
      TotSku:noOrder ? 0 : Field.lines.length, TotUnits:tu, TotValue:tv, TotNsvLakh:+nsv.toFixed(4),
      LinesJson:JSON.stringify(Field.lines), DeliveredAt:st === 'Billing Done' ? new Date().toISOString() : '' };

    var lines = noOrder ? [] : Field.lines.map(function (l) {
      return Object.assign({}, l, { LineId:po + '__' + l.Sku, PoNumber:po, Date:t, StoreName:s.StoreName,
        CompanyCode:String(s.CompanyCode || ''), NsvLakh:+(num(l.Value) * .6 / 1e5).toFixed(4), Status:st }); });

    /* three writes go out here (order → lines → DFR), so the button must show progress and stay
       disabled until they finish — a second tap used to be possible on a slow connection */
    return Busy.run('order', el, 'Save ho raha hai…', function () {
      return DB.save('SecOrders', order).then(function () { return DB.saveMany('SecOrderLines', lines); })
        .then(function () { return Dfr.push(); })
        .then(function () {
          Log.add('Order', st, po, s.StoreName + ' · ' + inr(tv));
          var wasEdit = !!Field.editPo;
          Field.editPo = '';
          Posm.store = s; Field.lines = []; Field.store = null;
          /* it came from Sec order — take him back there, not on to POSM */
          if (wasEdit) { Nav.build(); render(); Router.go('fin');
            return toast(s.StoreName + ' ka order update ho gaya — PO ' + po, 3800); }
          toast('' + s.StoreName + ' save — PO ' + po);
          Nav.build();
          if (src === 'Telephonic Call') { render(); toast('Telephonic — POSM ki zaroorat nahi'); }
          else Router.go('posm');
        });
    });
  },
  po: function (s) {
    /* Sec order sends the rep back here to add a product to an order that already exists; without this
       the next free number would be taken and the shop would end up with two orders for one day */
    if (Field.editPo) {
      var ex = DB.find('SecOrders', Field.editPo);
      if (ex && String(ex.CompanyCode || ex.ClientId) === String(s.CompanyCode || s.ClientId))
        return String(Field.editPo);
    }
    var base = 'EMPO' + String(s.ClientId || s.CompanyCode || 'NA').replace(/\W/g, '');
    var used = {}; DB.rows('SecOrders').forEach(function (o) { used[String(o.PoNumber)] = 1; });
    for (var i = 1; i < 999; i++) { var c = base + p2(i); if (!used[c]) return c; }
    return base + Date.now().toString().slice(-4);
  },
  /* ── the id for a visit that produced NO order ──
     A no-order visit is still one SecOrders row, and that table is keyed on PoNumber, so the row needs
     a value there. What it must NOT do is burn a real PO number: 'EMPO…' reads as a purchase order
     everywhere it is seen, and a shop that ordered nothing has no purchase order. 'NOV…' says exactly
     what it is, and the next genuine order at this shop still gets EMPO…01. */
  novId: function (s) {
    var base = 'NOV' + String(s.ClientId || s.CompanyCode || 'NA').replace(/\W/g, '') + '-' +
               today().replace(/-/g, '');
    var used = {}; DB.rows('SecOrders').forEach(function (o) { used[String(o.PoNumber)] = 1; });
    if (!used[base]) return base;
    for (var i = 2; i < 99; i++) { var c = base + '-' + i; if (!used[c]) return c; }
    return base + '-' + Date.now().toString().slice(-4);
  },

  /* ---------- new outlet ---------- */
  nsState:'', nsTownAdd:false,
  /* the picked state decides which towns are even offered — this is the SAME cascade
     Plan.statesOf/townsOf already runs for Change-PJP and day-edit, just for THIS rep only
     (Plan.states()/towns() are the no-code shorthand for "the logged-in rep") */
  nsSetState: function (v) { Field.nsState = v; Field.nsTownAdd = false; render(); },
  nsTownPick: function (v) {
    if (v !== Plan.ADD) return;
    Field.nsTownAdd = true; render();
    setTimeout(function () { var b = $('n_town'); if (b) b.focus(); }, 30);
  },
  newHtml: function () {
    var d = DB.myDistributors();
    var states = Plan.states();
    /* only one state to be in? that IS the answer — nothing to pick. Otherwise the rep chooses,
       never a silent guess. */
    if (!Field.nsState && states.length === 1) Field.nsState = states[0];
    var stt = Field.nsState, towns = Plan.towns(stt);
    /* the distributor list comes from Master_Distributors — see DB.myDistributors. The city is shown
       beside each name because that is the master's own column, and it is what tells two similarly
       named distributors apart. */
    var gaps = DB.distGaps();
    /* two groups, one list: the distributors he already deals with sit on top, and EVERY other
       distributor in the master is right below them — a new outlet is very often the first store under
       a distributor, so that one must be reachable, not filtered out. */
    var opt = function (x) {
      return '<option value="' + esc(x.Code) + '">' + esc(x.Name) +
        ' (' + esc(x.Code) + ')' + (x.City ? ' · ' + esc(x.City) : '') + '</option>';
    };
    var mineD = d.filter(function (x) { return DB.distIsMine(x.Code); });
    var restD = d.filter(function (x) { return !DB.distIsMine(x.Code); });
    return '<div class="card"><h3><span class="ic"></span>Naya outlet</h3>' +
      '<label class="f">Distributor <span class="req">*</span></label><select class="in" id="n_db">' +
        '<option value="">Select distributor…</option>' +
        (mineD.length && restD.length
          ? '<optgroup label="Aapke distributor">' + mineD.map(opt).join('</optgroup>') +
            '</optgroup><optgroup label="Baaki sab (Master_Distributors)">' + restD.map(opt).join('') +
            '</optgroup>'
          : d.map(opt).join('')) + '</select>' +
      (d.length ? '<div class="hint" style="margin-top:5px">' + d.length +
        ' distributor — <b>Master_Distributors</b> se' +
        (mineD.length && restD.length ? ' (' + mineD.length + ' aapke, ' + restD.length + ' baaki)' : '') +
        '.</div>'
        : '<div class="banner w" style="margin-top:8px"><span>!</span><div><b>Distributor master khali hai</b>' +
          '<br><span style="font-weight:500">Master_Distributors me koi distributor nahi ' +
          'hai — admin se add karwao, tab tak naya outlet save nahi hoga.</span></div></div>') +
      (gaps.length ? '<div class="hint" style="margin-top:5px;color:#b7791f">! ' + gaps.length +
        ' distributor aapke store me hai par Master_Distributors me nahi (' + esc(gaps.slice(0, 3).join(', ')) +
        (gaps.length > 3 ? ' …' : '') + ') — isliye list me nahi dikh rahe. Admin ko batao.</div>' : '') +
      '<div class="row two"><div><label class="f">Store name <span class="req">*</span></label><input class="in" id="n_name"></div>' +
        '<div><label class="f">Store type</label><select class="in" id="n_type"><option>BA Store</option><option>MEGA BA</option><option>Chemist</option><option>Cosmetics</option><option>General Trade</option></select></div></div>' +
      '<div class="row two">' +
        '<div><label class="f">State <span class="req">*</span></label>' +
          '<select class="in" id="n_state" onchange="Field.nsSetState(this.value)">' +
          '<option value="">— select —</option>' +
          states.map(function (x) { return '<option value="' + esc(x) + '"' + (x === stt ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
          '</select></div>' +
        '<div><label class="f">Town / City <span class="req">*</span></label>' +
          (Field.nsTownAdd
            ? '<input class="in" id="n_town" placeholder="Naya town likho">'
            : '<select class="in" id="n_town_sel" onchange="Field.nsTownPick(this.value)">' +
              '<option value="">' + (stt ? '— select —' : '— pehle state chuno —') + '</option>' +
              towns.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join('') +
              '<option value="' + Plan.ADD + '"> Add new…</option></select>') +
        '</div></div>' +
      '<label class="f">Address</label><textarea class="in" id="n_addr" rows="2"></textarea>' +
      '<div class="row three"><div><label class="f">Pincode</label><input class="in" id="n_pin" inputmode="numeric"></div>' +
        '<div><label class="f">Beat</label><input class="in" id="n_beat"></div>' +
        '<div><label class="f">Category</label><input class="in" id="n_cat"></div></div>' +
      '<div class="row two"><div><label class="f">Owner name</label><input class="in" id="n_owner"></div>' +
        '<div><label class="f">Owner mobile</label><input class="in" id="n_mob" inputmode="numeric"></div></div>' +
      '<div class="row two"><div><label class="f">Day sales ₹</label><input class="in" id="n_day" type="number"></div>' +
        '<div><label class="f">Monthly turnover ₹</label><input class="in" id="n_turn" type="number"></div></div>' +
      '<label class="f">Kyun add kar rahe ho? <span class="req">*</span></label><textarea class="in" id="n_reason" rows="2"></textarea>' +
      '<div class="ph-g two" style="margin-top:12px">' +
        Cam.tile('front', 'Shop ke bahar ka photo', true, { live:true }) +
        Cam.tile('inside', 'Andar ka photo', true, { live:true }) + '</div>' +
      '<div class="btns"><button class="btn" onclick="Field.saveNew(this)"> Outlet save karo</button></div></div>';
  },
  saveNew: function (el) {
    var name = val('n_name'), state = val('n_state'),
        town = Field.nsTownAdd ? val('n_town') : ($('n_town_sel') ? $('n_town_sel').value : ''),
        db = val('n_db'), reason = val('n_reason');
    if (!db) return toast('Distributor select karo');
    if (!name) return toast('Store name bharo');
    if (!state) return toast('State select karo');
    if (!town) return toast('Town select karo');
    if (!reason) return toast('Reason likho');
    /* the distributor is read from Master_Distributors by code, not from whatever DbName a store row
       happened to carry — the master is the authority on the name, and this row is about to become one */
    var dbo = DB.distByCode(db);
    if (!dbo) return toast('Ye distributor Master_Distributors me nahi mila — admin se add karwao', 4200);
    var st = String((DB.emp(DB.me.code) || {}).Zone || 'XX').slice(0, 2).toUpperCase();
    var id = 'EM' + st + new Date().getFullYear() + p2(DB.rows('NewStores').length + 1);
    DB.save('NewStores', { StoreId:id, Date:today(),
      /* both written from the master row, so the code and the name can never disagree */
      DbCode:String(dbo.Code || db), DbName:dbo.Name || '', StoreType:val('n_type'),
      StoreName:name, State:state, Town:town, Address:val('n_addr'), Pincode:val('n_pin'),
      Beat:val('n_beat'), Category:val('n_cat'), OwnerName:val('n_owner'), OwnerMobile:val('n_mob'),
      DaySales:num(val('n_day')), MonthlyTurnover:num(val('n_turn')), Reason:reason,
      /* Nobody approves a new outlet. It goes straight to the sheet and the rep drives it himself
         from the Tracker tab, so its first status is simply the first tracker stage. */
      PhotoFront:Cam.has('front') ? 'yes' : '', PhotoInside:Cam.has('inside') ? 'yes' : '',
      Status:'Pending', StatusAt:new Date().toISOString() })
      .then(function () {
        Cam.upload(id, name);
        Log.add('NewStore', 'Created', id, name + ' · ' + town);
        Cam.clear(['front','inside']); Field.ns = { front:'', inside:'' };
        Field.nsState = ''; Field.nsTownAdd = false;
        toast('Outlet save ho gaya —' + id + ' · Tracker tab me status update karo');
        Nav.build(); render();
      });
  }
};

/* ═══════════════ STOCK — what is on the shelf, and at the distributor ═══════════════
   Both stock tabs are re-uploaded daily and are far too big to ship with the pull, so this asks the
   sheet for ONE store and ONE distributor at the moment the rep picks the shop. Nothing is kept across
   days: the cache is keyed by store + date, so the first look on any given day is always a fresh read,
   and the card shows what the sheet's UpdatedAt says so the rep can see whether today's upload is in.
   No writes, ever — these two tabs belong to whoever uploads them. */
var Stock = {
  cache:{}, busy:'',
  key: function (st, db) { return today() + '|' + String(st || '') + '|' + String(db || ''); },
  get: function (st, db) { return Stock.cache[Stock.key(st, db)] || null; },
  /* fire-and-render: called from Field when a store is picked */
  /* A read that never comes back is worse than a read that fails: the screen used to spin forever
     while the server chewed through a huge tab. 25 seconds, then say so. */
  WAIT:25000,
  load: function (st, db, loud) {
    var k = Stock.key(st, db), s = Auth.session();
    if (!s || (!st && !db)) return;
    if (loud) delete Stock.cache[k];
    else if (Stock.cache[k] || Stock.busy === k) return;
    Stock.busy = k;
    var done = false;
    var finish = function (v) {
      if (done) return; done = true;
      Stock.busy = '';
      Stock.cache[k] = v;
      if (Router.cur === 'stk' || Router.cur === 'field') render();
    };
    setTimeout(function () {
      finish({ err:'Stock time par nahi aaya — dobara try karo (ya admin se stock index build karwao)' });
    }, Stock.WAIT);
    return Api.get({ action:'stock', email:s.email, store:st || '', db:db || '' }, true)
      .then(function (r) {
        finish((r && r.ok) ? { store:r.store || [], db:r.db || [], storeAt:r.storeAt || '',
                               dbAt:r.dbAt || '', indexed:!!(r && r.indexed), at:Date.now() }
                           : { err:(r && r.error) || 'Stock nahi mila' });
      }, function () { finish({ err:'Internet nahi mila' }); });
  },
  /* Sku / SkuName / Code all appear across the two uploads; take whichever is filled */
  sku: function (r) { return String(r.Sku || r.SkuName || r.Code || r.Product || '').trim(); },
  qty: function (r) { return num(r.Qty !== undefined && r.Qty !== '' ? r.Qty : r.Stock); },

  /* ══════════ HOW OLD IS THIS STOCK? ══════════
     Stock_Store and Stock_Distributor are re-uploaded by the office and re-indexed by a daily trigger;
     the index carries the moment it was built, and that is what the app receives as storeAt / dbAt.
     A salesman standing in a shop has no way to tell a shelf count uploaded this morning from one left
     over from last Tuesday — and he is about to decide what to order from it. So the age is computed
     and SAID, in days, with the same three-colour rule the rest of the app uses: today is fine,
     yesterday is worth knowing, older than that is a warning, and unknown is a warning too (an absent
     timestamp is not evidence of freshness).
     `days` counts CALENDAR days back from today, so "kal ka" means yesterday's date, not 24 hours. */
  STALE:2,
  age: function (at) {
    var iso = Rep.dpart(at), t = Appr.ts(at);
    if (!iso) return { known:false, days:null, iso:'', when:'', txt:'Pata nahi kab update hua', cls:'w' };
    var d0 = new Date(today() + 'T00:00:00').getTime();
    var d1 = new Date(iso + 'T00:00:00').getTime();
    var days = Math.round((d0 - d1) / 864e5);
    var when = dmy(iso) + (Rep.tpart(at) ? ', ' + Rep.tpart(at) : '');
    var txt = days <= 0 ? 'Aaj ka stock hai' : days === 1 ? 'Kal update hua tha'
            : days + ' din purana hai';
    return { known:true, days:days, iso:iso, when:when, ts:t, txt:txt,
             cls:days <= 0 ? 'g' : days <= Stock.STALE ? 'b' : 'w' };
  },
  /* the worse of the two readings — what the screen's headline has to say */
  worst: function (storeAt, dbAt) {
    var a = Stock.age(storeAt), b = Stock.age(dbAt);
    if (!a.known || !b.known) return a.known ? b : a;
    return a.days >= b.days ? a : b;
  }
};

/* ═══════════════ STOCK — the shelf, and the order built from it ═══════════════
   The rep picks a shop in Field and lands here. Two sections, MSL first and Non-MSL under it (sections,
   not tabs — a salesman should see both without a decision), and against every product the two numbers
   that decide whether to order it: how many are in THIS shop, and how many the distributor mapped to
   this rep is holding. Brand / category / sub-category / search narrow the list.
   Adding is done here too: tap Add on a product, type the quantity, see the value and the NSV it will
   book, Save. The line goes into the order that Field is holding, so the review screen and the submit
   path are the ones that already exist — this screen never writes to the sheet.
   Stock_Store and Stock_Distributor are read live per store (see the Stock loader); nothing about them
   is ever cached across days. */
var Stk = {
  brand:'', cat:'', sub:'', q:'', open:'', qty:{},
  /* "show me what this shop is running out of": 1–15, and a row qualifies when the SHOP has fewer
     than that many. The distributor column is untouched — it is what he would refill from. */
  below:'', fopen:false,
  /* 3-state header sort: first click ascending, second descending, third back to the default order.
     `col` is 'shop' or 'dist'; dir 1 = ascending, -1 = descending, 0 = off. */
  sort:{ col:'', dir:0 },
  head: function (col, label) {
    var on = Stk.sort.col === col && Stk.sort.dir;
    /* a faint ↕ on every sortable header, ALWAYS — the arrow only ever appearing after the first
       tap meant there was nothing to say "this can be sorted" until you had already sorted it */
    var mark = !on ? ' <span class="sort-hint">↕</span>' : (Stk.sort.dir > 0 ? ' ↑' : ' ↓');
    return '<th class="num sortable' + (on ? ' on' : '') + '" onclick="Stk.bump(\'' + col + '\')">' +
      esc(label) + mark + '</th>';
  },
  bump: function (col) {
    if (Stk.sort.col !== col) Stk.sort = { col:col, dir:1 };
    else if (Stk.sort.dir === 1) Stk.sort.dir = -1;
    else if (Stk.sort.dir === -1) Stk.sort = { col:'', dir:0 };
    else Stk.sort = { col:col, dir:1 };
    render();
  },

  /* ── the stock-freshness banner ──
     One strip, coloured by the OLDER of the shop and distributor readings, then a dated line for each.
     Green = uploaded today, blue = a day or two old (fine, but say so), amber = older than that or no
     date at all — an absent timestamp is not evidence of freshness, so it reads as a warning too. */
  freshHtml: function (m, i) {
    var w = Stock.worst(m.storeAt, m.dbAt), s = Stock.age(m.storeAt), d = Stock.age(m.dbAt);
    var line = function (lbl, a) {
      return '<div style="display:flex;gap:6px;justify-content:space-between;font-weight:500">' +
        '<span>' + esc(lbl) + '</span><span>' + esc(a.known ? a.when + ' · ' + a.txt : a.txt) +
        '</span></div>';
    };
    /* the caveat matches the COLOUR, or the two contradict each other: green says nothing, a day or
       two states the fact and stops, and only genuinely old (or undated) stock gets the warning */
    var note = w.cls === 'g' ? ''
      : w.cls === 'b' ? 'Aaj ka upload nahi hai — thoda dhyan rakho.'
      : w.known ? 'Numbers purane ho sakte hain — shelf dekh kar hi order karo, aur ' +
                  '<b>Stock refresh</b> dabao.'
                : 'Sheet ne update ki date nahi bheji — inhe pakka na maano, shelf dekh kar order karo.';
    return '<div class="banner ' + w.cls + '" id="stk_fresh" style="margin-top:-2px">' +
      '<span>' + (w.cls === 'w' ? '!' : '') + '</span><div><b>Stock ' +
      esc(w.known ? (w.days <= 0 ? 'aaj ka hai' : w.txt) : 'ki date pata nahi') + '</b>' +
      (note ? '<br><span style="font-weight:500">' + note + '</span>' : '') +
      '<div style="margin-top:6px;font-size:12px">' +
        line('Shop stock', s) + line('Distributor stock', d) + '</div>' +
      '<div class="btns"><button class="btn ghost sm" onclick="Stock.load(\'' +
        esc(i.st) + '\',\'' + esc(i.db) + '\',1)">Stock refresh</button></div></div></div>';
  },

  store: function () { return Field.store; },
  ids: function () {
    var s = Field.store || {};
    return { st:String(s.ClientId || s.CompanyCode || ''), db:String(s.DbCode || ''), dbName:s.DbName || '' };
  },
  /* code -> qty, for both uploads */
  maps: function () {
    var i = Stk.ids(), c = Stock.get(i.st, i.db);
    if (!c || c.err) return null;
    var shop = {}, dist = {};
    (c.store || []).forEach(function (r) { var k = Stock.sku(r); if (k) shop[k] = (shop[k] || 0) + Stock.qty(r); });
    (c.db || []).forEach(function (r) { var k = Stock.sku(r); if (k) dist[k] = (dist[k] || 0) + Stock.qty(r); });
    return { shop:shop, dist:dist, storeAt:c.storeAt, dbAt:c.dbAt };
  },
  /* how many of this product are already in the order being built */
  inOrder: function (code) {
    var l = (Field.lines || []).filter(function (x) { return String(x.Sku) === String(code); })[0];
    return l ? num(l.Units) : 0;
  },
  /* the product list for one MSL bucket, filtered and sorted */
  list: function (msl, m) {
    var q = String(Stk.q || '').toUpperCase();
    var out = DB.products().filter(function (p) {
      if (/^msl$/i.test(String(p.MslStatus || '')) !== msl) return false;
      if (Stk.brand && String(p.Brand || '') !== Stk.brand) return false;
      if (Stk.cat && String(p.Category || '') !== Stk.cat) return false;
      if (Stk.sub && String(p.SubCategory || '') !== Stk.sub) return false;
      if (Stk.below && num((m.shop || {})[String(p.Code)]) >= num(Stk.below)) return false;
      if (!q) return true;
      return (String(p.Name) + ' ' + String(p.Code) + ' ' + String(p.Brand) + ' ' +
              String(p.Category) + ' ' + String(p.SubCategory)).toUpperCase().indexOf(q) >= 0;
    }).map(function (p) {
      var c = String(p.Code);
      var isMsl = /^msl$/i.test(String(p.MslStatus || '')), shopQty = num((m.shop || {})[c]),
          distQty = num((m.dist || {})[c]);
      /* MSL only, shop under the 3-unit floor, and the distributor actually holds more than the
         shop does — otherwise there is nothing to top up FROM */
      var need = isMsl ? Math.max(0, 3 - shopQty) : 0;
      var proj = (need && distQty > shopQty) ? Math.min(need, distQty) : 0;
      return { code:c, name:p.Name, brand:p.Brand || '', cat:p.Category || '', sub:p.SubCategory || '',
               mrp:num(p.MRP), shop:shopQty, dist:distQty, proj:proj,
               have:Stk.inOrder(c) };
    });
    var s = Stk.sort;
    if (s.col && s.dir) out.sort(function (a, b) { return (a[s.col] - b[s.col]) * s.dir; });
    else out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    return out;
  },
  CAP:60,
  section: function (title, msl, m) {
    var rows = Stk.list(msl, m);
    var h = '<div class="sec-title">' + esc(title) + ' (' + rows.length + ')</div><div class="card">';
    if (!rows.length) return h + UI.empty('', 'Is filter me koi product nahi') + '</div>';
    /* said once per section, right where the tap happens */
    h += '<div class="hint" style="margin:-2px 0 8px">Shop, DB ya Proj heading par tap karo — ek baar ' +
      'ascending, dobara descending, teesri baar normal. <b>Proj</b> = suggested add-on.</div>';
    /* .stkt keeps the three number columns narrow and un-wrapped so the product name gets every pixel
       that is left — five columns of default width overflowed the pane sideways on a phone */
    h += '<div class="pane"><table class="stkt"><thead><tr><th>Product</th>' +
      Stk.head('shop', 'Shop') + Stk.head('dist', 'DB') + Stk.head('proj', 'Proj') +
      '<th class="num">Add</th></tr></thead><tbody>';
    rows.slice(0, Stk.CAP).forEach(function (r) {
      var op = Stk.open === r.code;
      h += '<tr' + (op ? ' class="me"' : '') + '><td><b class="nm">' + esc(r.name) + '</b>' +
        '<div class="hint">' + esc(r.brand) + (r.cat ? ' · ' + esc(r.cat) : '') +
        ' · MRP ' + inr(r.mrp) + '</div></td>' +
        '<td class="num">' + (r.shop > 0 ? r.shop : '<span class="pill p-bad">0</span>') + '</td>' +
        '<td class="num">' + (r.dist > 0 ? r.dist : '<span class="pill p-bad">0</span>') + '</td>' +
        /* a "+N" pill — the projection is a SUGGESTED add-on, never the shop's actual count */
        '<td class="num">' + (r.proj > 0 ? '<span class="pill p-warn">+' + r.proj + '</span>' : '—') + '</td>' +
        '<td class="num">' + (r.have ? '<span class="pill p-ok">' + r.have + '</span> ' : '') +
        '<button class="btn ghost xs" onclick="Stk.tap(\'' + esc(r.code) + '\')">' +
        (op ? 'Close' : (r.have ? 'Edit' : 'Add')) + '</button></td></tr>';
      if (op) h += '<tr class="me"><td colspan="5">' + Stk.editor(r) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    h += '<div class="hint" style="margin-top:8px">' +
      (rows.length > Stk.CAP ? 'Sirf pehle ' + Stk.CAP + ' dikha rahe hain — search ya filter use karo.'
                             : 'List scroll karo — ' + rows.length + ' product') + '</div>';
    return h + '</div>';
  },
  /* quantity + what it books, then Save. Nothing else — the rest of the order is the review screen. */
  editor: function (r) {
    var q = Stk.qty[r.code] !== undefined ? Stk.qty[r.code] : (r.have || 1);
    var v = num(q) * r.mrp;
    return '<div class="dsave" style="border-top:0;margin-top:0;flex-wrap:wrap">' +
      '<div style="flex:1 1 120px;min-width:0">' +
        '<label class="f">Quantity</label>' +
        '<input class="in" id="stk_q_' + esc(r.code) + '" type="number" min="0" inputmode="numeric" value="' + q +
        '" oninput="Stk.setQty(\'' + esc(r.code) + '\',this.value)">' +
      '</div>' +
      '<div style="flex:1 1 90px">' +
        '<label class="f">MRP value</label>' +
        '<div class="in lk" id="stk_v_' + esc(r.code) + '">' + inr(v) + '</div>' +
      '</div>' +
      '<div style="flex:1 1 90px">' +
        '<label class="f">NSV</label>' +
        '<div class="in lk" id="stk_n_' + esc(r.code) + '">' + lakh(v * .6 / 1e5) + ' L</div>' +
      '</div>' +
      '<div style="flex:0 0 auto;display:flex;gap:6px;align-items:flex-end">' +
        '<button class="btn ok sm" onclick="Stk.save(\'' + esc(r.code) + '\',this)">Save</button>' +
        (r.have ? '<button class="btn ghost sm" onclick="Stk.drop(\'' + esc(r.code) + '\')">Remove</button>' : '') +
      '</div></div>';
  },
  tap: function (code) { Stk.open = Stk.open === code ? '' : code; render(); },
  /* update the value line without a re-render, so the caret stays in the box */
  setQty: function (code, v) {
    Stk.qty[code] = v;
    var p = DB.products().filter(function (x) { return String(x.Code) === String(code); })[0];
    var boxV = $('stk_v_' + code), boxN = $('stk_n_' + code);
    if (p) {
      var val2 = num(v) * num(p.MRP);
      if (boxV) boxV.innerHTML = inr(val2);
      if (boxN) boxN.innerHTML = I18n.tr(lakh(val2 * .6 / 1e5) + ' L');
    }
  },
  save: function (code, el) {
    var p = DB.products().filter(function (x) { return String(x.Code) === String(code); })[0];
    if (!p) return toast('Product nahi mila');
    var q = num(Stk.qty[code] !== undefined ? Stk.qty[code] : val('stk_q_' + code));
    if (q <= 0) return toast('Quantity bharo');
    Field.lines = Field.lines || [];
    var ex = Field.lines.filter(function (x) { return String(x.Sku) === String(code); })[0];
    if (ex) { ex.Units = q; ex.Value = q * num(p.MRP); }
    else Field.lines.push({ Sku:String(p.Code), SkuName:p.Name, Brand:p.Brand, Category:p.Category,
      SubCategory:p.SubCategory, Mrp:num(p.MRP), Units:q, Value:q * num(p.MRP),
      MslStatus:p.MslStatus || '' });
    Stk.open = ''; delete Stk.qty[code];
    render();
    toast(p.Name + ' — ' + q + ' unit order me add ho gaya');
  },
  drop: function (code) {
    Field.lines = (Field.lines || []).filter(function (x) { return String(x.Sku) !== String(code); });
    Stk.open = ''; delete Stk.qty[code];
    render(); toast('Order se hata diya');
  },
  set: function (k, v) {
    Stk[k] = v;
    if (k === 'brand' || k === 'cat') { Stk.sub = ''; }
    render();
  },
  clear: function () { Stk.brand = ''; Stk.cat = ''; Stk.sub = ''; Stk.below = ''; Stk.q = ''; render(); },
  fold: function () { Stk.fopen = !Stk.fopen; render(); },
  /* how many filters are narrowing the list right now — the folded button has to say so, or a rep stares
     at a short list and never thinks to look inside */
  applied: function () {
    return (Stk.brand ? 1 : 0) + (Stk.cat ? 1 : 0) + (Stk.sub ? 1 : 0) + (Stk.below ? 1 : 0);
  },
  appliedText: function () {
    var a = [];
    if (Stk.brand) a.push(Stk.brand);
    if (Stk.cat) a.push(Stk.cat);
    if (Stk.sub) a.push(Stk.sub);
    if (Stk.below) a.push(I18n.s('Shop stock') + ' < ' + Stk.below);
    return a.join(' · ');
  },
  onSearch: function (v) {
    /* typing must not re-render (the caret would jump); rebuild just the two sections */
    Stk.q = v;
    var m = Stk.maps(); if (!m) return;
    var box = $('stk_list'); if (!box) return;
    box.innerHTML = I18n.tr(Stk.section('MSL products', true, m) + Stk.section('Non-MSL products', false, m));
  },

  html: function () {
    if (Gate.locked()) return Field.lockedHtml();
    var s = Field.store;
    /* kept to one line on purpose: every line here pushes the first product further down the phone */
    var h = UI.head('', 'Stock — shop aur distributor', 'Yahin se order add karo.');
    if (!s) return h + '<div class="card">' + UI.empty('', 'Pehle Field tab me store select karo') +
      '<div class="btns"><button class="btn" onclick="Router.go(\'field\')">Field tab kholo</button></div></div>';

    var i = Stk.ids();
    h += '<div class="banner b"><span></span><div><b>' + esc(s.StoreName) + '</b><br>' +
      '<span style="font-weight:500">' + esc(s.City || '') + ' · ' + esc(s.CompanyCode || '') +
      ' · DB: ' + esc(i.dbName || '—') + '</span></div></div>';

    var m = Stk.maps();
    if (!m) {
      var c = Stock.get(i.st, i.db);
      if (c && c.err) return h + '<div class="card"><div class="banner w"><span>!</span><div><b>Stock nahi dikha</b><br>' +
        '<span style="font-weight:500">' + esc(c.err) + '</span></div>' +
        '<div class="btns"><button class="btn sm" onclick="Stock.load(\'' + esc(i.st) + '\',\'' + esc(i.db) + '\',1)">Dobara try karo</button></div></div></div>';
      Stock.load(i.st, i.db);
      return h + '<div class="strip b"><span class="g"><span class="spin"></span></span>' +
        '<div class="m"><b>Stock aa raha hai…</b> <i>· sheet se, aaj ka</i></div></div>';
    }

    /* filters — brand, category, sub-category, search */
    var uniq = function (f, extra) {
      var seen = {}, out = [];
      DB.products().forEach(function (p) {
        if (extra && !extra(p)) return;
        var v = String(p[f] || '').trim();
        if (v && !seen[v]) { seen[v] = 1; out.push(v); }
      });
      return out.sort();
    };
    var sel = function (k, lbl, list) {
      return '<div><label class="f">' + lbl + '</label><select class="in" onchange="Stk.set(\'' + k + '\',this.value)">' +
        '<option value="">Sab</option>' + list.map(function (x) {
          return '<option' + (Stk[k] === x ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
        '</select></div>';
    };
    /* On a phone these five fields stack, and 350px of dropdowns before the first product means the rep
       scrolls to see anything. Search stays out — it is the one he uses every visit — and the rest fold
       away behind a count of what is currently applied. */
    var on = Stk.applied();
    h += '<div class="card" style="padding:12px">' +
      /* side by side even on a narrow phone: .row.two stacks below 560px, and two stacked rows here push
         the first product off the screen */
      '<div style="display:flex;gap:8px;align-items:flex-end">' +
        '<div style="flex:1 1 auto;min-width:0"><input class="in" id="stk_q" placeholder="Product ya code" ' +
        'value="' + esc(Stk.q) + '" oninput="Stk.onSearch(this.value)"></div>' +
        '<button class="btn ' + (on ? '' : 'ghost') + '" style="flex:0 0 auto;width:auto;min-width:104px" ' +
          'onclick="Stk.fold()">Filter' +
          (on ? ' (' + on + ')' : '') + (Stk.fopen ? ' ▲' : ' ▼') + '</button></div>' +
      (Stk.fopen ?
        '<div class="row two" style="margin-top:8px">' + sel('brand', 'Brand', uniq('Brand')) +
          sel('cat', 'Category', uniq('Category', function (p) { return !Stk.brand || p.Brand === Stk.brand; })) + '</div>' +
        '<div class="row two" style="margin-top:8px">' +
          sel('sub', 'Sub-category', uniq('SubCategory', function (p) {
            return (!Stk.brand || p.Brand === Stk.brand) && (!Stk.cat || p.Category === Stk.cat); })) +
          '<div><label class="f">Shop stock kam hai</label>' +
            '<select class="in" onchange="Stk.set(\'below\',this.value)">' +
            '<option value="">Sab stock</option>' +
            [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15].map(function (n) {
              return '<option value="' + n + '"' + (String(Stk.below) === String(n) ? ' selected' : '') +
                '>' + n + ' se kam</option>'; }).join('') +
            '</select></div></div>' +
        (on ? '<div class="btns"><button class="btn ghost sm" onclick="Stk.clear()">Filter hatao</button></div>' : '')
        : (on ? '<div class="hint" style="margin-top:8px">' + esc(Stk.appliedText()) + '</div>' : '')) +
      /* where the numbers came from, and the way to re-read them — one line, not a card of its own */
      '<div style="display:flex;gap:8px;align-items:center;margin-top:8px">' +
        '<div class="hint" style="flex:1 1 auto;min-width:0">Shop: Stock_Store · ' +
          esc(Stock.age(m.storeAt).when || 'date nahi') +
          ' | DB: Stock_Distributor · ' + esc(Stock.age(m.dbAt).when || 'date nahi') + '</div>' +
        '<button class="btn ghost xs" style="flex:0 0 auto;width:auto" onclick="Stock.load(\'' +
          esc(i.st) + '\',\'' + esc(i.db) + '\',1)">Stock refresh</button></div>' +
      '</div>';

    /* ── HOW OLD IS THIS STOCK? ──
       Above the products, not below them: the rep is about to decide what to order off these two
       numbers, and a shelf count from last week is a different decision from one uploaded this morning.
       The headline takes the WORSE of the two readings, so a fresh shop count cannot make a week-old
       distributor count look current, and each is then dated on its own line. */
    h += Stk.freshHtml(m, i);

    h += '<div id="stk_list">' + Stk.section('MSL products', true, m) +
      Stk.section('Non-MSL products', false, m) + '</div>';

    /* the order being built, and the one way forward */
    var n = (Field.lines || []).length;
    var tv = (Field.lines || []).reduce(function (a, x) { return a + num(x.Value); }, 0);
    h += '<div class="card"><div class="c-h"><h3>Order banaya ja raha hai</h3>' +
      '<span class="pill ' + (n ? 'p-ok' : 'p-grey') + '">' + n + ' product</span></div>' +
      (n ? '<div class="sub">' + n + ' product · ' + inr(tv) + ' · NSV ' + lakh(tv * .6 / 1e5) + ' L</div>' +
        '<div class="btns"><button class="btn ok" onclick="Stk.done()">Order complete karo</button></div>'
        : '<div class="sub">Upar se product add karo — phir order complete karo.</div>') +
      '</div>';
    return h;
  },
  after: function () { /* nothing to hydrate: the screen is built in one pass */ },
  done: function () {
    if (!(Field.lines || []).length) return toast('Pehle koi product add karo');
    Router.go('field');
    toast('Order check karo, phir submit', 3200);
    setTimeout(function () {
      var box = $('f_lines');
      var card = box && box.closest ? box.closest('.card') : box;
      if (card && card.scrollIntoView) card.scrollIntoView({ behavior:'smooth', block:'start' });
    }, 80);
  }
};

/* ═══════════════ CAMERA ═══════════════
   One photo component for the whole app. Two rules the customer set:
     • a photo taken for TODAY's beat must come from the LIVE camera — `capture="environment"`
       makes the phone open the camera directly, with no gallery option;
     • a back-dated entry (the visit happened earlier, we are recording it now) may upload from
       the gallery, because a live photo is impossible after the fact.
   Photos upload the moment they are taken, keyed <recordId>_<slot>, so re-taking one overwrites the
   same Photos row instead of piling up, and nothing is lost if the visit is interrupted. */
var Cam = {
  buf:{},                    /* slot -> dataURL (what is on screen) */
  up:{},                     /* slot -> 'busy' | 'done' | 'fail'*/
  meta:{},                   /* slot -> { url, folder }            */

  live: function (d) { return toISO(d || today()) === today(); },   /* live camera only for today */

  pick: function (slot, opt) {
    opt = opt || {};
    var i = document.createElement('input');
    i.type = 'file'; i.accept = 'image/*';
    if (opt.live !== false) i.capture = 'environment';              /* the no-gallery bit */
    i.onchange = function () {
      var f = i.files && i.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var img = new Image();
        img.onload = function () {
          var c = document.createElement('canvas'), max = 1100;
          var sc = Math.min(1, max / Math.max(img.width, img.height));
          c.width = img.width * sc; c.height = img.height * sc;
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          var d = c.toDataURL('image/jpeg', .78);
          Cam.buf[slot] = d;
          if (opt.into) opt.into[slot] = d;                         /* legacy new-outlet buffer */
          Cam.paint(slot);
          if (opt.send) Cam.send(slot, opt.send);
          if (opt.cb) opt.cb(d);
        };
        img.src = r.result;
      };
      r.readAsDataURL(f);
    };
    i.click();
  },

  /* upload one slot now; meta = { module, store, companyCode, recordId, date } */
  err:{},                    /* slot -> why the last upload failed, so it can be reported not guessed */
  send: function (slot, meta) {
    var d = Cam.buf[slot]; if (!d) return Promise.resolve({ ok:false });
    var s = Auth.session(); if (!s) return Promise.resolve({ ok:false });
    Cam.up[slot] = 'busy'; delete Cam.err[slot]; Cam.paint(slot);
    return Api.post({ action:'photo', email:s.email, data:d, slot:slot, module:meta.module || '',
      store:meta.store || '', companyCode:String(meta.companyCode || ''), recordId:meta.recordId || '',
      date:toISO(meta.date || today()) })
      .then(function (r) {
        if (r && r.ok) {
          Cam.up[slot] = 'done'; Cam.meta[slot] = { url:r.url, folder:r.folder };
          if (r.warn) toast(r.warn, 5000);
        } else {
          Cam.up[slot] = 'fail';
          /* keep the SERVER's reason. A silent "Upload fail" is unfixable; "Drive write failed: …"
             or "unauthorized" tells you exactly what to change. */
          Cam.err[slot] = (r && (r.error || r.warn)) || 'server ne jawab nahi diya';
          toast('Photo upload fail: ' + Cam.err[slot], 6000);
        }
        Cam.paint(slot); return r || { ok:false };
      })
      .catch(function (e) {
        Cam.up[slot] = 'fail';
        Cam.err[slot] = 'network — ' + ((e && e.message) || 'request nahi gaya');
        toast('Photo upload fail: ' + Cam.err[slot], 6000);
        Cam.paint(slot); return { ok:false };
      });
  },
  retry: function (slot, meta) { return Cam.send(slot, meta); },

  has: function (slot) { return !!Cam.buf[slot]; },
  /* uploaded (or at least captured) — a save is allowed once the photo exists locally, the upload
     retries in the background so a weak signal never blocks the rep */
  ok: function (slot) { return !!Cam.buf[slot]; },
  clear: function (slots) { (slots || Object.keys(Cam.buf)).forEach(function (k) {
    delete Cam.buf[k]; delete Cam.up[k]; delete Cam.meta[k]; }); },

  /* a photo tile: preview, status, retake. `req` marks it compulsory. */
  tile: function (slot, label, req, opt) {
    opt = opt || {};
    /* A bypassed user gets gallery upload and no red star — done HERE so every tile in the app
       follows the same rule and no screen can forget it. */
    var live = opt.live !== false && !Bypass.on();
    if (Bypass.on()) req = false;
    var call = 'Cam.pick(\'' + slot + '\',{live:' + (live ? 'true' : 'false') +
      (opt.sendJs ? ',send:' + opt.sendJs : '') +
      /* a slot that GATES the screen needs to tell the screen it was filled — paint() only redraws
         the tile itself, which is why the order steps used to stay hidden until you left the tab */
      (opt.cbJs ? ',cb:' + opt.cbJs : '') + '})';
    return '<div class="ph-t" id="ph_' + slot + '">' +
      '<div class="ph-h"><b>' + esc(label) + (req ? ' <span class="req">*</span>' : ' <i>(optional)</i>') + '</b>' +
      '<span class="ph-s"></span></div>' +
      '<div class="ph-b" data-live="' + (live ? '1' : '0') + '" onclick="' + call + '">' +
        Cam.inner(slot, live) + '</div></div>';
  },
  inner: function (slot, live) {
    var d = Cam.buf[slot], st = Cam.up[slot];
    if (!d) return '<div class="ph-e"><span>' + (live ? '' : '') + '</span>' +
      (live ? 'Camera kholo' : 'Photo chuno / camera') + '</div>';
    return '<img src="' + d + '">' +
      '<div class="ph-o">' + (st === 'busy' ? '<span class="spin"></span> Upload…'
        : st === 'done' ? 'Drive me save'
        : st === 'fail' ? '! Upload fail — dobara tap karo' +
            (Cam.err[slot] ? '<i style="font-style:normal;font-weight:500;opacity:.85"> (' +
              esc(String(Cam.err[slot]).slice(0, 70)) + ')</i>' : '')
        : 'Ready') + '</div>';
  },
  paint: function (slot) {
    var box = $('ph_' + slot); if (!box) return;
    var b = box.querySelector('.ph-b');
    if (b) b.innerHTML = I18n.tr(Cam.inner(slot, b.getAttribute('data-live') !== '0'));
  },

  /* used by the new-outlet form, which keeps its own front/inside buffer */
  upload: function (recordId, store, companyCode) {
    ['front','inside'].forEach(function (slot) {
      if (!Cam.buf[slot] && Field.ns[slot]) Cam.buf[slot] = Field.ns[slot];
      if (!Cam.buf[slot]) return;
      Cam.send(slot, { module:'NewStore', store:store, companyCode:companyCode, recordId:recordId, date:today() });
    });
  }
};

/* ═══════════════ PHOTO LOOKUP ═══════════════
   The Photos tab is written by the backend, so the app only ever reads it. Everything is keyed by
   store + date, which is exactly how a rep or an HOD wants to find a picture: "us dukaan ka us din
   ka photo". `link()` renders a chip that opens the shop's Drive folder in a new tab. */
var Pics = {
  rows: function () { return DB.rows('Photos'); },
  /* photos of one store on one date — matches on company code first, else the name */
  of: function (store, date, code) {
    var d = toISO(date || today()), nm = String(store || '').toUpperCase().trim(), c = String(code || '').trim();
    return Pics.rows().filter(function (p) {
      if (toISO(p.Date) !== d) return false;
      if (c && String(p.CompanyCode || '').trim() === c) return true;
      return nm && String(p.StoreName || '').toUpperCase().trim() === nm;
    });
  },
  mine: function (date) {
    var me = String((DB.me || {}).code || '').toUpperCase();
    return Pics.rows().filter(function (p) {
      return (Auth.isAdmin() || String(p.EmpCode || '').toUpperCase() === me) &&
             (!date || toISO(p.Date) === toISO(date)); });
  },
  /* one chip: "📷 3 photo" opening the shop folder in Drive */
  link: function (store, date, code, label) {
    var ps = Pics.of(store, date, code);
    if (!ps.length) return '';
    var f = '';
    for (var i = 0; i < ps.length && !f; i++) f = ps[i].FolderUrl || '';
    var href = f || ps[0].DriveUrl || '';
    if (!href) return '';
    return '<a class="pl" href="' + esc(href) + '" target="_blank" rel="noopener" onclick="event.stopPropagation()">' +
      '' + (label || (ps.length + ' photo')) + '</a>';
  },
  /* thumbnail strip, used in the admin browser */
  strip: function (ps) {
    return '<div class="pl-g">' + ps.map(function (p) {
      return '<a href="' + esc(p.DriveUrl || p.FolderUrl || '#') + '" target="_blank" rel="noopener" class="pl-i">' +
        '<img src="' + esc(String(p.DriveUrl || '').replace('/uc?id=', '/thumbnail?id=')) + '" loading="lazy" alt="">' +
        '<span>' + esc(p.Slot || '') + '</span></a>'; }).join('') + '</div>';
  }
};

/* ═══════════════ PDF — written by hand, like the .xlsx ═══════════════
   A PDF is a list of numbered objects, a cross-reference table of their byte offsets, and a trailer.
   Text is drawn inside BT/ET with one of the two fonts every reader has built in (Helvetica and
   Helvetica-Bold), so nothing has to be embedded and a claim is a few kilobytes.

   Two rules make the offsets trivial and the file safe:
     • everything written is ASCII, so one character is one byte — the offset of an object is just the
       length of the string before it;
     • rupees, en-dashes and the middle dot are transliterated (Rs, -, ·→-) because the built-in fonts
       are WinAnsi and a stray multi-byte character would shift every offset after it.                */
var Pdf = {
  W:595, H:842,                                    /* A4 in points */
  ML:38, MR:38, TOP:52, BOT:46,                    /* margins */

  /* what the fonts can actually print */
  txt: function (v) {
    return String(v == null ? '' : v)
      .replace(/₹/g, 'Rs ').replace(/[–—]/g, '-').replace(/·/g, '-')
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
      .replace(/→/g, '->').replace(/×/g, 'x')
      .replace(/[^\x20-\x7E]/g, ' ');
  },
  esc: function (v) { return Pdf.txt(v).replace(/([\\()])/g, '\\$1'); },
  /* Helvetica is not monospaced, but for laying out a table an average width is enough to know when a
     string will not fit — and every column here is measured against its own width */
  wide: function (v, size) { return Pdf.txt(v).length * size * 0.5; },
  clip: function (v, size, w) {
    var t = Pdf.txt(v);
    if (Pdf.wide(t, size) <= w) return t;
    var max = Math.max(1, Math.floor(w / (size * 0.5)) - 1);
    return t.slice(0, max) + '.';
  },
  /* real word-wrap, for the one column (Note / reason) long enough to actually need it — everywhere
     else still uses clip()'s single-line truncate, which is fine for a station name or an amount */
  wrapLines: function (v, size, w) {
    var words = Pdf.txt(v).split(/\s+/).filter(Boolean);
    if (!words.length) return [''];
    var lines = [], cur = words[0];
    for (var i = 1; i < words.length; i++) {
      var test = cur + ' ' + words[i];
      if (Pdf.wide(test, size) <= w) cur = test;
      else { lines.push(cur); cur = words[i]; }
    }
    lines.push(cur);
    return lines;
  },

  /* ── a document is a list of pages; each page is a list of drawing ops ── */
  doc: function () {
    var d = { pages:[], cur:null, y:0 };
    d.page = function () {
      d.cur = [];
      d.pages.push(d.cur);
      d.y = Pdf.H - Pdf.TOP;
      return d;
    };
    d.room = function (n) { if (d.y - (n || 0) < Pdf.BOT) d.page(); return d; };
    d.text = function (x, y, s, size, bold, grey) {
      d.cur.push('BT /' + (bold ? 'F2' : 'F1') + ' ' + size + ' Tf ' +
        (grey ? grey + ' g ' : '0 g ') + x.toFixed(1) + ' ' + y.toFixed(1) + ' Td (' + Pdf.esc(s) + ') Tj ET');
      return d;
    };
    d.right = function (x, y, s, size, bold, grey) {
      return d.text(x - Pdf.wide(s, size), y, s, size, bold, grey);
    };
    d.line = function (x1, y1, x2, y2, w, grey) {
      d.cur.push((grey === undefined ? 0.8 : grey) + ' G ' + (w || 0.6) + ' w ' +
        x1.toFixed(1) + ' ' + y1.toFixed(1) + ' m ' + x2.toFixed(1) + ' ' + y2.toFixed(1) + ' l S');
      return d;
    };
    d.rect = function (x, y, w, h, grey) {
      d.cur.push((grey === undefined ? 0.93 : grey) + ' g ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' ' +
        w.toFixed(1) + ' ' + h.toFixed(1) + ' re f 0 g');
      return d;
    };
    d.image = function (x, y, w, h) {
      d.cur.push('q ' + w.toFixed(1) + ' 0 0 ' + h.toFixed(1) + ' ' + x.toFixed(1) + ' ' + y.toFixed(1) + ' cm /Im0 Do Q');
      return d;
    };
    d.page();
    return d;
  },

  /* ── the finished bytes ── */
  build: function (d, title, logo) {
    var objs = [], W = Pdf.W, H = Pdf.H;
    var nPage = d.pages.length;
    /* object numbering: 1 catalog, 2 pages, then per page (page, content), then 2 fonts, then
       (only when a logo was supplied) one Image XObject */
    var fontA = 3 + nPage * 2, fontB = fontA + 1;
    var imgNo = logo ? fontB + 1 : 0;
    var kids = [];
    for (var i = 0; i < nPage; i++) kids.push((3 + i * 2) + ' 0 R');
    objs[1] = '<</Type /Catalog /Pages 2 0 R>>';
    objs[2] = '<</Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + nPage + '>>';
    var xobj = imgNo ? ' /XObject <</Im0 ' + imgNo + ' 0 R>>' : '';
    for (i = 0; i < nPage; i++) {
      var pno = 3 + i * 2, cno = pno + 1;
      objs[pno] = '<</Type /Page /Parent 2 0 R /MediaBox [0 0 ' + W + ' ' + H + '] ' +
        '/Resources <</Font <</F1 ' + fontA + ' 0 R /F2 ' + fontB + ' 0 R>>' + xobj + '>> /Contents ' + cno + ' 0 R>>';
      var body = d.pages[i].join('\n');
      objs[cno] = '<</Length ' + body.length + '>>\nstream\n' + body + '\nendstream';
    }
    objs[fontA] = '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding>>';
    objs[fontB] = '<</Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding>>';
    /* the logo is a JPEG re-encode (Pdf.logo()) — DCTDecode means the bytes toDataURL('image/jpeg')
       already produced go straight into the stream, no compression step of our own needed */
    if (imgNo) objs[imgNo] = '<</Type /XObject /Subtype /Image /Width ' + logo.w + ' /Height ' + logo.h +
      ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + logo.bin.length +
      '>>\nstream\n' + logo.bin + '\nendstream';

    var out = '%PDF-1.4\n', off = [];
    for (i = 1; i < objs.length; i++) {
      off[i] = out.length;
      out += i + ' 0 obj\n' + objs[i] + '\nendobj\n';
    }
    var xref = out.length;
    out += 'xref\n0 ' + objs.length + '\n0000000000 65535 f \n';
    for (i = 1; i < objs.length; i++) out += ('0000000000' + off[i]).slice(-10) + ' 00000 n \n';
    out += 'trailer\n<</Size ' + objs.length + ' /Root 1 0 R' +
      (title ? ' /Info <</Title (' + Pdf.esc(title) + ')>>' : '') + '>>\nstartxref\n' + xref + '\n%%EOF';

    var bytes = new Uint8Array(out.length);
    for (i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  },
  save: function (d, name, title, logo) {
    var bytes = Pdf.build(d, title || name, logo);
    var blob = new Blob([bytes], { type:'application/pdf' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name.replace(/\.pdf$/i, '') + '.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 4000);
    return { name:a.download, bytes:bytes.length };
  },
  /* the Honasa logo, re-encoded as a small JPEG so it can be embedded with zero compression code of
     our own (DCTDecode accepts JPEG bytes as-is) — drawn onto a white backdrop first because the
     source PNG has transparency and JPEG cannot. Cached after the first successful build. */
  _logo:null,
  logo: function () {
    if (Pdf._logo !== null) return Promise.resolve(Pdf._logo);
    var el = document.querySelector('#login_gate .lg-toprow > div:first-child img') ||
             document.querySelector('#login_gate img');
    if (!el) return Promise.resolve(null);
    var build = function (img) {
      var ih = 120, iw = Math.round(ih * (img.naturalWidth || 476) / (img.naturalHeight || 133));
      var c = document.createElement('canvas'); c.width = iw; c.height = ih;
      var g = c.getContext('2d');
      g.fillStyle = '#fff'; g.fillRect(0, 0, iw, ih);
      g.drawImage(img, 0, 0, iw, ih);
      var durl = c.toDataURL('image/jpeg', 0.92);
      Pdf._logo = { w:iw, h:ih, bin:atob(durl.slice(durl.indexOf(',') + 1)) };
      return Pdf._logo;
    };
    if (el.complete && el.naturalWidth) return Promise.resolve(build(el));
    return new Promise(function (res) {
      el.addEventListener('load', function () { res(build(el)); }, { once:true });
      el.addEventListener('error', function () { Pdf._logo = null; res(null); }, { once:true });
    });
  },

  /* ── the pieces every GARUDA report shares ── */
  head: function (d, title, sub, logo) {
    d.rect(0, Pdf.H - 44, Pdf.W, 44, 0.12);
    d.text(Pdf.ML, Pdf.H - 28, 'GARUDA', 15, true, 1);
    var logoW = 0;
    if (logo) { var ih = 28, iw = Math.round(ih * logo.w / logo.h); logoW = iw + 10;
      d.image(Pdf.W - Pdf.MR - iw, Pdf.H - 44 + (44 - ih) / 2, iw, ih); }
    d.right(Pdf.W - Pdf.MR - logoW, Pdf.H - 28, Pdf.txt(title), 11, true, 1);
    d.y = Pdf.H - 66;
    if (sub) { d.text(Pdf.ML, d.y, sub, 9, false, 0.35); d.y -= 16; }
    return d;
  },
  h2: function (d, s) {
    d.room(26);
    d.y -= 6;
    d.text(Pdf.ML, d.y, String(s).toUpperCase(), 9, true, 0.4);
    d.y -= 4;
    d.line(Pdf.ML, d.y, Pdf.W - Pdf.MR, d.y, 0.6, 0.75);
    d.y -= 13;
    return d;
  },
  /* label : value, two per line */
  kv: function (d, pairs) {
    var colW = (Pdf.W - Pdf.ML - Pdf.MR) / 2;
    for (var i = 0; i < pairs.length; i += 2) {
      d.room(16);
      [0, 1].forEach(function (k) {
        var p = pairs[i + k]; if (!p) return;
        var x = Pdf.ML + k * colW;
        d.text(x, d.y, p[0], 8.5, false, 0.42);
        d.text(x + 88, d.y, Pdf.clip(p[1], 9, colW - 92), 9, true);
      });
      d.y -= 14;
    }
    return d;
  },
  /* a table: cols = [{t:'Head', w:60, a:'r'|'l'}] */
  table: function (d, cols, rows, opt) {
    opt = opt || {};
    var size = opt.size || 8.2, rh = opt.rh || 13;
    var head = function () {
      d.rect(Pdf.ML, d.y - 3.5, Pdf.W - Pdf.ML - Pdf.MR, rh, 0.9);
      var x = Pdf.ML;
      cols.forEach(function (c) {
        if (c.a === 'r') d.right(x + c.w - 3, d.y, c.t, size, true, 0.25);
        else d.text(x + 3, d.y, c.t, size, true, 0.25);
        x += c.w;
      });
      d.y -= rh;
    };
    var lh = size + 2.6;   // one wrapped line's height, only used by a column marked wrap:true
    head();
    rows.forEach(function (r) {
      var cells = r.c || r;
      /* a row only grows past the default height if a wrap:true column actually needs more than
         one line — every other row renders exactly as before */
      var lines = 1;
      cols.forEach(function (c, i) {
        if (!c.wrap) return;
        var n = Pdf.wrapLines(cells[i], size, c.w - 6).length;
        if (n > lines) lines = n;
      });
      var rowH = lines > 1 ? lines * lh + 4 : rh;
      if (d.y - rowH < Pdf.BOT) { d.page(); d.y -= 4; head(); }
      /* a row may be a plain array — and an array HAS a .fill (Array.prototype.fill), which used to be
         written into the content stream as "function fill() { [native code] }" and made the file
         unreadable. Only a number is a shade. */
      var x = Pdf.ML, bold = r.bold === true;
      var fill = typeof r.fill === 'number' ? r.fill : -1;
      if (fill >= 0) d.rect(Pdf.ML, d.y - 3.5, Pdf.W - Pdf.ML - Pdf.MR, rowH, fill);
      cells.forEach(function (v, i) {
        var c = cols[i] || { w:60 };
        if (c.wrap) {
          Pdf.wrapLines(v, size, c.w - 6).forEach(function (line, li) {
            var yy = d.y - li * lh;
            if (c.a === 'r') d.right(x + c.w - 3, yy, line, size, bold);
            else d.text(x + 3, yy, line, size, bold);
          });
        } else {
          var s = Pdf.clip(v, size, c.w - 6);
          if (c.a === 'r') d.right(x + c.w - 3, d.y, s, size, bold);
          else d.text(x + 3, d.y, s, size, bold);
        }
        x += c.w;
      });
      d.line(Pdf.ML, d.y - rowH + (rh - 4), Pdf.W - Pdf.MR, d.y - rowH + (rh - 4), 0.4, 0.88);
      d.y -= rowH;
    });
    return d;
  },
  foot: function (d, note) {
    d.pages.forEach(function (p, i) {
      var save = d.cur; d.cur = p;
      d.text(Pdf.ML, 30, Pdf.txt(note), 7.5, false, 0.55);
      d.right(Pdf.W - Pdf.MR, 30, 'Page ' + (i + 1) + ' of ' + d.pages.length, 7.5, false, 0.55);
      d.cur = save;
    });
    return d;
  }
};

/* ═══════════════ REPORTS (xlsx) ═══════════════
   Every download is a workbook with named tabs, not a flat dump. The first tab always answers the
   question the person opening it actually has — for EOD that is "aaj ka target kya tha aur kitna
   hua" — and the later tabs hold the detail behind those numbers. */
/* ── the pair of column definitions for ONE timestamp field ──
   `xlWhen('Ts', 'Punched')` → a "Punched date" column and a "Punched time" column, so a schema never
   spells the split out twice and every moment in every report is sortable by either half.
   A hoisted FUNCTION rather than a method on Rep on purpose: the schemas below call it while the Rep
   object literal is still being constructed, so `Rep` itself does not exist yet. The closures it
   returns run at render time, when Rep.dpart / Rep.tpart are long since available. */
function xlWhen(field, label) {
  return [[function (r) { return Rep.dpart(r[field]); }, label + ' date', 'dOf'],
          [function (r) { return Rep.tpart(r[field]); }, label + ' time']];
}
var Rep = {
  ttl: function (title, sub, wide) {
    /* the title and the section labels are app copy — translate them like everything else.
       Row 1 is the title band, row 2 the subtitle, row 3 a thin spacer — the same masthead every data
       sheet uses, so a workbook looks like one document. */
    var last = Xl.col((wide || 6) - 1);
    return { rows:[[Xl.t(I18n.s(title), Xl.S.T)], [Xl.t(sub, Xl.S.sub)], []],
             merges:['A1:' + last + '1', 'A2:' + last + '2'],
             rowH:{ 1:24, 2:16, 3:6 } };
  },
  /* a key → value line on the cover, with the label in its own style */
  kv: function (k, v) { return [Xl.t(I18n.s(k), Xl.S.K), v == null ? Xl.t('') :
    (typeof v === 'object' ? v : Xl.t(String(v), Xl.S.V))]; },
  sec: function (label) { return [[], [Xl.t(I18n.s(label), Xl.S.L)]]; },
  pct: function (a, b) { return b ? a / b : 0; },
  photo: function (store, date, code) {
    var ps = Pics.of(store, date, code);
    if (!ps.length) return Xl.t('');
    var f = ''; for (var i = 0; i < ps.length && !f; i++) f = ps[i].FolderUrl || '';
    return Xl.link(f || ps[0].DriveUrl, ps.length + ' photo');
  },

  /* ─── EOD: what was the target, what actually happened ─── */
  eod: function (opt) {
    var a = Eod.agg(), me = DB.me, e = DB.emp(me.code) || {}, p = a.plan || {};
    var st = function (s) { return a.ord.filter(function (o) { return String(o.Status) === s; }); };
    var sum = function (g, f) { return g.reduce(function (x, o) { return x + num(o[f]); }, 0); };
    /* the distributor-wise primary-order need, computed up front because the COVER quotes how old the
       stock reading behind it is, and the Primary Order tab further down uses the same rows */
    var pr0 = Sec.primaryRows(a.ord);

    /* ── tab 1: the picture of the day ── */
    var t1 = Rep.ttl('GARUDA — Din ka report (EOD)',
      dmy(a.t) + '·  ' + me.name + ' (' + me.code + ')  ·  ' + (e.HQ || '') + '·  ' + (e.Zone || ''), 7);
    var rows = t1.rows;
    /* WHO this report belongs to and who it rolls up to — the first thing anyone forwarding it needs */
    rows.push([Xl.b('EMPLOYEE & REPORTING')]);
    rows.push(['Employee', Xl.t(me.name), 'Code', Xl.t(me.code)]);
    rows.push(['Designation', Xl.t(e.Designation || me.desig || '—'), 'Date of joining', Xl.t(dmy(DB.doj(me.code)))]);
    rows.push(['HQ', Xl.t(e.HQ || '—'), 'Zone', Xl.t(e.Zone || '—')]);
    rows.push(['ASM', Xl.t(e.AsmName || '—'), 'Mobile', Xl.t(e.AsmMobile || '—')]);
    rows.push(['RSM', Xl.t(e.RsmName || '—'), 'Mobile', Xl.t(e.RsmMobile || '—')]);
    rows.push(['ZSM', Xl.t(e.ZmName || '—'), 'Mobile', Xl.t(e.ZmMobile || '—')]);
    rows.push(['HOD', Xl.t(e.HodName || '—'), 'Mobile', Xl.t(e.HodMobile || '—')]);
    rows.push([]);
    rows.push([Xl.b('Aaj ka plan'), '', '', '', '', '', '']);
    rows.push(['Town / Beat', Xl.t((p.Town || '—') + ' / ' + (p.Beat || '—'))]);
    rows.push(['Working with', Xl.t(p.WorkingWith || '—')]);
    rows.push(['Focus', Xl.t(p.Focus || '—')]);
    rows.push(['Plan save', Xl.t(p.PlanAt || '—'), 'HOD ko notify', Xl.t(I18n.s(p.NotifiedAt || 'nahi bheja'))]);
    rows.push(['Din close', Xl.t(I18n.s(Gate.locked() ? (Store.get(K.lock, {}).at || 'haan') : 'abhi nahi'))]);

    rows.push([], [Xl.b('TARGET vs ACHIEVEMENT')]);
    rows.push(['Kya', 'Target', 'Achieve', 'Gap', '%', 'Status', ''].map(Xl.h));
    var kpi = [
      ['TC (Total calls)',      num(p.ScTarget) || 7,   a.tc,             0],
      ['PC (Productive calls)', num(p.ScTarget) || 7,   a.pc,             0],
      ['Naye outlet (NSO)',     num(p.NsoTarget),       a.ns.length,      0],
      ['POSM audit',            num(p.PosmTarget),      a.pa.length,      0],
      ['Order value (₹)',       0,                      a.value,          1],
      ['NSV (₹ Lakh)',          0,                      a.nsv,            2]
    ];
    var tgtNsv = 0; Plan.tgt().forEach(function (x) { tgtNsv += x[1]; });
    kpi[5][1] = tgtNsv;
    kpi.forEach(function (k) {
      var tg = k[1], ac = k[2], mode = k[3], gap = ac - tg;
      var stl = !tg ? Xl.S.txt : (ac >= tg ? Xl.S.good : Xl.S.bad);
      rows.push([
        Xl.t(I18n.s(k[0])),
        tg ? (mode === 1 ? Xl.m(tg) : mode === 2 ? Xl.d2(tg) : Xl.n(tg)) : Xl.t('—'),
        mode === 1 ? Xl.m(ac) : mode === 2 ? Xl.d2(ac) : Xl.n(ac),
        tg ? (mode === 1 ? Xl.m(gap) : mode === 2 ? Xl.d2(gap) : Xl.n(gap)) : Xl.t('—'),
        tg ? Xl.p(Rep.pct(ac, tg)) : Xl.t('—'),
        Xl.t(!tg ? '' : ac >= tg ? 'ACHIEVED' : 'SHORT', stl), ''
      ]);
    });

    rows.push([], [Xl.b('BRAND-WISE TARGET vs ACHIEVEMENT (₹ Lakh)')]);
    rows.push(['Brand', 'Target', 'Achieve', 'Gap', '%', '', ''].map(Xl.h));
    var tt = 0, ta = 0;
    Plan.tgt().forEach(function (x) {
      var ach = 0;
      Object.keys(a.brand).forEach(function (b) { if (Eod.match(b, x[0])) ach += a.brand[b]; });
      tt += x[1]; ta += ach;
      rows.push([Xl.t(x[0]), Xl.d2(x[1]), Xl.d2(ach), Xl.d2(ach - x[1]), Xl.p(Rep.pct(ach, x[1])),
        Xl.t(x[1] && ach >= x[1] ? 'OK' : '', x[1] && ach >= x[1] ? Xl.S.good : Xl.S.txt), '']);
    });
    rows.push([Xl.t('TOTAL', Xl.S.tot), Xl.d2(tt, Xl.S.totD), Xl.d2(ta, Xl.S.totD), Xl.d2(ta - tt, Xl.S.totD),
      Xl.p(Rep.pct(ta, tt), Xl.S.totP), Xl.t('', Xl.S.tot), Xl.t('', Xl.S.tot)]);

    rows.push([], [Xl.b('ORDER STATUS — kitne store kis stage par')]);
    rows.push(['Status', 'Store', 'Units', 'Value (₹)', 'NSV (₹L)', '% store', ''].map(Xl.h));
    ['Billing Done', 'Order in Process', 'Cancel Order'].forEach(function (x) {
      var g = st(x);
      rows.push([Xl.t(x), Xl.n(g.length), Xl.n(sum(g, 'TotUnits')), Xl.m(sum(g, 'TotValue')),
        Xl.d2(sum(g, 'TotNsvLakh')), Xl.p(Rep.pct(g.length, a.ord.length)), '']);
    });
    rows.push([Xl.t('TOTAL VISITS', Xl.S.tot), Xl.n(a.ord.length, Xl.S.totI), Xl.n(sum(a.ord, 'TotUnits'), Xl.S.totI),
      Xl.m(a.value, Xl.S.totM), Xl.d2(a.nsv, Xl.S.totD), Xl.p(1, Xl.S.totP), Xl.t('', Xl.S.tot)]);

    rows.push([], [Xl.b('COVERAGE')]);
    var mine = DB.myStores(), seen = {};
    a.ord.forEach(function (o) { seen[String(o.CompanyCode || o.StoreName)] = 1; });
    rows.push(['Mere total store', Xl.n(mine.length)]);
    rows.push(['Aaj visit kiye', Xl.n(a.ord.length)]);
    rows.push(['Order mila', Xl.n(a.pc), 'Strike rate', Xl.p(Rep.pct(a.pc, a.ord.length))]);
    rows.push(['MSL lines', Xl.n(a.msl), 'Non-MSL lines', Xl.n(a.nonMsl)]);
    rows.push(['POSM requirement', Xl.n(a.pr.length), 'Total order lines', Xl.n(a.lines.length)]);
    /* the Primary Order tab's shortfall is computed against the distributor stock upload — how old that
       upload is decides how much the shortfall is worth, so the cover says it out loud */
    var stAge = Stock.age((pr0[0] && pr0[0].stockAt) || '');
    rows.push(['Stock sheet last update', Xl.t(stAge.known ? stAge.when : 'pata nahi'),
      'Stock age', Xl.t(stAge.known ? stAge.txt : '—')]);

    /* ── tabs: Store visits · Order lines ──
       Also through Rep.anySheet now, off the same SecOrders / SecOrderLines registry the Data tab uses.
       They already carried the reporting line, but their own hand-written column lists had drifted:
       no beat, no HOD decision fields, no billing remark, and "Punched at" / "Billed at" were single
       combined date+time cells that could be sorted by neither half. */
    var vSheet = Rep.anySheet('SecOrders', a.ord, null,
      me.code + '  ·  ' + dmy(a.t) + '  ·  ' + a.ord.length + ' visit');
    var lSheet = Rep.anySheet('SecOrderLines', a.lines, null,
      me.code + '  ·  ' + dmy(a.t) + '  ·  ' + a.lines.length + ' line');

    /* ── brand split ── MRP value and NSV side by side, so both readings of the day are visible ── */
    var bl = {}, bu = {}, bv = {}, bm = {};
    a.lines.forEach(function (x) {
      var b = x.Brand || 'Other';
      bl[b] = (bl[b] || 0) + 1; bu[b] = (bu[b] || 0) + num(x.Units); bv[b] = (bv[b] || 0) + num(x.Value);
      bm[b] = (bm[b] || 0) + num(x.Units) * num(x.Mrp);
    });
    var br = [['Brand', 'Lines', 'Units', 'MRP value (₹)', 'Order value (₹)', 'NSV (₹L)', '% NSV'].map(Xl.h)];
    Object.keys(a.brand).sort(function (x, y) { return a.brand[y] - a.brand[x]; }).forEach(function (b) {
      br.push([Xl.t(b), Xl.n(bl[b] || 0), Xl.n(bu[b] || 0), Xl.m(bm[b] || 0), Xl.m(bv[b] || 0),
        Xl.d2(a.brand[b]), Xl.p(Rep.pct(a.brand[b], a.nsv))]);
    });

    /* ── tab: Primary Order ──
       What the DISTRIBUTOR has to buy so today's secondary orders can actually be served. The old
       "Orders" tab in the app carried this table on screen and nowhere else; it belongs in the workbook,
       where an ASM can act on it. Stock reads "—" when that distributor's upload is not in the cache,
       and the primary need then falls back to the whole demand rather than a fabricated zero. */
    var po2 = [['Distributor code', 'Distributor', 'SKU code', 'Product', 'Brand', 'Category', 'MSL',
                'MRP (₹)', 'Secondary demand (units)', 'Demand value (₹)', 'DB stock (units)',
                'Stock as of', 'Stock age (days)', 'Primary order needed (units)',
                'Employee code', 'Employee', 'Designation', 'HQ', 'Zone',
                'ASM', 'RSM', 'ZSM', 'HOD'].map(Xl.h)];
    pr0.forEach(function (x) {
      var ag = Stock.age(x.stockAt);
      po2.push([Xl.t(x.db), Xl.t(x.dbName), Xl.t(x.sku), Xl.t(x.name || x.sku), Xl.t(x.brand),
        Xl.t(x.cat || Rep.DASH), Xl.t(Rep.msl(x.msl)), Xl.m(x.mrp), Xl.n(x.ordered), Xl.m(x.value),
        x.stock === null ? Xl.t(Rep.DASH) : Xl.n(x.stock),
        ag.known ? Xl.dt(ag.iso) : Xl.t(Rep.DASH),
        ag.known ? Xl.n(ag.days, ag.days > Stock.STALE ? Xl.S.bad : Xl.S.int) : Xl.t(Rep.DASH),
        Xl.n(x.short, x.short > 0 ? Xl.S.bad : Xl.S.good),
        Xl.t(me.code), Xl.t(me.name), Xl.t(e.Designation || Rep.DASH), Xl.t(e.HQ || Rep.DASH),
        Xl.t(e.Zone || Rep.DASH), Xl.t(e.AsmName || Rep.DASH), Xl.t(e.RsmName || Rep.DASH),
        Xl.t(e.ZmName || Rep.DASH), Xl.t(e.HodName || Rep.DASH)]);
    });
    if (pr0.length) {
      var pu = 0, pv = 0, ps0 = 0;
      pr0.forEach(function (x) { pu += x.ordered; pv += x.value; ps0 += x.short; });
      po2.push([Xl.t('TOTAL', Xl.S.tot), '', '', '', '', '', Xl.t('', Xl.S.tot), Xl.t('', Xl.S.tot),
        Xl.n(pu, Xl.S.totI), Xl.m(pv, Xl.S.totM), Xl.t('', Xl.S.tot), Xl.t('', Xl.S.tot),
        Xl.t('', Xl.S.tot), Xl.n(ps0, Xl.S.totI),
        '', '', '', '', '', '', '', '', '']);
    }

    /* ── tabs: POSM audit · POSM requirement · New outlets ──
       Built through Rep.anySheet off the SAME registry the Data-tab downloads use, instead of a second
       hand-written column list per tab. Those hand-written lists were the reason these tabs were short
       of the store's own identifiers (Client id, Store code, State, Distributor), short of half the
       questions the forms ask, and had no reporting line at all — anySheet carries the full schema and
       appends Designation · HQ · Zone · ASM · RSM · ZSM · HOD to every one of them. One definition, so
       the day's workbook and the range download can never disagree about a column again. */
    var sub1 = me.code + '  ·  ' + dmy(a.t);
    var pmTabs = [['PosmAudit', a.pa], ['PosmRequirement', a.pr], ['NewStores', a.ns]]
      .map(function (x) {
        return Rep.anySheet(x[0], x[1], null, sub1 + '  ·  ' + x[1].length + ' row');
      });

    /* ── tab: DFR — one chronological line per thing that happened, morning plan to day close.
       Same activities Dfr.push() already records for the app's own end-to-end view, plus the plan
       send/notify moments so the timeline genuinely starts at the morning, not the first visit.
       DATE and TIME are separate columns and every row carries both: the app stores some of these
       moments as a full ISO timestamp (Ts) and some as a bare time-of-day ("08:35 PM" — PlanAt,
       NotifiedAt, the day-close stamp), so the date for a bare time is filled in from the day this
       report IS. A single combined cell could be sorted by neither half. */
    var acts = [];
    if (p.PlanAt) acts.push({ ts:p.PlanAt, type:'Plan saved', store:'', detail:(p.WorkingWith || '') +
      (p.Town ? ' · ' + p.Town + (p.Beat ? ' / ' + p.Beat : '') : '') });
    if (p.NotifiedAt) acts.push({ ts:p.NotifiedAt, type:'Plan sent to HOD (day start)', store:'', detail:'' });
    a.ord.forEach(function (o) { acts.push({ ts:o.Ts || o.Date, type:'Store visit', store:o.StoreName,
      code:o.CompanyCode || o.ClientId || '',
      detail:o.Status + (num(o.TotUnits) ? ' · ' + num(o.TotUnits) + ' units · ' + inr(o.TotValue) : '') +
        (o.Reason ? ' · ' + o.Reason : '') }); });
    a.pa.forEach(function (r) { acts.push({ ts:r.Ts || r.Date, type:'POSM audit', store:r.StoreName,
      code:r.CompanyCode || r.ClientId || '',
      detail:(r.Element || '') + (r.Condition ? ' · ' + r.Condition : '') }); });
    a.pr.forEach(function (r) { acts.push({ ts:r.Ts || r.Date, type:'POSM requirement', store:r.StoreName,
      code:r.CompanyCode || r.ClientId || '',
      detail:'Required: ' + (r.Requirement || '') + (r.Element ? ' · ' + r.Element : '') }); });
    a.ns.forEach(function (r) { acts.push({ ts:r.Ts || r.Date, type:'New outlet', store:r.StoreName,
      code:r.StoreId || '', detail:(r.Town || '') + (r.Beat ? ' / ' + r.Beat : '') }); });
    if (Gate.locked()) { var lk = Store.get(K.lock, {});
      acts.push({ ts:lk.at || '', type:'Day closed (EOD)', store:'', detail:'' }); }
    /* sort on the real moment, so a bare time and an ISO timestamp interleave correctly */
    acts.forEach(function (x) {
      x.d = Rep.dpart(x.ts) || a.t;
      x.tm = Rep.tpart(x.ts);
      x.sortKey = x.d + ' ' + (Appr.ts(x.ts) ? String(Appr.ts(x.ts)) : (x.tm || 'zz'));
    });
    acts.sort(function (x, y) { return String(x.sortKey).localeCompare(String(y.sortKey)); });
    var dfr = [['Date', 'Time', 'Activity', 'Store', 'Store code', 'Detail',
                'Employee code', 'Employee', 'Designation', 'HQ', 'Zone',
                'ASM', 'RSM', 'ZSM', 'HOD'].map(Xl.h)];
    acts.forEach(function (x) {
      dfr.push([Xl.dt(x.d), Xl.t(x.tm || Rep.DASH), Xl.t(x.type), Xl.t(x.store || Rep.DASH),
        Xl.t(x.code || Rep.DASH), Xl.t(x.detail || Rep.DASH, Xl.S.wrap),
        Xl.t(me.code), Xl.t(me.name), Xl.t(e.Designation || Rep.DASH), Xl.t(e.HQ || Rep.DASH),
        Xl.t(e.Zone || Rep.DASH), Xl.t(e.AsmName || Rep.DASH), Xl.t(e.RsmName || Rep.DASH),
        Xl.t(e.ZmName || Rep.DASH), Xl.t(e.HodName || Rep.DASH)]);
    });

    /* The main sheet is the report; a tab holding three rows is just somewhere to get lost. Anything
       short is folded in as a section here, and only the genuinely long tables keep their own tab.
       ("Visit nahi kiya" is gone — the customer does not want it.) */
    var extra = Rep.fold(rows, [
      { name:'Brand split', title:'BRAND SPLIT — MRP value vs NSV', rows:br,
        cols:[22, 8, 9, 15, 15, 11, 9], freeze:1 }
    ]);

    return Xl.save('EOD_' + me.code + '_' + a.t, [
      { name:I18n.s('Din ka Report'), cols:[30, 18, 16, 14, 12, 14, 13, 12, 12, 12, 12, 12],
        rows:rows, merges:t1.merges },
      vSheet, lSheet,
      { name:I18n.s('Primary Order'),
        cols:[16, 26, 14, 40, 16, 16, 10, 11, 22, 18, 15, 13, 16, 24,
              14, 20, 16, 12, 12, 16, 16, 16, 16],
        rows:po2, freeze:1, filter:'A1:W' + po2.length },
      { name:I18n.s('DFR'), cols:[12, 11, 24, 30, 14, 44, 14, 20, 16, 12, 12, 16, 16, 16, 16],
        rows:dfr, freeze:1, filter:'A1:O' + dfr.length }
    ].concat(pmTabs).concat(Rep.dayTabs(me.code, a.t)).concat(extra.map(function (t) {
      t.name = I18n.s(t.name); return t; })), opt);
  },
  /* The derived sheets, built for ONE employee and ONE day, so the day's own workbook carries the
     same "Failed visits" / "Day plan + EOD" tabs the Data tab produces — one builder, so the two can
     never disagree about a column or a format. */
  dayTabs: function (code, d) {
    var want = {}; want[String(code || '').toUpperCase()] = 1;
    var sub = code + '  ·  ' + dmy(d);
    return ['DayPlan', 'Eod', 'Attendance', 'FailedVisits'].map(function (kind) {
      var rows = Rep.ANY[kind].src(want, d, d);
      if (!rows.length) return null;
      return Rep.anySheet(kind, rows, null, sub + '  ·  ' + rows.length + ' row');
    }).filter(Boolean);
  },
  /* ── fold a short table into the main sheet instead of giving it a tab of its own ── */
  FOLD:8,
  fold: function (main, tabs) {
    var keep = [];
    (tabs || []).forEach(function (t) {
      if (!t || !t.rows) return;
      var body = t.rows.length - (t.head || 1);          /* data rows, header(s) excluded */
      if (body <= 0) return;                             /* nothing to show at all */
      if (body > Rep.FOLD) { keep.push(t); return; }
      /* an empty title means the table already starts with its own heading row */
      if (t.title === '') main.push([]);
      else main.push([], [Xl.t(I18n.s(t.title || t.name), Xl.S.L)]);
      t.rows.forEach(function (r) { main.push(r); });
    });
    return keep;
  },

  /* ─── my orders for a month ─── */
  /* the TA/DA claim as a workbook: the summary the finance team reads, then every day with what was
     claimed and why, so an approver never has to ask how a number was reached */
  tada: function (m) {
    var S = Tada.slab(), e = DB.emp(DB.me.code) || {}, t = Tada.total(), r = Tada.row();
    var ttl = Rep.ttl('GARUDA \u2014 TA / DA claim', monthName(m) + '\u00b7  ' + DB.me.name +
      ' (' + DB.me.code + ')', 7);
    var s1 = ttl.rows;
    s1.push([Xl.b('EMPLOYEE')]);
    s1.push(['Employee', Xl.t(DB.me.name), 'Code', Xl.t(DB.me.code)]);
    s1.push(['Designation', Xl.t(e.Designation || DB.me.desig || '\u2014'), 'Policy slab', Xl.t(S.name)]);
    s1.push(['HQ', Xl.t(e.HQ || '\u2014'), 'Zone', Xl.t(e.Zone || '\u2014')]);
    s1.push(['ASM', Xl.t(e.AsmName || '\u2014'), 'HOD', Xl.t(e.HodName || '\u2014')]);
    s1.push(['Status', Xl.t(r.Status || 'Draft'), 'Month', Xl.t(monthName(m))]);
    s1.push([], [Xl.b('CLAIM')]);
    s1.push(['Head', 'Amount (\u20b9)', '', '', '', '', ''].map(Xl.h));
    [['DA (daily allowance)', t.da], ['TA (travel allowance)', t.ta],
     ['Lodging cost', t.lodge], ['Team meeting', t.meet]]
      .forEach(function (x) { s1.push([Xl.t(x[0]), Xl.m(x[1])]); });
    s1.push([Xl.t('TOTAL', Xl.S.tot), Xl.m(t.grand, Xl.S.totM)]);
    if (t.deduct) {
      s1.push([Xl.t('HOD deduction'), Xl.m(-t.deduct)]);
      s1.push([Xl.t('NET PAYABLE', Xl.S.tot), Xl.m(t.net, Xl.S.totM)]);
    }
    s1.push([], [Xl.b('DAYS')]);
    s1.push(['Claim days', Xl.n(t.days), 'Outstation nights', Xl.n(t.nights)]);
    s1.push(['HQ days', Xl.n(t.byStation.hq), 'Ex-HQ visits', Xl.n(t.byStation.ex)]);
    s1.push(['Outstation visits', Xl.n(t.byStation.out), 'Meeting city',
             Xl.t(r.MeetCity || '\u2014')]);
    s1.push(['Outstation days', Xl.n(t.byStation.out), 'Meeting days', Xl.n(t.byStation.meet)]);
    s1.push(['Off / leave', Xl.n(t.byStation.off), 'Warnings', Xl.n(t.warn)]);

    var ded = Tada.ded(r);
    var d2 = [['Date', 'Day', 'Station', 'City', 'Nights', 'DA (\u20b9)', 'TA (\u20b9)',
               'Lodge cost (\u20b9)', 'Day total (\u20b9)', 'HOD deduction (\u20b9)', 'Net TA/DA (\u20b9)',
               'HOD reason', 'Bills needed', 'How it was worked out', 'Warning', 'Note'].map(Xl.h)];
    var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    Tada.dates().forEach(function (d) {
      var row = Tada.days[d], c = Tada.calc(d), dd = ded[d] || {}, dt = Tada.dayTot(c);
      d2.push([Xl.dt(d), Xl.t(DAY[new Date(d + 'T00:00:00').getDay()]), Xl.t(Tada.stLbl(row.st)),
        Xl.t(row.city || ''), Xl.n(row.night),
        Xl.m(c.da), Xl.m(c.ta), Xl.m(c.lodge),
        Xl.m(dt), Xl.m(num(dd.amt)), Xl.m(Math.max(0, dt - num(dd.amt))), Xl.t(dd.note || '', Xl.S.wrap),
        Xl.t(c.bills.join(', '), Xl.S.wrap), Xl.t(c.why.join(' \u00b7 '), Xl.S.wrap),
        Xl.t(c.warn.join(' \u00b7 '), Xl.S.wrap), Xl.t(row.note, Xl.S.wrap)]);
    });
    d2.push([Xl.t('TOTAL', Xl.S.tot), '', '', '', Xl.n(t.nights, Xl.S.totI),
      Xl.m(t.da, Xl.S.totM), Xl.m(t.ta, Xl.S.totM), Xl.m(t.lodge, Xl.S.totM),
      Xl.m(t.grand - t.meet, Xl.S.totM), Xl.m(t.deduct, Xl.S.totM), Xl.m(t.net, Xl.S.totM), '', '', '', '', '']);

    var p2r = [['Station', 'Travel', 'Food'].map(Xl.h)];
    [['HQ', S.hq], ['Ex-HQ', S.ex], ['Outstation', S.out]].forEach(function (x) {
      var P2 = x[1], bits = [];
      if (P2.da) bits.push('DA ' + P2.da);
      if (P2.metro || P2.nonMetro) bits.push('DA ' + P2.metro + ' metro / ' + P2.nonMetro + ' non-metro');
      if (P2.perKm) bits.push(P2.perKm + '/km' + (P2.kmCap ? ' upto ' + P2.kmCap : ''));
      if (P2.tickets) bits.push('tickets on actuals');
      if (P2.cab) bits.push('cab on actuals');
      var food = P2.foodMonth ? P2.foodMonth + ' / month' : P2.food ? P2.food + ' / day'
        : (P2.foodMetro ? P2.foodMetro + ' metro / ' + P2.foodNonMetro + ' non-metro' : '\u2014');
      p2r.push([Xl.t(x[0]), Xl.t(bits.join(' \u00b7 ')), Xl.t(food)]);
    });
    p2r.push([Xl.t('Lodging', Xl.S.tot), Xl.t(S.lodge.nonMetro + ' non-metro \u00b7 ' + S.lodge.metro +
      ' metro \u00b7 ' + S.lodge.mumbai + ' Mumbai'), Xl.t('')]);
    p2r.push([Xl.t('Travel class'), Xl.t(S.travel, Xl.S.wrap), Xl.t('')]);

    return Xl.save('TADA_' + DB.me.code + '_' + m, [
      { name:I18n.s('Claim'), cols:[26, 16, 16, 14, 10, 10, 10], rows:s1, merges:ttl.merges },
      { name:I18n.s('Day-wise'),
        cols:[11, 6, 20, 16, 7, 11, 11, 12, 12, 13, 13, 26, 22, 34, 26, 22],
        rows:d2, freeze:1, filter:'A1:P' + d2.length },
      { name:I18n.s('Policy'), cols:[16, 52, 30], rows:p2r, freeze:1 }
    ]);
  },
  orders: function (m) {
    var ord = DB.mine('SecOrders').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; })
      .sort(function (a, b) { return String(a.Date).localeCompare(String(b.Date)); });
    var lines = DB.mine('SecOrderLines').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var sum = function (g, f) { return g.reduce(function (x, o) { return x + num(o[f]); }, 0); };

    var t = Rep.ttl('GARUDA — Mere orders', monthName(m) + '·  ' + DB.me.name + ' (' + DB.me.code + ')', 6);
    var s1 = t.rows, e0 = DB.emp(DB.me.code) || {};
    /* the same block the EOD workbook opens with — whoever this file is forwarded to has to be able
       to tell whose month it is and who it rolls up to, without asking */
    s1.push([Xl.b('EMPLOYEE & REPORTING')]);
    s1.push(['Employee', Xl.t(DB.me.name), 'Code', Xl.t(DB.me.code)]);
    s1.push(['Designation', Xl.t(e0.Designation || DB.me.desig || '—'), 'Date of joining', Xl.t(dmy(DB.doj(DB.me.code)))]);
    s1.push(['HQ', Xl.t(e0.HQ || '—'), 'Zone', Xl.t(e0.Zone || '—')]);
    s1.push(['ASM', Xl.t(e0.AsmName || '—'), 'Mobile', Xl.t(e0.AsmMobile || '—')]);
    s1.push(['RSM', Xl.t(e0.RsmName || '—'), 'Mobile', Xl.t(e0.RsmMobile || '—')]);
    s1.push(['ZSM', Xl.t(e0.ZmName || '—'), 'Mobile', Xl.t(e0.ZmMobile || '—')]);
    s1.push(['HOD', Xl.t(e0.HodName || '—'), 'Mobile', Xl.t(e0.HodMobile || '—')]);
    s1.push([], [Xl.b('MONTH TOTAL')]);
    s1.push(['Total visits', Xl.n(ord.length)]);
    s1.push(['Order mila', Xl.n(ord.filter(function (o) { return num(o.TotUnits) > 0; }).length)]);
    s1.push(['Order value', Xl.m(sum(ord, 'TotValue'))]);
    s1.push(['NSV (₹ Lakh)', Xl.d2(sum(ord, 'TotNsvLakh'))]);
    s1.push([], [Xl.b('STATUS')], ['Status', 'Store', 'Value (₹)', 'NSV (₹L)', '', ''].map(Xl.h));
    ['Billing Done', 'Order in Process', 'Cancel Order'].forEach(function (x) {
      var g = ord.filter(function (o) { return String(o.Status) === x; });
      s1.push([Xl.t(x), Xl.n(g.length), Xl.m(sum(g, 'TotValue')), Xl.d2(sum(g, 'TotNsvLakh')), '', '']);
    });

    var o2 = [['Date', 'PO', 'Store', 'Code', 'City', 'Distributor', 'Source', 'Status', 'SKU', 'Units',
               'Value (₹)', 'NSV (₹L)', 'Remarks', 'Photos'].map(Xl.h)];
    ord.forEach(function (o) {
      o2.push([Xl.dt(o.Date), Xl.t(o.PoNumber), Xl.t(o.StoreName), Xl.t(o.CompanyCode), Xl.t(o.City),
        Xl.t(o.DbName), Xl.t(o.Source), Xl.t(o.Status), Xl.n(o.TotSku), Xl.n(o.TotUnits),
        Xl.m(o.TotValue), Xl.d2(o.TotNsvLakh), Xl.t(o.Remarks, Xl.S.wrap),
        Rep.photo(o.StoreName, o.Date, o.CompanyCode)]);
    });
    o2.push([Xl.t('TOTAL', Xl.S.tot), '', '', '', '', '', '', '', '', Xl.n(sum(ord, 'TotUnits'), Xl.S.totI),
      Xl.m(sum(ord, 'TotValue'), Xl.S.totM), Xl.d2(sum(ord, 'TotNsvLakh'), Xl.S.totD), '', '']);

    var l2 = [['Date', 'Employee', 'Code', 'PO', 'Store', 'SKU code', 'Product', 'Brand', 'Category',
               'MRP (₹)', 'Units', 'MRP value (₹)', 'Order value (₹)', 'NSV (₹L)', 'MSL'].map(Xl.h)];
    lines.forEach(function (x) {
      l2.push([Xl.dt(x.Date), Xl.t(DB.me.name), Xl.t(DB.me.code), Xl.t(x.PoNumber), Xl.t(x.StoreName),
        Xl.t(x.Sku), Xl.t(x.SkuName), Xl.t(x.Brand), Xl.t(x.Category),
        Xl.m(x.Mrp), Xl.n(x.Units), Xl.m(num(x.Units) * num(x.Mrp)), Xl.m(x.Value), Xl.d2(x.NsvLakh),
        Xl.t(/^msl$/i.test(String(x.MslStatus || '')) ? 'MSL' : '')]);
    });

    var per = {};
    ord.forEach(function (o) {
      var k = o.StoreName || '—';
      per[k] = per[k] || { v:0, n:0, c:0, u:0, city:o.City };
      per[k].v += num(o.TotValue); per[k].n += num(o.TotNsvLakh);
      per[k].u += num(o.TotUnits); per[k].c++;
    });
    var s3 = [['Store', 'City', 'Visits', 'Units', 'Value (₹)', 'NSV (₹L)'].map(Xl.h)];
    Object.keys(per).sort(function (a, b) { return per[b].v - per[a].v; }).forEach(function (k) {
      s3.push([Xl.t(k), Xl.t(per[k].city), Xl.n(per[k].c), Xl.n(per[k].u), Xl.m(per[k].v), Xl.d2(per[k].n)]);
    });

    Xl.save('MyOrders_' + DB.me.code + '_' + m, [
      { name:'Summary', cols:[26, 14, 14, 12, 10, 10], rows:s1, merges:t.merges },
      { name:'Orders', cols:[11, 16, 30, 12, 14, 22, 13, 16, 7, 8, 13, 10, 26, 12], rows:o2, freeze:1, filter:'A1:N' + o2.length },
      { name:'Order lines', cols:[11, 16, 28, 15, 46, 14, 8, 12, 10, 7], rows:l2, freeze:1, filter:'A1:J' + l2.length },
      { name:'Store-wise', cols:[30, 14, 8, 9, 14, 11], rows:s3, freeze:1, filter:'A1:F' + s3.length }
    ]);
  },

  /* ─── my month performance ─── */
  month: function () {
    var m = today().slice(0, 7);
    var ord = DB.mine('SecOrders').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var lines = DB.mine('SecOrderLines').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var ns = DB.mine('NewStores').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var pa = DB.mine('PosmAudit').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var eods = DB.mine('Eod').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var sum = function (g, f) { return g.reduce(function (x, o) { return x + num(o[f]); }, 0); };
    var mtd = num(DB.cfg('MTD @24 Days - Working', 36)), nsv = sum(ord, 'TotNsvLakh');

    var t = Rep.ttl('GARUDA — Mera performance', monthName(m) + '·  ' + DB.me.name + ' (' + DB.me.code + ')', 6);
    var k = t.rows;
    k.push(['Kya', 'Target', 'Achieve', 'Gap', '%', ''].map(Xl.h));
    k.push([Xl.t('NSV (₹ Lakh)'), Xl.d2(mtd), Xl.d2(nsv), Xl.d2(nsv - mtd), Xl.p(Rep.pct(nsv, mtd)),
      Xl.t(nsv >= mtd ? 'ACHIEVED' : 'SHORT', nsv >= mtd ? Xl.S.good : Xl.S.bad)]);
    k.push([], [Xl.b('MONTH TOTALS')]);
    var days = {}; ord.forEach(function (o) { days[toISO(o.Date)] = 1; });
    [['Working days (order wale)', Object.keys(days).length], ['Total visits', ord.length],
     ['Order mila', ord.filter(function (o) { return num(o.TotUnits) > 0; }).length],
     ['Billing done', ord.filter(function (o) { return o.Status === 'Billing Done'; }).length],
     ['Naye outlet', ns.length], ['POSM audit', pa.length], ['EOD filed', eods.length],
     ['Total SKU lines', lines.length]].forEach(function (r) { k.push([Xl.t(r[0]), Xl.n(r[1])]); });
    k.push(['Order value', Xl.m(sum(ord, 'TotValue'))]);

    var dmap = {};
    ord.forEach(function (o) {
      var d = toISO(o.Date);
      dmap[d] = dmap[d] || { c:0, p:0, u:0, v:0, n:0 };
      dmap[d].c++; if (num(o.TotUnits) > 0) dmap[d].p++;
      dmap[d].u += num(o.TotUnits); dmap[d].v += num(o.TotValue); dmap[d].n += num(o.TotNsvLakh);
    });
    var dw = [['Date', 'Visits', 'Order mila', 'Strike %', 'Units', 'Value (₹)', 'NSV (₹L)'].map(Xl.h)];
    Object.keys(dmap).sort().forEach(function (d) {
      var x = dmap[d];
      dw.push([Xl.dt(d), Xl.n(x.c), Xl.n(x.p), Xl.p(Rep.pct(x.p, x.c)), Xl.n(x.u), Xl.m(x.v), Xl.d2(x.n)]);
    });
    dw.push([Xl.t('TOTAL', Xl.S.tot), Xl.n(ord.length, Xl.S.totI), '', '',
      Xl.n(sum(ord, 'TotUnits'), Xl.S.totI), Xl.m(sum(ord, 'TotValue'), Xl.S.totM), Xl.d2(nsv, Xl.S.totD)]);

    var bv = {}, bn = {};
    lines.forEach(function (x) { var b = x.Brand || 'Other';
      bv[b] = (bv[b] || 0) + num(x.Value); bn[b] = (bn[b] || 0) + num(x.NsvLakh); });
    var bw = [['Brand', 'Value (₹)', 'NSV (₹L)', '% NSV'].map(Xl.h)];
    Object.keys(bn).sort(function (a, b) { return bn[b] - bn[a]; }).forEach(function (b) {
      bw.push([Xl.t(b), Xl.m(bv[b]), Xl.d2(bn[b]), Xl.p(Rep.pct(bn[b], nsv))]);
    });

    var ew = [['Date', 'SC', 'TC', 'PC', 'NSO', 'POSM', 'MSL', 'Order value (₹)', 'NSV (₹L)', 'Remarks'].map(Xl.h)];
    eods.sort(function (a, b) { return String(a.Date).localeCompare(String(b.Date)); }).forEach(function (r) {
      ew.push([Xl.dt(r.Date), Xl.n(r.Sc), Xl.n(r.Tc), Xl.n(r.Pc), Xl.n(r.Nso), Xl.n(r.PosmCount),
        Xl.n(r.MslCount), Xl.m(r.OrderValue), Xl.d2(r.NsvLakh), Xl.t(r.Remarks, Xl.S.wrap)]);
    });

    Xl.save('Summary_' + DB.me.code + '_' + m, [
      { name:'Month KPI', cols:[28, 13, 13, 12, 9, 13], rows:k, merges:t.merges },
      { name:'Day-wise', cols:[11, 8, 11, 10, 9, 14, 11], rows:dw, freeze:1 },
      { name:'Brand-wise', cols:[24, 14, 11, 9], rows:bw, freeze:1 },
      { name:'EOD day-wise', cols:[11, 7, 7, 7, 7, 8, 8, 15, 11, 28], rows:ew, freeze:1 }
    ]);
  },

  /* ─── admin: whole team, one month ─── */
  team: function (m) {
    var ord = DB.rows('SecOrders').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var ns = DB.rows('NewStores').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var pa = DB.rows('PosmAudit').filter(function (r) { return toISO(r.Date).slice(0, 7) === m; });
    var sum = function (g, f) { return g.reduce(function (x, o) { return x + num(o[f]); }, 0); };

    var per = {};
    ord.forEach(function (o) {
      var k = String(o.EmpName || o.EmpCode || '—');
      per[k] = per[k] || { c:0, p:0, v:0, n:0, d:{}, code:o.EmpCode };
      per[k].c++; if (num(o.TotUnits) > 0) per[k].p++;
      per[k].v += num(o.TotValue); per[k].n += num(o.TotNsvLakh); per[k].d[toISO(o.Date)] = 1;
    });
    var t = Rep.ttl('GARUDA — Team report', monthName(m) + '·  ' + Object.keys(per).length + ' employee', 9);
    var r1 = t.rows;
    r1.push(['Employee', 'Code', 'Days', 'Visits', 'Order mila', 'Strike %', 'Value (₹)', 'NSV (₹L)', 'Naye outlet'].map(Xl.h));
    Object.keys(per).sort(function (a, b) { return per[b].n - per[a].n; }).forEach(function (k) {
      var x = per[k];
      r1.push([Xl.t(k), Xl.t(x.code), Xl.n(Object.keys(x.d).length), Xl.n(x.c), Xl.n(x.p),
        Xl.p(Rep.pct(x.p, x.c)), Xl.m(x.v), Xl.d2(x.n),
        Xl.n(ns.filter(function (y) { return String(y.EmpName) === k; }).length)]);
    });
    r1.push([Xl.t('TEAM TOTAL', Xl.S.tot), Xl.t('', Xl.S.tot), Xl.t('', Xl.S.tot), Xl.n(ord.length, Xl.S.totI),
      Xl.n(ord.filter(function (o) { return num(o.TotUnits) > 0; }).length, Xl.S.totI), Xl.t('', Xl.S.tot),
      Xl.m(sum(ord, 'TotValue'), Xl.S.totM), Xl.d2(sum(ord, 'TotNsvLakh'), Xl.S.totD), Xl.n(ns.length, Xl.S.totI)]);

    var o2 = [['Date', 'Employee', 'PO', 'Store', 'City', 'Distributor', 'Status', 'SKU', 'Units',
               'Value (₹)', 'NSV (₹L)', 'Photos'].map(Xl.h)];
    ord.sort(function (a, b) { return String(a.Date).localeCompare(String(b.Date)); }).forEach(function (o) {
      o2.push([Xl.dt(o.Date), Xl.t(o.EmpName), Xl.t(o.PoNumber), Xl.t(o.StoreName), Xl.t(o.City),
        Xl.t(o.DbName), Xl.t(o.Status), Xl.n(o.TotSku), Xl.n(o.TotUnits), Xl.m(o.TotValue),
        Xl.d2(o.TotNsvLakh), Rep.photo(o.StoreName, o.Date, o.CompanyCode)]);
    });

    var pw = [['Date', 'Employee', 'Store', 'Element', 'Condition', 'Visibility', 'Action', 'Photos'].map(Xl.h)];
    pa.forEach(function (r) {
      pw.push([Xl.dt(r.Date), Xl.t(r.EmpName), Xl.t(r.StoreName), Xl.t(r.Element), Xl.t(r.Condition),
        Xl.t(r.Visibility), Xl.t(r.Action), Rep.photo(r.StoreName, r.Date, r.CompanyCode)]);
    });

    Xl.save('Team_' + m, [
      { name:'Rep-wise', cols:[26, 12, 8, 8, 11, 10, 14, 11, 12], rows:r1, merges:t.merges, freeze:4 },
      { name:'All orders', cols:[11, 22, 16, 30, 14, 22, 16, 7, 8, 13, 10, 12], rows:o2, freeze:1, filter:'A1:L' + o2.length },
      { name:'POSM', cols:[11, 22, 30, 14, 13, 13, 14, 12], rows:pw, freeze:1, filter:'A1:H' + pw.length }
    ]);
  },

  /* ─── admin data browser: one sheet, formatted ─── */
  /* ══ ANY report, for anyone, over any range ══
     The console's Data tab: pick a report, an employee (or all), a date range, and get a workbook that
     reads like a report and not like a database dump — a title block saying exactly what was asked for,
     friendly column names, money and dates as real cell types, a total row where a total means something,
     and (for orders) the SKU lines on their own tab. */
  /* the parent order behind an order LINE — memoised, because a 400-line report would otherwise
     rescan every order for every line */
  _ord:null, _ordFor:'',
  ord: function (r) {
    var po = String(r.PoNumber || '');
    if (!po) return {};
    if (Rep._ordFor !== DB.pulledAt || !Rep._ord) {
      Rep._ord = {}; Rep._ordFor = DB.pulledAt;
      DB.rows('SecOrders').forEach(function (o) { Rep._ord[String(o.PoNumber)] = o; });
    }
    return Rep._ord[po] || {};
  },
  /* the store master row behind a transactional row, by client id or company code. A POSM audit carries
     the store's name and city but not its state or its distributor — the master has both, and a reader
     filtering POSM by distributor should not have to join two sheets by hand. Indexed once per pull. */
  _st:null, _stFor:null,
  store: function (r) {
    if (Rep._stFor !== DB.pulledAt || !Rep._st) {
      Rep._st = {}; Rep._stFor = DB.pulledAt;
      (DB.m.Master_Stores || []).forEach(function (s) {
        var a = String(s.ClientId || '').trim().toUpperCase(), b = String(s.CompanyCode || '').trim().toUpperCase();
        if (a) Rep._st[a] = s;
        if (b && !Rep._st[b]) Rep._st[b] = s;
      });
    }
    var k1 = String(r.ClientId || '').trim().toUpperCase(), k2 = String(r.CompanyCode || '').trim().toUpperCase();
    return Rep._st[k1] || Rep._st[k2] || {};
  },
  /* ── what a DAY actually produced, per employee ──
     The EOD sheet and the Day-plan sheet both have to be readable on their own — "in depth" means the
     plan and the outcome are both on the row, not split across a third clubbed sheet. Rather than each
     column re-scanning every order (31 days × 4 tables is a spreadsheet that takes seconds to build),
     the whole period is indexed ONCE per pull, keyed employee|date. */
  _act:null, _actFor:null,
  dayAct: function (code, d) {
    if (Rep._actFor !== DB.pulledAt || !Rep._act) {
      var m = {};
      var ens = function (c, dt) {
        var k = String(c || '').toUpperCase() + '|' + toISO(dt);
        if (!m[k]) m[k] = { visits:0, productive:0, noOrder:0, tele:0, units:0, sku:0, mrp:0, nsv:0,
                            msl:0, nonMsl:0, posmA:0, posmR:0, nso:0, stockNotes:0, photos:0 };
        return m[k];
      };
      DB.rows('SecOrders').forEach(function (o) {
        var r = ens(o.EmpCode, o.Date);
        r.visits++;
        if (num(o.TotUnits) > 0 && !/cancel|no.?order/i.test(String(o.Status || ''))) r.productive++;
        else r.noOrder++;
        if (/telephonic/i.test(String(o.Source || ''))) r.tele++;
        r.units += num(o.TotUnits); r.sku += num(o.TotSku);
        r.mrp += num(o.TotValue); r.nsv += num(o.TotNsvLakh);
      });
      DB.rows('SecOrderLines').forEach(function (l) {
        var r = ens(l.EmpCode, l.Date);
        if (/^msl$/i.test(String(l.MslStatus || ''))) r.msl++; else r.nonMsl++;
      });
      DB.rows('PosmAudit').forEach(function (x) { ens(x.EmpCode, x.Date).posmA++; });
      DB.rows('PosmRequirement').forEach(function (x) { ens(x.EmpCode, x.Date).posmR++; });
      DB.rows('NewStores').forEach(function (x) { ens(x.EmpCode, x.Date).nso++; });
      DB.rows('StockRemark').forEach(function (x) { ens(x.EmpCode, x.Date).stockNotes++; });
      DB.rows('Photos').forEach(function (x) { ens(x.EmpCode, x.Date).photos++; });
      Rep._act = m; Rep._actFor = DB.pulledAt;
    }
    return Rep._act[String(code || '').toUpperCase() + '|' + toISO(d)] ||
      { visits:0, productive:0, noOrder:0, tele:0, units:0, sku:0, mrp:0, nsv:0, msl:0, nonMsl:0,
        posmA:0, posmR:0, nso:0, stockNotes:0, photos:0 };
  },
  /* the saved DayPlan row for an employee-day, and the published Master_PJP row for the same day.
     Both indexed once per pull — a 31-day sheet asks for them on every row. */
  _pl:null, _plFor:null,
  plan: function (code, d) {
    if (Rep._plFor !== DB.pulledAt || !Rep._pl) {
      Rep._pl = {}; Rep._plFor = DB.pulledAt;
      DB.rows('DayPlan').forEach(function (p) {
        Rep._pl[String(p.EmpCode || '').toUpperCase() + '|' + toISO(p.Date)] = p; });
    }
    return Rep._pl[String(code || '').toUpperCase() + '|' + toISO(d)] || {};
  },
  _pj:null, _pjFor:null,
  pjpOn: function (code, d) {
    if (Rep._pjFor !== DB.pulledAt || !Rep._pj) {
      Rep._pj = {}; Rep._pjFor = DB.pulledAt;
      (DB.m.Master_PJP || []).forEach(function (p) {
        Rep._pj[String(p.Code || '').toUpperCase() + '|' + toISO(p.Date)] = p; });
    }
    return Rep._pj[String(code || '').toUpperCase() + '|' + toISO(d)] || {};
  },
  /* ONE attendance rule, used by the Attendance sheet, the Day-plan sheet and anything else that has to
     say whether a day was worked — so the three can never disagree about what Absent means. */
  att: function (planRow) {
    var kind = Team.KIND(Pjp.ww((planRow && planRow.WorkingWith) || 'Self Working'));
    if (kind === 'F' && !Plan.started(planRow || {})) return 'Absent';
    return Rep.ATT[kind] || Rep.DASH;
  },
  /* ── the day's Drive folder ──
     Photos are filed Employee / Date / Shop, so every photo taken on a day shares a parent. A day-level
     sheet (EOD, Day plan, Attendance, DFR) gets ONE link that opens that day's folder — the shop-level
     sheets already link their own shop folder. Takes the first row's folder and walks up one level. */
  dayPhoto: function (code, d) {
    var iso = toISO(d), c = String(code || '').toUpperCase();
    var ps = DB.rows('Photos').filter(function (p) {
      return toISO(p.Date) === iso && String(p.EmpCode || '').toUpperCase() === c; });
    if (!ps.length) return Xl.t(Rep.DASH);
    var url = '';
    for (var i = 0; i < ps.length && !url; i++) url = ps[i].FolderUrl || ps[i].DriveUrl || '';
    return url ? Xl.link(url, ps.length + ' photo') : Xl.t(Rep.DASH);
  },
  /* which beat the rep actually worked on a given day — the join that lets an ORDER (which carries a
     city but no beat) be credited to a beat. The day's own plan wins; the published PJP is the
     fallback for a day the rep never saved a plan for. */
  _beat:null, _beatFor:'',
  beatOn: function (code, d) {
    if (Rep._beatFor !== DB.pulledAt || !Rep._beat) {
      Rep._beat = {}; Rep._beatFor = DB.pulledAt;
      (DB.m.Master_PJP || []).forEach(function (p) {
        var k = String(p.Code || '').toUpperCase() + '|' + toISO(p.Date);
        Rep._beat[k] = { town:p.Town || '', beat:p.Beat || '', ww:Pjp.ww(p.Ww) };
      });
      DB.rows('DayPlan').forEach(function (p) {
        var k = String(p.EmpCode || '').toUpperCase() + '|' + toISO(p.Date);
        Rep._beat[k] = { town:p.Town || '', beat:p.Beat || '', ww:p.WorkingWith || '' };
      });
    }
    return Rep._beat[String(code || '').toUpperCase() + '|' + toISO(d)] || { town:'', beat:'', ww:'' };
  },
  /* MSL / Non MSL — never a blank cell, because blank reads as "no data" not as "not an MSL SKU" */
  msl: function (v) { return /^msl$/i.test(String(v || '')) ? 'MSL' : 'Non MSL'; },
  /* the attendance word for a day, from the day's Working-With */
  ATT:{ F:'Present', L:'Leave', O:'Weekly off', H:'Holiday', M:'Meeting' },
  inR: function (d, from, to) { var x = toISO(d); return !x || (x >= from && x <= to); },
  wants: function (want, code) { return !want || !!want[String(code || '').trim().toUpperCase()]; },
  /* ── never an empty cell ──
     A blank reads as "this column was never filled in", which is a different claim from "there is no
     value here". Every text / date / time column in every report says the second one out loud. */
  DASH:'—',
  /* ── one timestamp, TWO columns ──
     A single "05-08-2026, 10:39 AM" cell cannot be sorted by date, filtered by day, or pivoted by hour;
     splitting it gives a real date cell and a real time cell, and every row carries both. Handles the
     three shapes the app stores: a full ISO timestamp, a bare date, and a bare time-of-day string
     ("08:35 PM" — PlanAt / NotifiedAt / ClosedAt), which has a value for one column and not the other. */
  dpart: function (v) {
    if (v == null || v === '') return '';
    var s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    if (/^\d{1,2}:\d{2}/.test(s)) return '';                 /* a bare time has no date of its own */
    var d = (v instanceof Date) ? v : new Date(s);
    return isNaN(d.getTime()) ? '' : toISO(d);
  },
  tpart: function (v) {
    if (v == null || v === '') return '';
    var s = String(v).trim();
    if (/^\d{1,2}:\d{2}(:\d{2})?\s*([AaPp]\.?[Mm]\.?)?$/.test(s)) return s.toUpperCase().replace(/\s+/g, ' ');
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return '';            /* a bare date has no time of its own */
    var d = (v instanceof Date) ? v : new Date(s);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
  },

  ANY:{
    SecOrders:{ t:'Orders', cols:[
      ['Date', 'Date', 'd'], ['PoNumber', 'PO'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['ClientId', 'Client id'], ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      ['StoreType', 'Store type'], ['City', 'City'], ['State', 'State'],
      ['DbCode', 'Distributor code'], ['DbName', 'Distributor'],
      ['Source', 'Visit type'], ['Status', 'Status'],
      ['TotSku', 'SKU', 'n'], ['TotUnits', 'Units', 'n'],
      ['TotValue', 'MRP value', 'm'], ['TotNsvLakh', 'NSV ₹L', 'n'],
      ['BillingType', 'Billing'], ['BilledUnits', 'Invoiced units', 'n'],
      [function (r) { return Rep.DLV(r.Status); }, 'Delivery status', 'st'],
      [function (r) { return Rep.beatOn(r.EmpCode, r.Date).beat || ''; }, 'Beat'],
      ['Reason', 'Reason'], ['BillingRemark', 'Billing remark'], ['Remarks', 'Remarks'],
      [function (r) { return Rep.photo(r.StoreName, r.Date, r.CompanyCode); }, 'Photos', 'raw']]
      .concat(xlWhen('Ts', 'Punched'))
      .concat(xlWhen('DeliveredAt', 'Billed'))
      .concat([['HodAt', 'Approved at', 'dtm']]),
      tot:['TotSku', 'TotUnits', 'TotValue', 'TotNsvLakh', 'BilledUnits'] },
    SecOrderLines:{ t:'Order lines', cols:[
      ['Date', 'Date', 'd'], ['PoNumber', 'PO'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      [function (r) { return Rep.ord(r).ClientId || ''; }, 'Client id'],
      ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      [function (r) { return Rep.ord(r).City || ''; }, 'City'],
      [function (r) { return Rep.ord(r).DbCode || ''; }, 'Distributor code'],
      [function (r) { return Rep.ord(r).DbName || ''; }, 'Distributor'],
      [function (r) { return Rep.ord(r).StoreType || ''; }, 'Store type'],
      [function (r) { return Rep.ord(r).State || ''; }, 'State'],
      ['Sku', 'SKU code'], ['SkuName', 'Product'], ['Brand', 'Brand'],
      ['Category', 'Category'], ['SubCategory', 'Sub-category'],
      [function (r) { return Rep.msl(r.MslStatus); }, 'MSL'],
      ['Mrp', 'MRP', 'm'], ['Units', 'Units', 'n'], ['Value', 'MRP value', 'm'],
      ['NsvLakh', 'NSV ₹L', 'n'], ['Status', 'Status'],
      [function (r) { return Rep.DLV(r.Status); }, 'Delivery status', 'st'],
      [function (r) { return Rep.ord(r).Source || ''; }, 'Visit type'],
      ['LineId', 'Line id']],
      tot:['Units', 'Value', 'NsvLakh'] },
    /* ── EOD, in depth and standing on its own ──
       The stored row (what the rep closed the day with) PLUS what that day actually produced, recounted
       from the orders / lines / POSM / outlets themselves, and the plan's targets beside them so the row
       answers "was the day met" without a second sheet. This is what the clubbed "Day plan + EOD" tab
       used to be for; the depth now lives on the two real sheets instead. */
    Eod:{ t:'EOD', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      [function (r) { return Rep.plan(r.EmpCode, r.Date).WorkingWith || ''; }, 'Working with'],
      [function (r) { return Rep.beatOn(r.EmpCode, r.Date).town || ''; }, 'Town'],
      [function (r) { return Rep.beatOn(r.EmpCode, r.Date).beat || ''; }, 'Beat'],
      [function (r) { return Rep.plan(r.EmpCode, r.Date).Station || ''; }, 'Station'],
      /* target vs done, side by side */
      [function (r) { return num(Rep.plan(r.EmpCode, r.Date).ScTarget) || num(r.Sc); }, 'SC target', 'n'],
      ['Tc', 'TC (visits)', 'n'], ['Pc', 'PC (productive)', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).noOrder; }, 'No-order visits', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).tele; }, 'Telephonic', 'n'],
      [function (r) { return num(Rep.plan(r.EmpCode, r.Date).NsoTarget); }, 'NSO target', 'n'],
      ['Nso', 'NSO done', 'n'],
      [function (r) { return num(Rep.plan(r.EmpCode, r.Date).PosmTarget); }, 'POSM target', 'n'],
      ['PosmCount', 'POSM audit', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).posmR; }, 'POSM requirement', 'n'],
      ['MslCount', 'MSL lines', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).nonMsl; }, 'Non MSL lines', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).sku; }, 'SKU', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).units; }, 'Units', 'n'],
      ['OrderValue', 'MRP value', 'm'], ['NsvLakh', 'NSV ₹L', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).stockNotes; }, 'Stock remarks', 'n'],
      [function (r) { return Rep.plan(r.EmpCode, r.Date).PlanAt || ''; }, 'Login time'],
      ['ClosedAt', 'Day end time'], ['Remarks', 'Remarks'],
      [function (r) { return Rep.dayPhoto(r.EmpCode, r.Date); }, 'Photos', 'raw']]
      .concat(xlWhen('Ts', 'Punched')),
      tot:['Tc', 'Pc', 'Nso', 'PosmCount', 'MslCount', 'OrderValue', 'NsvLakh'] },
    /* ── the day plan, in depth and standing on its own ──
       The morning plan, what the APPROVED PJP said for that same day (which is what makes the off-PJP
       flag meaningful rather than just a Yes), whether the day was ever started, and what came of it. */
    DayPlan:{ t:'Day plans', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      [function (r) { return Rep.att(r); }, 'Attendance'],
      ['WorkingWith', 'Working with'], ['WwDetail', 'Working-with detail'], ['Station', 'Station'],
      ['State', 'State'], ['Town', 'Town'], ['Beat', 'Beat'],
      ['Week', 'Week'], ['Focus', 'Focus'],
      /* what the approved PJP asked for on this very day — the thing off-PJP is measured against */
      [function (r) { return Rep.pjpOn(r.EmpCode, r.Date).Ww || ''; }, 'PJP working with'],
      [function (r) { return Rep.pjpOn(r.EmpCode, r.Date).Town || ''; }, 'PJP town'],
      [function (r) { return Rep.pjpOn(r.EmpCode, r.Date).Beat || ''; }, 'PJP beat'],
      ['OffPjp', 'Off PJP'], ['Approval', 'Approval'], ['PjpStatus', 'Adherence'],
      ['PjpStatusBy', 'Adherence by'],
      ['ScTarget', 'SC target', 'n'], ['NsoTarget', 'NSO target', 'n'],
      ['PosmTarget', 'POSM target', 'n'],
      /* and what the day actually did against those targets */
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).visits; }, 'Stores visited', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).productive; }, 'Productive visits', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).nso; }, 'NSO done', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).posmA; }, 'POSM audit', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).units; }, 'Units', 'n'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).mrp; }, 'MRP value', 'm'],
      [function (r) { return Rep.dayAct(r.EmpCode, r.Date).nsv; }, 'NSV ₹L', 'n'],
      /* TWO moments, not three: when the plan was saved (that is when the morning image exists) and
         when it went out on WhatsApp, which IS the start of the day. StartAt is the full timestamp;
         the old separate "Notified at" said the same thing in a weaker format. */
      ['PlanAt', 'Login time'], ['NotifiedAt', 'Notified time'],
      [function (r) { return Rep.dayPhoto(r.EmpCode, r.Date); }, 'Photos', 'raw']]
      .concat(xlWhen('StartAt', 'Day start'))
      .concat(xlWhen('PjpStatusAt', 'Adherence set')),
      tot:['ScTarget', 'NsoTarget', 'PosmTarget'] },
    /* EVERY question the "Naya outlet" form asks, in the order it asks them, then the photos, then who
       decided what and when. Category and the two photo flags used to be saved and never reported —
       a question worth asking is a question worth carrying into the report. */
    NewStores:{ t:'New outlets', cols:[
      ['Date', 'Date', 'd'], ['StoreId', 'Store id'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['DbCode', 'Distributor code'], ['DbName', 'Distributor'],
      ['StoreName', 'Store'], ['StoreType', 'Store type'],
      ['State', 'State'], ['Town', 'Town'], ['Beat', 'Beat'],
      ['Address', 'Address'], ['Pincode', 'Pincode'], ['Category', 'Category'],
      ['OwnerName', 'Owner'], ['OwnerMobile', 'Owner mobile'],
      ['DaySales', 'Day sale', 'm'], ['MonthlyTurnover', 'Monthly turnover', 'm'],
      ['Reason', 'Kyun add kiya'],
      [function (r) { return r.PhotoFront ? 'Yes' : 'No'; }, 'Front photo'],
      [function (r) { return r.PhotoInside ? 'Yes' : 'No'; }, 'Inside photo'],
      [function (r) { return Rep.photo(r.StoreName, r.Date, r.CompanyCode); }, 'Photos', 'raw'],
      ['Status', 'Status'], ['StatusReason', 'Status note']]
      .concat(xlWhen('StatusAt', 'Status'))
      .concat([['HodAt', 'Approved at', 'dtm']])
      .concat(xlWhen('Ts', 'Punched')),
      tot:['DaySales', 'MonthlyTurnover'] },
    /* every field the audit form fills, plus the store's own identifiers and the Drive folder. The
       distributor and the state come from the store master — the audit row does not carry them, but a
       reader filtering POSM by distributor should not have to go and join two sheets by hand. */
    PosmAudit:{ t:'POSM audit', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['ClientId', 'Client id'], ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      ['StoreType', 'Store type'], ['City', 'City'],
      [function (r) { return Rep.store(r).State || ''; }, 'State'],
      [function (r) { return Rep.store(r).DbCode || ''; }, 'Distributor code'],
      [function (r) { return Rep.store(r).DbName || ''; }, 'Distributor'],
      ['PosmStatus', 'POSM there'], ['Element', 'Element'], ['PosmType', 'Type'],
      ['Location', 'Location'], ['Brand', 'Brand'], ['AssetType', 'Asset type'],
      ['Period', 'Install period', 'd'], ['Dominance', 'Dominance'],
      ['Condition', 'Condition'], ['Visibility', 'Visibility'], ['Action', 'Action'],
      ['InstalledBy', 'Installed by'], ['VerifiedBy', 'Verified by'],
      ['VerifyDate', 'Verified on', 'd'], ['NextReview', 'Next review', 'd'],
      [function (r) { return Rep.photo(r.StoreName, r.Date, r.CompanyCode); }, 'Photos', 'raw'],
      ['Remarks', 'Remarks']].concat(xlWhen('Ts', 'Punched')) },
    PosmRequirement:{ t:'POSM requirement', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['ClientId', 'Client id'], ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      ['StoreType', 'Store type'], ['City', 'City'],
      [function (r) { return Rep.store(r).State || ''; }, 'State'],
      [function (r) { return Rep.store(r).DbCode || ''; }, 'Distributor code'],
      [function (r) { return Rep.store(r).DbName || ''; }, 'Distributor'],
      ['Requirement', 'Needed'], ['Element', 'Element'], ['PosmType', 'Type'],
      ['Location', 'Location'], ['Brand', 'Brand'], ['AssetType', 'Asset type'],
      ['Dominance', 'Dominance'], ['Qty', 'Qty', 'n'],
      ['MonthlyIncome', 'Store income', 'm'], ['DaySale', 'Day sale', 'm'],
      ['NeededBy', 'Needed by', 'd'],
      [function (r) { return Rep.photo(r.StoreName, r.Date, r.CompanyCode); }, 'Photos', 'raw'],
      ['Remarks', 'Remarks'], ['Status', 'Status'], ['StatusReason', 'Status note']]
      .concat(xlWhen('StatusAt', 'Status'))
      .concat([['HodAt', 'Approved at', 'dtm']])
      .concat(xlWhen('Ts', 'Punched')),
      tot:['Qty'] },
    TaDa:{ t:'TA DA', cols:[
      ['Month', 'Month'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['Designation', 'Designation'], ['Station', 'Station'],
      ['DaAmount', 'DA ₹', 'm'], ['TravelAmount', 'TA ₹', 'm'], ['LodgeAmount', 'Lodge ₹', 'm'],
      ['MeetAmount', 'Meeting ₹', 'm'], ['MeetCity', 'Meeting city'],
      ['Nights', 'Nights', 'n'], ['Total', 'Claim ₹', 'm'],
      ['DeductTotal', 'Deduction ₹', 'm'], ['NetTotal', 'Net TA/DA ₹', 'm'],
      ['FoodAmount', 'Food ₹', 'm'], ['OtherAmount', 'Other ₹', 'm'],
      ['Status', 'Status'], ['Revision', 'Revision', 'n'],
      ['HodRemarks', 'HOD message'], ['Remarks', 'Rep remark'],
      ['HodAt', 'Approved at', 'dtm']]
      .concat(xlWhen('SubmittedAt', 'Sent'))
      .concat(xlWhen('ReturnedAt', 'Returned')),
      tot:['DaAmount', 'FoodAmount', 'TravelAmount', 'LodgeAmount', 'MeetAmount', 'OtherAmount',
           'Total', 'DeductTotal', 'NetTotal'] },
    /* ── TA/DA, ONE ROW PER DAY ──
       The TaDa table stores a whole month as a single row with the days packed into DaysJson, which is
       the right shape for a claim (it is approved as one thing) and the wrong shape for a report: nobody
       can total a rep's outstation nights, or find the day a lodging bill came from, out of a JSON blob.
       This unpacks it — one row per claimed day, carrying the month's decision alongside so a day can be
       read without the parent, plus any per-day deduction the HOD applied. */
    TaDaDays:{ t:'TA DA day-wise', cols:[
      ['Date', 'Date', 'd'], ['Month', 'Month'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'], ['Designation', 'Designation'],
      ['DayType', 'Day type'], ['City', 'City'],
      ['WorkingWith', 'Working with'], ['Beat', 'Beat'],
      ['Da', 'DA ₹', 'm'], ['Ta', 'TA ₹', 'm'], ['Lodge', 'Lodging ₹', 'm'],
      ['Nights', 'Nights', 'n'], ['DayTotal', 'Day total ₹', 'm'],
      ['Deduct', 'Deduction ₹', 'm'], ['DeductNote', 'Deduction reason'],
      ['DayNet', 'Day net ₹', 'm'],
      ['Edited', 'Rep ne badla'], ['Note', 'Rep note'],
      ['Status', 'Claim status'], ['HodRemarks', 'HOD message'], ['HodAt', 'Approved at', 'dtm'],
      ['MonthTotal', 'Month claim ₹', 'm'], ['MonthNet', 'Month net ₹', 'm']],
      tot:['Da', 'Ta', 'Lodge', 'Nights', 'DayTotal', 'Deduct', 'DayNet'],
      src: function (want, from, to) {
        var out = [];
        DB.rows('TaDa').forEach(function (r) {
          if (!Rep.wants(want, r.EmpCode)) return;
          var days = {}, ded = {};
          try { days = JSON.parse(r.DaysJson || '{}') || {}; } catch (e) { days = {}; }
          try { ded = JSON.parse(r.DeductJson || '{}') || {}; } catch (e) { ded = {}; }
          Object.keys(days).sort().forEach(function (d) {
            var iso = toISO(d); if (!iso || iso < from || iso > to) return;
            var x = days[d] || {}, k = ded[d] || {};
            var da = num(x.da), ta = num(x.ta), lo = num(x.lodge);
            var tot = da + ta + lo, cut = num(k.amt);
            var pl = Rep.plan(r.EmpCode, iso);
            out.push({ Date:iso, Month:r.Month || iso.slice(0, 7),
              EmpCode:r.EmpCode, EmpName:r.EmpName || '', Designation:r.Designation || '',
              DayType:Tada.stLbl(x.st), City:x.city || '',
              WorkingWith:pl.WorkingWith || Rep.pjpOn(r.EmpCode, iso).Ww || '',
              Beat:Rep.beatOn(r.EmpCode, iso).beat || '',
              Da:da, Ta:ta, Lodge:lo, Nights:num(x.night), DayTotal:tot,
              Deduct:cut, DeductNote:k.why || k.note || k.reason || '',
              DayNet:Math.max(0, tot - cut),
              /* 'rep' means he typed over the policy default — worth seeing next to the amount */
              Edited:String(x.from || '') === 'rep' ? 'Yes' : 'No', Note:x.note || '',
              /* the month's decision, carried onto every day of it, so a day reads without the parent */
              Status:r.Status || '', HodRemarks:r.HodRemarks || '', HodAt:r.HodAt || '',
              MonthTotal:num(r.Total), MonthNet:num(r.NetTotal || (num(r.Total) - num(r.DeductTotal))) });
          });
        });
        return out.sort(function (a, b) {
          return String(a.Date).localeCompare(String(b.Date)) ||
                 String(a.EmpCode).localeCompare(String(b.EmpCode)); });
      } },
    Deviation:{ t:'Plan changes', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      /* what the APPROVED PJP said for this very day — the thing the change is measured against */
      [function (r) { return Rep.beatOn(r.EmpCode, r.Date).ww || ''; }, 'PJP working with'],
      ['PlannedTown', 'PJP town'], ['PlannedBeat', 'PJP beat'],
      ['NewWw', 'Asked working with'], ['NewTown', 'Asked town'], ['NewBeat', 'Asked beat'],
      ['NewStation', 'Asked station'],
      ['Status', 'Status'], ['TryCount', 'Try', 'n'],
      ['Reason', 'Rep reason'], ['HodRemarks', 'HOD remark'],
      ['HodAt', 'Approved at', 'dtm']]
      .concat(xlWhen('Ts', 'Asked')) },
    PjpDraft:{ t:'PJP drafts', cols:[
      ['Month', 'Month'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['Status', 'Status'], ['Coverage', 'Coverage'], ['Revision', 'Revision', 'n'],
      ['PublishedRows', 'Published days', 'n'], ['RejectReason', 'Reject reason'],
      ['HodAt', 'Approved at', 'dtm']]
      .concat(xlWhen('SubmittedAt', 'Sent'))
      .concat(xlWhen('PublishedAt', 'Published')) },
    Dfr:{ t:'Daily field report', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['StoreCount', 'Activities', 'n'], ['OrderCount', 'Orders', 'n']]
      .concat(xlWhen('Ts', 'Punched')), tot:['StoreCount', 'OrderCount'] },
    StockRemark:{ t:'Stock remarks', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['Kind', 'Kind'], ['Code', 'Code'], ['Name', 'Name'], ['Remark', 'Remark']]
      .concat(xlWhen('Ts', 'Punched')) },
    Photos:{ t:'Photos', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['Employee', 'Employee'],
      ['Module', 'Module'], ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      ['Slot', 'Slot'], ['FileName', 'File'],
      [function (r) { return Xl.link(r.DriveUrl, 'photo'); }, 'Photo', 'raw'],
      [function (r) { return Xl.link(r.FolderUrl, 'folder'); }, 'Shop folder', 'raw'],
      ['RecordId', 'Record id']].concat(xlWhen('Ts', 'Taken')) },
    ActivityLog:{ t:'Activity log', cols:[
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['Role', 'Role'], ['Kind', 'Kind'], ['Action', 'Action'],
      ['Ref', 'Reference'], ['Detail', 'Detail']].concat(xlWhen('Ts', 'At')) },

    /* ══════════════ DERIVED SHEETS — no tab of their own on the sheet ══════════════ */

    /* Every instance of a shop being visited that produced nothing. Not a status list: a visit with
       zero units booked counts even if nobody marked it cancelled. */
    /* ── no PO on a failed visit ──
       A visit that produced nothing produced no purchase order either, so there is no PO column here.
       The row still needs an identity (it is one row in SecOrders, keyed on that column), so it is
       reported as what it actually is: a visit reference. Field.novId gives a no-order visit an id that
       is visibly not a PO, and no PO number is consumed for it. */
    FailedVisits:{ t:'Failed visits', cols:[
      ['Date', 'Date', 'd'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['ClientId', 'Client id'], ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      ['StoreType', 'Store type'], ['City', 'City'], ['State', 'State'],
      [function (r) { return Rep.beatOn(r.EmpCode, r.Date).beat || ''; }, 'Beat'],
      ['DbCode', 'Distributor code'], ['DbName', 'Distributor'],
      ['Source', 'Visit type'], ['Status', 'Status'],
      [function (r) { return Rep.DLV(r.Status); }, 'Delivery status', 'st'],
      ['Reason', 'Why no order'], ['Remarks', 'Remarks'],
      [function (r) { return Rep.photo(r.StoreName, r.Date, r.CompanyCode); }, 'Photos', 'raw'],
      [function (r) { return String(r.PoNumber || ''); }, 'Visit reference']]
      .concat(xlWhen('Ts', 'Punched')),
      src: function (want, from, to) {
        return DB.rows('SecOrders').filter(function (o) {
          if (!Rep.wants(want, o.EmpCode)) return false;
          if (!Rep.inR(o.Date, from, to)) return false;
          return num(o.TotUnits) <= 0 || /cancel|no.?order/i.test(String(o.Status || ''));
        }).sort(function (a, b) { return String(toISO(a.Date)).localeCompare(String(toISO(b.Date))); });
      } },

    /* One row per employee per day: was he out, and if not, why. Built from the day's plan, falling
       back to the published PJP for a day no plan was ever saved for — otherwise a rep who simply
       never opened the app would silently vanish from his own attendance. */
    /* 'Day type' is gone: it was the single-letter code behind the Attendance column (F/L/O/H/M), so
       the sheet was saying the same thing twice, once in a language only the app speaks. */
    Attendance:{ t:'Attendance', cols:[
      ['Date', 'Date', 'd'], ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['Attendance', 'Attendance'], ['WorkingWith', 'Working with'],
      ['Station', 'Station'], ['State', 'State'], ['Town', 'Town'], ['Beat', 'Beat'],
      ['LoginAt', 'Login time']]
      .concat(xlWhen('StartAt', 'Day start'))
      .concat([['EndAt', 'Day end time'],
      /* 'From' (Day plan / PJP) is gone — it described how the app BUILT the row, not anything about
         the rep's day, and it was the one column on the sheet nobody could interpret. */
      ['Visits', 'Stores visited', 'n'], ['Orders', 'Orders', 'n'],
      ['MrpValue', 'MRP value', 'm'], ['Nsv', 'NSV ₹L', 'n'], ['Remarks', 'Remarks']]),
      tot:['Visits', 'Orders', 'MrpValue', 'Nsv'],
      src: function (want, from, to) {
        var seen = {}, out = [];
        var ordOf = {}, eodOf = {};
        DB.rows('SecOrders').forEach(function (o) {
          var k = String(o.EmpCode || '').toUpperCase() + '|' + toISO(o.Date);
          ordOf[k] = ordOf[k] || { v:0, n:0, mrp:0, nsv:0 };
          ordOf[k].v++;
          if (num(o.TotUnits) > 0 && !/cancel|no.?order/i.test(String(o.Status || ''))) ordOf[k].n++;
          ordOf[k].mrp += num(o.TotValue); ordOf[k].nsv += num(o.TotNsvLakh);
        });
        DB.rows('Eod').forEach(function (e) {
          eodOf[String(e.EmpCode || '').toUpperCase() + '|' + toISO(e.Date)] = e;
        });
        var push = function (code, name, d, ww, geo, plan, from2) {
          var k = code + '|' + d;
          if (seen[k]) return; seen[k] = 1;
          var kind = Team.KIND(ww), o = ordOf[k] || { v:0, n:0, mrp:0, nsv:0 }, e = eodOf[k] || {};
          var att = Rep.ATT[kind] || Rep.DASH;
          /* ── a field day that never started is ABSENT ──
             It used to read "Not started", which is a description of the app rather than of the day: a
             rep who was rostered onto a beat and never went is absent, and an attendance sheet has to
             be able to say so in the word payroll and HR actually use. A Leave / Weekly off / Holiday /
             Meeting day keeps its own name — none of those is an absence. */
          if (kind === 'F' && !Plan.started(plan || {})) att = 'Absent';
          out.push({ Date:d, EmpCode:code, EmpName:name || '',
            Attendance:att, WorkingWith:ww || '',
            Station:(plan && plan.Station) || '', State:(plan && plan.State) || geo.state || '',
            Town:geo.town || '', Beat:geo.beat || '',
            LoginAt:(plan && plan.PlanAt) || '', StartAt:(plan && plan.StartAt) || '',
            EndAt:e.ClosedAt || '', Visits:o.v, Orders:o.n, MrpValue:o.mrp, Nsv:o.nsv,
            Source:from2, Remarks:e.Remarks || '' });
        };
        DB.rows('DayPlan').forEach(function (p) {
          var d = toISO(p.Date), code = String(p.EmpCode || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          push(code, p.EmpName, d, p.WorkingWith, { town:p.Town, beat:p.Beat, state:p.State }, p, 'Day plan');
        });
        (DB.m.Master_PJP || []).forEach(function (p) {
          var d = toISO(p.Date), code = String(p.Code || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          if (d > today()) return;                      /* a future plan is not attendance */
          var e = DB.emp(code) || {};
          push(code, e.Name || '', d, Pjp.ww(p.Ww), { town:p.Town, beat:p.Beat, state:p.State }, null, 'PJP');
        });
        return out.sort(function (a, b) {
          return String(a.Date).localeCompare(String(b.Date)) ||
                 String(a.EmpCode).localeCompare(String(b.EmpCode)); });
      } },

    /* ══════════ BEAT COVERAGE — one row per PLANNED DAY ══════════
       The question this has to answer is "what was my plan for that day, and how much of it did I
       actually cover" — so it is day-wise, and the plan and the outcome sit side by side on the row:
         · what the approved PJP asked for   (working-with, state / town / beat, station, week, focus)
         · what actually happened            (attendance, the beat he was really on, station)
         · a one-word VERDICT of the two      (see the Coverage column below)
         · and what the day produced          (visits, productive, no-order, units, MRP, NSV, NSO, POSM)
       Every planned day appears, including the ones nothing happened on — a day missed is the single
       most important row in a coverage report, and an aggregate hid it inside a percentage. */
    BeatCoverage:{ t:'Beat coverage (day-wise)', cols:[
      ['Date', 'Date', 'd'], ['Day', 'Day'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      /* ── the plan ── */
      ['PjpWw', 'PJP working with'], ['PjpState', 'PJP state'], ['PjpTown', 'PJP town'],
      ['PjpBeat', 'PJP beat'], ['PjpStation', 'PJP station'], ['Week', 'Week'], ['Focus', 'Focus'],
      /* ── what happened ── */
      ['Attendance', 'Attendance'], ['ActWw', 'Actual working with'],
      ['ActTown', 'Actual town'], ['ActBeat', 'Actual beat'], ['ActStation', 'Actual station'],
      ['Coverage', 'Coverage'], ['OffPjp', 'Off PJP'], ['Approval', 'Off-PJP approval'],
      ['Started', 'Day started'],
      /* ── and what it produced ── */
      ['Visits', 'Stores visited', 'n'], ['Productive', 'Productive visits', 'n'],
      ['NoOrder', 'No-order visits', 'n'], ['StrikeRate', 'Strike rate %', 'n'],
      ['ScTarget', 'SC target', 'n'],
      ['Units', 'Units', 'n'], ['MrpValue', 'MRP value', 'm'], ['Nsv', 'NSV ₹L', 'n'],
      ['Nso', 'New outlets', 'n'], ['PosmAudit', 'POSM audit', 'n'], ['PosmReq', 'POSM requirement', 'n'],
      ['LoginAt', 'Login time'],
      [function (r) { return Rep.dayPhoto(r.EmpCode, r.Date); }, 'Photos', 'raw'],
      ['Remarks', 'EOD remarks']],
      tot:['Visits', 'Productive', 'NoOrder', 'Units', 'MrpValue', 'Nsv', 'Nso', 'PosmAudit', 'PosmReq'],
      src: function (want, from, to) {
        var DN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        var same = function (a, b) {
          return String(a || '').trim().toUpperCase() === String(b || '').trim().toUpperCase(); };
        var by = {}, out = [];
        var ens = function (code, d, name) {
          var k = code + '|' + d;
          if (!by[k]) {
            by[k] = { Date:d, Day:DN[new Date(d + 'T00:00:00').getDay()] || '',
              EmpCode:code, EmpName:name || '',
              PjpWw:'', PjpState:'', PjpTown:'', PjpBeat:'', PjpStation:'', Week:'', Focus:'',
              Attendance:'', ActWw:'', ActTown:'', ActBeat:'', ActStation:'',
              Coverage:'', OffPjp:'', Approval:'', Started:'',
              Visits:0, Productive:0, NoOrder:0, StrikeRate:0, ScTarget:0,
              Units:0, MrpValue:0, Nsv:0, Nso:0, PosmAudit:0, PosmReq:0,
              LoginAt:'', Remarks:'' };
            out.push(by[k]);
          }
          if (name && !by[k].EmpName) by[k].EmpName = name;
          return by[k];
        };
        /* 1. every day the approved PJP asked for — the spine of the report */
        (DB.m.Master_PJP || []).forEach(function (p) {
          var d = toISO(p.Date), code = String(p.Code || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to || d > today()) return;
          var e = DB.emp(code) || {}, r = ens(code, d, e.Name);
          r.PjpWw = Pjp.ww(p.Ww); r.PjpState = p.State || ''; r.PjpTown = p.Town || '';
          r.PjpBeat = p.Beat || ''; r.PjpStation = p.Station || '';
          r.Week = p.Week || ''; r.Focus = p.Focus || '';
        });
        /* 2. what the rep actually saved for that day */
        DB.rows('DayPlan').forEach(function (p) {
          var d = toISO(p.Date), code = String(p.EmpCode || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          var r = ens(code, d, p.EmpName);
          r.ActWw = Pjp.ww(p.WorkingWith); r.ActTown = p.Town || ''; r.ActBeat = p.Beat || '';
          r.ActStation = p.Station || ''; r.OffPjp = p.OffPjp || ''; r.Approval = p.Approval || '';
          r.ScTarget = num(p.ScTarget); r.LoginAt = p.PlanAt || '';
          r.Started = Plan.started(p) ? 'Yes' : 'No';
          r.Attendance = Rep.att(p);
          if (!r.PjpWw) r.PjpWw = Rep.pjpOn(code, d).Ww ? Pjp.ww(Rep.pjpOn(code, d).Ww) : '';
        });
        /* 3. the day's output, and the EOD remark */
        DB.rows('Eod').forEach(function (e) {
          var d = toISO(e.Date), code = String(e.EmpCode || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          if (!by[code + '|' + d]) return;          /* an EOD with no planned day is not coverage */
          by[code + '|' + d].Remarks = e.Remarks || '';
        });
        out.forEach(function (r) {
          var a = Rep.dayAct(r.EmpCode, r.Date);
          r.Visits = a.visits; r.Productive = a.productive; r.NoOrder = a.noOrder;
          r.Units = a.units; r.MrpValue = a.mrp; r.Nsv = a.nsv;
          r.Nso = a.nso; r.PosmAudit = a.posmA; r.PosmReq = a.posmR;
          r.StrikeRate = a.visits ? Math.round(a.productive / a.visits * 100) : 0;
          if (!r.Attendance) r.Attendance = r.PjpWw
            ? (Pjp.isField(r.PjpWw) ? 'Absent' : (Rep.ATT[Team.KIND(r.PjpWw)] || Rep.DASH)) : Rep.DASH;
          /* ── the verdict ──
             A non-field day is not coverage at all and says so. A field day is COVERED when the rep
             actually went and worked the beat the PJP named; "Different beat" when he worked but
             somewhere else (that is what off-PJP means, spelled out); "Not covered" when the day was
             never started; and "Beat not filled" when the PJP itself named no beat to cover. */
          var plannedField = r.PjpWw ? Pjp.isField(r.PjpWw) : Pjp.isField(r.ActWw);
          if (!plannedField) r.Coverage = 'Not a field day';
          else if (r.Started !== 'Yes') r.Coverage = 'Not covered — din shuru nahi hua';
          else if (!r.PjpBeat) r.Coverage = 'PJP me beat nahi tha';
          else if (same(r.ActBeat, r.PjpBeat) && (!r.ActTown || same(r.ActTown, r.PjpTown)))
            r.Coverage = 'Covered';
          else r.Coverage = 'Different beat — ' + (r.ActBeat || r.ActTown || 'pata nahi');
        });
        return out.sort(function (a, b) {
          return String(a.Date).localeCompare(String(b.Date)) ||
                 String(a.EmpCode).localeCompare(String(b.EmpCode)); });
      } },

    /* the same data rolled up per beat — which beats are under-covered across the whole period. Kept
       alongside the day-wise sheet because it answers a different question: not "what happened on the
       4th" but "which of my beats am I not getting to". */
    BeatSummary:{ t:'Beat coverage (per beat)', cols:[
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee'],
      ['State', 'State'], ['Town', 'Town'], ['Beat', 'Beat'],
      ['Planned', 'Planned days', 'n'], ['Worked', 'Worked days', 'n'],
      ['CoveragePct', 'Coverage %', 'n'],
      ['Visits', 'Stores visited', 'n'], ['Orders', 'Productive visits', 'n'],
      ['Units', 'Units', 'n'], ['MrpValue', 'MRP value', 'm'], ['Nsv', 'NSV ₹L', 'n']],
      tot:['Planned', 'Worked', 'Visits', 'Orders', 'Units', 'MrpValue', 'Nsv'],
      src: function (want, from, to) {
        var m = {};
        var key = function (code, town, beat) { return code + '|' + town + '|' + beat; };
        var ens = function (code, name, town, beat, state) {
          var k = key(code, town, beat);
          if (!m[k]) m[k] = { EmpCode:code, EmpName:name || '', State:state || '', Town:town,
            Beat:beat, Planned:0, Worked:0, Visits:0, Orders:0, Units:0, MrpValue:0, Nsv:0 };
          if (name && !m[k].EmpName) m[k].EmpName = name;
          return m[k];
        };
        (DB.m.Master_PJP || []).forEach(function (p) {
          var d = toISO(p.Date), code = String(p.Code || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          if (!Pjp.isField(Pjp.ww(p.Ww))) return;       /* a meeting is not beat coverage */
          var e = DB.emp(code) || {};
          ens(code, e.Name, p.Town || '', p.Beat || '', p.State).Planned++;
        });
        DB.rows('DayPlan').forEach(function (p) {
          var d = toISO(p.Date), code = String(p.EmpCode || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          if (!Pjp.isField(p.WorkingWith) || !Plan.started(p)) return;
          ens(code, p.EmpName, p.Town || '', p.Beat || '', p.State).Worked++;
        });
        DB.rows('SecOrders').forEach(function (o) {
          var d = toISO(o.Date), code = String(o.EmpCode || '').toUpperCase();
          if (!d || !Rep.wants(want, code) || d < from || d > to) return;
          var g = Rep.beatOn(code, d);
          var row = ens(code, o.EmpName, g.town || o.City || '', g.beat || '', o.State);
          row.Visits++;
          if (num(o.TotUnits) > 0 && !/cancel|no.?order/i.test(String(o.Status || ''))) row.Orders++;
          row.Units += num(o.TotUnits); row.MrpValue += num(o.TotValue); row.Nsv += num(o.TotNsvLakh);
        });
        return Object.keys(m).map(function (k) {
          var r = m[k];
          r.CoveragePct = r.Planned ? Math.round(r.Worked / r.Planned * 100) : 0;
          return r;
        }).sort(function (a, b) {
          return String(a.EmpCode).localeCompare(String(b.EmpCode)) ||
                 String(a.Town).localeCompare(String(b.Town)) ||
                 String(a.Beat).localeCompare(String(b.Beat)); });
      } },

    /* ══════════ PRIMARY ORDER — what the distributor has to buy ══════════
       The SKUs a rep has taken orders for that the distributor cannot currently serve: secondary demand
       per distributor × SKU against the stock that distributor is holding, and the shortfall between
       them. Only PENDING orders count — a billed order has already come out of the distributor's stock,
       so counting it again would charge the same demand twice.
       Stock_Distributor is ~50k rows and is never shipped with the pull; it is read live per distributor.
       Rep.primaryWarm() fetches every distributor in the range before the download builds, so the rows
       are complete; anything still unknown says so instead of quietly reading zero. */
    /* line:false — a distributor × SKU row is not one employee's work, so a reporting line on it would
       be seven dashes. The employees who took the orders are named in the last two columns instead. */
    PrimaryOrder:{ t:'Primary Order', line:false, cols:[
      ['DbCode', 'Distributor code'], ['DbName', 'Distributor'],
      ['Sku', 'SKU code'], ['Name', 'Product'], ['Brand', 'Brand'], ['Category', 'Category'],
      ['Msl', 'MSL'], ['Mrp', 'MRP', 'm'],
      ['Ordered', 'Order quantity (units)', 'n'], ['Value', 'Order value', 'm'],
      ['Stock', 'Distributor stock (units)'], ['Short', 'Primary order needed (units)', 'n'],
      ['StockAsOf', 'Stock as of', 'd'], ['StockAge', 'Stock age (days)'],
      ['Orders', 'Pending orders'], ['Stores', 'Stores waiting'],
      ['EmpCode', 'Employee code'], ['EmpName', 'Employee']],
      tot:['Ordered', 'Value', 'Short'],
      src: function (want, from, to) {
        /* the pending orders in range — the demand that is still owed to a shop */
        var pend = DB.rows('SecOrders').filter(function (o) {
          return Rep.wants(want, o.EmpCode) && Rep.inR(o.Date, from, to) &&
                 !/billing|delivered|cancel|no.?order/i.test(String(o.Status || ''));
        });
        var stores = {}, orders = {}, emp = {};
        pend.forEach(function (o) {
          var db = String(o.DbCode || ''); if (!db) return;
          Sec.lines(o).forEach(function (l) {
            var k = db + '|' + String(l.Sku || '');
            (orders[k] = orders[k] || {})[String(o.PoNumber)] = 1;
            (stores[k] = stores[k] || {})[String(o.StoreName || o.CompanyCode || '')] = 1;
            (emp[k] = emp[k] || {})[String(o.EmpCode || '').toUpperCase()] = o.EmpName || '';
          });
        });
        return Sec.primaryRows(pend).map(function (x) {
          var k = x.db + '|' + x.sku, ag = Stock.age(x.stockAt);
          var codes = Object.keys(emp[k] || {});
          return { DbCode:x.db, DbName:x.dbName, Sku:x.sku, Name:x.name || x.sku, Brand:x.brand,
            Category:x.cat, Msl:Rep.msl(x.msl), Mrp:x.mrp,
            Ordered:x.ordered, Value:x.value,
            /* a dash, never a 0, when the distributor's upload has not been read — the two mean
               completely different things to whoever acts on this row */
            Stock:x.stock === null ? Rep.DASH : String(x.stock),
            Short:x.short,
            StockAsOf:ag.known ? ag.iso : '', StockAge:ag.known ? String(ag.days) : Rep.DASH,
            Orders:String(Object.keys(orders[k] || {}).length),
            Stores:String(Object.keys(stores[k] || {}).length),
            EmpCode:codes.join(', '),
            EmpName:codes.map(function (c) { return emp[k][c] || c; }).join(', ') };
        }).filter(function (r) { return r.Short > 0 || r.Stock === Rep.DASH; })
          .sort(function (a, b) {
            return String(a.DbName).localeCompare(String(b.DbName)) || (b.Short - a.Short); });
      } },

    /* ── the MASTERS, for an Admin/HOD only ──
       `priv:true` is enforced by Rep.mayHave() at every entry point, not by hiding a checkbox: a
       rep's device holds the full masters locally, so a UI-only gate would be no gate at all.
       `line:false` — a master row is not one employee's work, so a reporting line means nothing on
       it. Where the columns are left empty the sheet auto-derives them from the row itself, which
       cannot go stale if the customer adds a column to the sheet. */
    /* the WHOLE reporting chain, name and mobile together — an escalation list is useless if the
       number is on a different sheet from the name */
    Master_Employees:{ t:'Master — Employees', priv:true, line:false, cols:[
      ['Code', 'Employee code'], ['Name', 'Employee'], ['Designation', 'Designation'],
      ['HQ', 'HQ'], ['Zone', 'Zone'], ['Mobile', 'Mobile'], ['Email', 'Email'],
      ['DateofJoining', 'Joining', 'd'],
      ['AsmName', 'ASM'], ['AsmMobile', 'ASM mobile'], ['AsmEmail', 'ASM email'],
      ['RsmName', 'RSM'], ['RsmMobile', 'RSM mobile'], ['RsmEmail', 'RSM email'],
      ['ZmName', 'ZSM'], ['ZmMobile', 'ZSM mobile'], ['ZmEmail', 'ZSM email'],
      ['HodName', 'HOD'], ['HodMobile', 'HOD mobile'], ['HodEmail', 'HOD email']],
      src: function () { return (DB.m.Master_Employees || []).slice(); } },
    Master_Stores:{ t:'Master — Stores', priv:true, line:false, cols:[
      ['ClientId', 'Client id'], ['CompanyCode', 'Store code'], ['StoreName', 'Store'],
      ['StoreType', 'Store type'], ['City', 'City'], ['State', 'State'],
      ['DbCode', 'Distributor code'], ['DbName', 'Distributor'],
      ['Status', 'Status'], ['EnrollDate', 'Enrolled', 'd'],
      ['Zone', 'Zone'], ['Region', 'Region'], ['AsmName', 'ASM'], ['AsmHq', 'ASM HQ'],
      ['EmAsm', 'Mapped to'], ['EmAsmHq', 'Mapped HQ']],
      src: function () { return (DB.m.Master_Stores || []).slice(); } },
    Master_Products:{ t:'Master — Products', priv:true, line:false, cols:[
      ['Code', 'SKU code'], ['Name', 'Product'], ['Brand', 'Brand'],
      ['Category', 'Category'], ['SubCategory', 'Sub-category'], ['MRP', 'MRP', 'm'],
      [function (r) { return Rep.msl(r.MslStatus); }, 'MSL']],
      src: function () { return (DB.m.Master_Products || []).slice(); } },
    Master_PJP:{ t:'Master — Published PJP', priv:true, line:false, cols:[
      ['Date', 'Date', 'd'], ['Code', 'Employee code'],
      [function (r) { return (DB.emp(r.Code) || {}).Name || ''; }, 'Employee'],
      [function (r) { return (DB.emp(r.Code) || {}).Designation || ''; }, 'Designation'],
      [function (r) { return (DB.emp(r.Code) || {}).HQ || ''; }, 'HQ'],
      ['Zone', 'Zone'],
      ['Ww', 'Working with'], ['Week', 'Week'], ['State', 'State'], ['Town', 'Town'],
      ['Beat', 'Beat'], ['Station', 'Station'], ['Focus', 'Focus'],
      ['Status', 'Status'], ['HodApproved', 'HOD approved'], ['Approvals', 'Approved by'],
      ['Remarks', 'Remarks'],
      [function (r) { return (DB.emp(r.Code) || {}).AsmName || ''; }, 'ASM'],
      [function (r) { return (DB.emp(r.Code) || {}).RsmName || ''; }, 'RSM'],
      [function (r) { return (DB.emp(r.Code) || {}).ZmName || ''; }, 'ZSM'],
      [function (r) { return (DB.emp(r.Code) || {}).HodName || ''; }, 'HOD']],
      src: function (want, from, to) {
        return (DB.m.Master_PJP || []).filter(function (p) {
          return Rep.wants(want, p.Code) && Rep.inR(p.Date, from, to); })
          .sort(function (a, b) { return String(toISO(a.Date)).localeCompare(String(toISO(b.Date))); });
      } },
    /* the tab a new outlet's distributor is now read from, so it gets named columns rather than the
       auto-derived dump — the mapping column (EmAsm) matters most: it is what decides whose list a
       distributor appears in */
    Master_Distributors:{ t:'Master — Distributors', priv:true, line:false, cols:[
      ['Code', 'Distributor code'], ['Name', 'Distributor'],
      ['City', 'City'], ['State', 'State'], ['MetroCity', 'Metro'],
      ['Zone', 'Zone'], ['Region', 'Region'],
      ['AsmName', 'ASM'], ['AsmHq', 'ASM HQ'],
      ['EmAsm', 'Mapped to'], ['EmAsmHq', 'Mapped HQ']],
      src: function () { return (DB.m.Master_Distributors || []).slice(); } },
    Master_Config:{ t:'Master — Config', priv:true, line:false, cols:[],
      src: function () { return (DB.m.Master_Config || []).slice(); } },
    Master_Phasing:{ t:'Master — Phasing', priv:true, line:false, cols:[],
      src: function () { return (DB.m.Master_Phasing || []).slice(); } },

    /* The clubbed "Day plan + EOD" sheet is gone. It existed because the EOD sheet and the Day-plan
       sheet were each too thin to read on their own; both now carry the plan, the targets and the
       day's actuals themselves (see Rep.dayAct), so a third sheet saying the same thing in a third
       shape was one more place for the numbers to disagree. */
  },
  /* ── warm the distributor stock the Primary Order report needs ──
     Stock_Distributor is read live, one distributor at a time, and the download itself is synchronous.
     So before building, fetch every distributor that has a pending order in the range and wait. Anything
     that fails or times out simply stays unknown on the row — the report says so rather than guessing.
     Returns a promise; safe to call when PrimaryOrder was not selected (it resolves immediately). */
  primaryWarm: function (kinds, code, from, to) {
    if ((kinds || []).indexOf('PrimaryOrder') < 0) return Promise.resolve();
    var want = Rep.codeSet(code), seen = {}, jobs = [];
    DB.rows('SecOrders').forEach(function (o) {
      if (!Rep.wants(want, o.EmpCode) || !Rep.inR(o.Date, from, to)) return;
      if (/billing|delivered|cancel|no.?order/i.test(String(o.Status || ''))) return;
      var db = String(o.DbCode || '').trim();
      if (!db || seen[db]) return;
      seen[db] = 1;
      if (!Stock.get('', db)) jobs.push(Stock.load('', db) || Promise.resolve());
    });
    if (!jobs.length) return Promise.resolve();
    toast(jobs.length + ' distributor ka stock aa raha hai…', 2500);
    return Promise.all(jobs.map(function (p) {
      return Promise.resolve(p).catch(function () { return null; }); }));
  },
  codeSet: function (code) {
    var a = code == null ? [] : (typeof code === 'string' ? [code] : code);
    a = a.filter(function (c) { return c && String(c).toUpperCase() !== 'ALL'; });
    if (!a.length) return null;
    var out = {}; a.forEach(function (c) { out[String(c).trim().toUpperCase()] = 1; });
    return out;
  },
  /* the employee behind a row, for every derived reporting-line column. One lookup helper so a
     sheet with 200 rows does not each re-implement "which master row is this". */
  e: function (r) { return DB.emp(r.EmpCode || r.Code || r.Employee || '') || {}; },
  /* Designation · HQ · Zone · ASM · RSM · ZSM · HOD — appended to EVERY generic sheet so each one
     is independently readable without joining back to the employee master. Remarks stays the last
     DATA column; this is the trailing block after it. */
  LINE:[
    [function (r) { return Rep.e(r).Designation || ''; }, 'Designation'],
    [function (r) { return Rep.e(r).HQ || ''; }, 'HQ'],
    [function (r) { return Rep.e(r).Zone || ''; }, 'Zone'],
    [function (r) { return Rep.e(r).AsmName || ''; }, 'ASM'],
    [function (r) { return Rep.e(r).RsmName || ''; }, 'RSM'],
    [function (r) { return Rep.e(r).ZmName || ''; }, 'ZSM'],
    [function (r) { return Rep.e(r).HodName || ''; }, 'HOD']
  ],
  /* Delivered / Cancelled / In progress, and the fill that goes with it. Green means the money is
     real, red means it never will be, amber means it is still owed — never red/green for anything
     else in a report, same rule the screens follow. */
  DLV: function (st) {
    var x = String(st || '');
    if (/billing|delivered/i.test(x)) return 'Delivered';
    if (/cancel|no.?order/i.test(x)) return 'Cancelled';
    if (!x) return '';
    return 'In progress';
  },
  dlvFill: function (v) {
    return /delivered/i.test(v) ? Xl.S.good : /cancel/i.test(v) ? Xl.S.bad
         : v ? Xl.S.warn : Xl.S.txt;
  },
  anyRows: function (kind, code, from, to) {
    var want = Rep.codeSet(code);
    /* a DERIVED sheet builds its own rows (Failed visits, Attendance, both Beat coverage sheets, the
       day-wise TA/DA, Primary Order): there is no tab of that name on the sheet to read, so the
       registry entry supplies them */
    var def = Rep.ANY[kind];
    if (def && def.src) return def.src(want, from, to);
    return DB.rows(kind).filter(function (x) {
      if (want && !want[String(x.EmpCode || '').trim().toUpperCase()]) return false;
      var d = toISO(x.Date);
      if (!d) return true;                               /* TaDa / PjpDraft are keyed by Month */
      return d >= from && d <= to;
    }).sort(function (a, b) {
      return String(toISO(a.Date) || a.Month || '').localeCompare(String(toISO(b.Date) || b.Month || ''));
    });
  },
  /* one sheet definition, shared by the single download and the everything download */
  anySheet: function (kind, rows, over, sub) {
    /* `over` = an explicit column map for a tab that is deliberately NOT in Rep.ANY (Master_PJP: it is
       a master, and putting it in ANY would drop it into every "all reports" workbook)
       `sub`  = the line under the title: who and which days this sheet covers */
    var def = over || Rep.ANY[kind] || { t:kind, cols:[] };
    var cols = def.cols.length ? def.cols
      : (rows.length ? Object.keys(rows[0]).filter(function (c) { return c !== 'LastSync'; })
          .map(function (c) { return [c, c]; }) : [['—', '—']]);
    /* EVERY sheet carries the reporting line at the end unless it opts out — the point is that a
       single tab, opened on its own, still says who this is and who they roll up to */
    if (def.line !== false && def.cols.length) cols = cols.concat(Rep.LINE);
    var wide = function (label) {
      return /remark|reason|detail|address|note|message/i.test(label); };
    /* the body first, so the column widths can be measured from what is actually in it */
    var body = rows.map(function (r, ri) {
      var cells = cols.map(function (c) {
        /* a field may be a FUNCTION of the row — that is how a derived column (the reporting line,
           an id resolved from a master, a delivery status) is expressed as data, not as a builder */
        var v = typeof c[0] === 'function' ? c[0](r) : r[c[0]], k = c[2];
        /* 'raw' = the column already built its own cell (a Drive hyperlink, a photo folder) */
        if (k === 'raw') return (v && typeof v === 'object') ? v : Xl.t(Rep.DASH);
        /* A number keeps its 0 — a zero IS the value, and a dash there would break both the column's
           format and its TOTAL. Everything else says "no value" with a dash instead of going blank. */
        if ((v == null || String(v) === '') && k !== 'n' && k !== 'm') return Xl.t(Rep.DASH);
        if (k === 'd' || k === 'dOf') return Xl.dt(toISO(v) || v);
        if (k === 'dtm') return Xl.dtm(v);
        if (k === 'st') return Xl.t(String(v), Rep.dlvFill(v));
        if (k === 'm') return Xl.m(num(v));
        /* a value in LAKHS is never a whole number — #,##0 turned ₹3,240 of NSV into "0" */
        if (k === 'n') return /₹l|lakh|nsv/i.test(c[1]) ? Xl.d2(num(v)) : Xl.n(num(v));
        return Xl.t(String(v), wide(c[1]) ? Xl.S.wrap : Xl.S.txt);
      });
      /* banded: every second row on a faint fill, keeping each cell's own number format */
      return ri % 2 ? cells.map(Xl.band) : cells;
    });
    var head = cols.map(function (c) { return Xl.h(c[1]); });
    var wcols = Xl.widths(cols.map(function (c) { return I18n.s(c[1]); }), body, 44);
    var last = Xl.col(cols.length - 1);

    /* ── the four-row masthead every sheet shares ── */
    var out = [
      [Xl.t(I18n.s(def.t), Xl.S.T)],
      [Xl.t(sub || (rows.length + ' row'), Xl.S.sub)],
      [],
      head
    ];
    body.forEach(function (r) { out.push(r); });
    if ((def.tot || []).length && rows.length) {
      out.push(cols.map(function (c, i) {
        if (!i) return Xl.t('TOTAL', Xl.S.tot);
        if (typeof c[0] === 'function' || (def.tot || []).indexOf(c[0]) < 0) return Xl.t('', Xl.S.tot);
        var t = rows.reduce(function (a, r) { return a + num(r[c[0]]); }, 0);
        return c[2] === 'm' ? Xl.m(t, Xl.S.totM)
             : /₹l|lakh|nsv/i.test(c[1]) ? Xl.d2(t, Xl.S.totD) : Xl.n(t, Xl.S.totI);
      }));
    }
    return { name:def.t.slice(0, 31), rows:out, freeze:4, cols:wcols,
      rowH:{ 1:22, 2:16, 3:6, 4:30 },
      merges:['A1:' + last + '1', 'A2:' + last + '2'],
      filter:'A4:' + last + out.length };
  },
  who: function (code) {
    var a = code == null ? [] : (typeof code === 'string' ? [code] : code);
    a = a.filter(function (c) { return c && String(c).toUpperCase() !== 'ALL'; });
    if (!a.length) return 'sab employee';
    if (a.length > 3) return a.length + ' employee';
    return a.map(function (c) { var e = DB.emp(c) || {}; return (e.Name || c) + ' (' + c + ')'; })
            .join(', ');
  },
  /* a file name cannot be a comma-separated list of thirty codes */
  fileWho: function (code) {
    var a = code == null ? [] : (typeof code === 'string' ? [code] : code);
    a = a.filter(function (c) { return c && String(c).toUpperCase() !== 'ALL'; });
    return !a.length ? 'ALL' : a.length === 1 ? String(a[0]) : (a.length + 'emp');
  },
  /* a `priv` sheet (the masters) belongs to Admin/HOD. Checked HERE, in the one place every download
     path funnels through, so no screen can hand one out by forgetting a check of its own. */
  mayHave: function (kind) {
    var d = Rep.ANY[kind];
    return !d || !d.priv || Auth.isAdmin();
  },
  any: function (kind, code, from, to) {
    if (!Rep.mayHave(kind)) { toast('Ye master report sirf Admin / HOD ke liye hai', 4000); return null; }
    var rows = Rep.anyRows(kind, code, from, to);
    var def = Rep.ANY[kind] || { t:kind };
    var ttl = Rep.ttl('GARUDA — ' + def.t, Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to) +
      '  ·  ' + rows.length + ' row', 8);
    var sheets = [{ name:'About', cols:[24, 44, 14, 14, 14, 14, 14, 14], tab:'FF8890A6', portrait:1,
      rowH:ttl.rowH, rows:ttl.rows.concat([
      Rep.kv('Report', Xl.t(I18n.s(def.t), Xl.S.V)), Rep.kv('Employee', Xl.t(Rep.who(code), Xl.S.V)),
      Rep.kv('From', Xl.dt(from)), Rep.kv('To', Xl.dt(to)), Rep.kv('Rows', Xl.n(rows.length)),
      Rep.kv('Downloaded', Xl.t(dmy(today()) + ' ' + new Date().toLocaleTimeString('en-IN'), Xl.S.V)),
      Rep.kv('By', Xl.t(DB.me.name + ' (' + DB.me.code + ')', Xl.S.V))]), merges:ttl.merges },
      Rep.anySheet(kind, rows, null, Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to) +
        '  ·  ' + rows.length + ' row')];
    /* an order without its lines is half a report */
    if (kind === 'SecOrders' && rows.length) {
      var pos = {}; rows.forEach(function (o) { pos[String(o.PoNumber)] = 1; });
      var lines = DB.rows('SecOrderLines').filter(function (l) { return pos[String(l.PoNumber)]; });
      sheets.push(Rep.anySheet('SecOrderLines', lines, null, Rep.who(code) + '  ·  ' +
        dmy(from) + ' – ' + dmy(to) + '  ·  ' + lines.length + ' line'));
    }
    return Xl.save('GARUDA_' + def.t.replace(/\W+/g, '') + '_' + Rep.fileWho(code) + '_' + from + '_' + to,
      sheets);
  },

  /* ══ the reports HE PICKED, one tab each ══
     `everything` is this with the list left out. Kept separate so "two reports" does not mean "wait for
     thirteen": the count on the screen is what the file holds. */
  some: function (kinds, code, from, to) {
    kinds = (kinds || []).filter(function (k) { return !!k; });
    if (!kinds.length) return { sheets:0 };
    var ttl = Rep.ttl('GARUDA — ' + kinds.length + ' report', Rep.who(code) + '  ·  ' + dmy(from) +
      ' – ' + dmy(to), 8);
    var about = ttl.rows.concat([Rep.kv('Employee', Xl.t(Rep.who(code), Xl.S.V)),
      Rep.kv('From', Xl.dt(from)), Rep.kv('To', Xl.dt(to)),
      Rep.kv('By', Xl.t(DB.me.name, Xl.S.V)), [],
      [Xl.t('What is in this file', Xl.S.T2), Xl.t('', Xl.S.T2)]]);
    var sheets = [], n = 0;
    kinds.filter(Rep.mayHave).forEach(function (kind) {
      /* the PJP is a pair of tabs of its own */
      if (kind === 'PJP') {
        var x = Admin.pjpRows(code, from, to);
        about.push([Xl.t(I18n.s('Published PJP'), Xl.S.K), Xl.n(x.pub.length)]);
        about.push([Xl.t(I18n.s('PJP drafts'), Xl.S.K), Xl.n(x.dr.length)]);
        var sub0 = Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to);
        if (x.pub.length) { sheets.push(Rep.anySheet('Master_PJP', x.pub, Admin.PJPCOL, sub0)); n++; }
        if (x.dr.length) { sheets.push(Rep.anySheet('PjpDraft', x.dr, Admin.DRFCOL, sub0)); n++; }
        return;
      }
      var rows = Rep.anyRows(kind, code, from, to);
      about.push([Xl.t(I18n.s((Rep.ANY[kind] || { t:kind }).t), Xl.S.K), Xl.n(rows.length)]);
      /* ── a report with no rows STILL gets its tab ──
         It used to be skipped, which is indistinguishable from a broken download: you tick "Stock
         remarks", the file arrives, and there is simply no such tab in it. Now the tab is there with its
         headers and a line saying the period was empty — the answer is "nothing to report", which is a
         real answer, and it is visibly the one being given. */
      var sub = Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to) + '  ·  ' +
        (rows.length ? rows.length + ' row' : 'is period me kuch nahi');
      sheets.push(Rep.anySheet(kind, rows, null, sub)); n++;
      if (kind === 'SecOrders') {
        var pos = {}; rows.forEach(function (o) { pos[String(o.PoNumber)] = 1; });
        var lines = DB.rows('SecOrderLines').filter(function (l) { return pos[String(l.PoNumber)]; });
        if (lines.length) { sheets.push(Rep.anySheet('SecOrderLines', lines, null, sub)); n++; }
      }
    });
    sheets.unshift({ name:'About', cols:[30, 16, 14, 14, 14, 14, 14, 14], tab:'FF8890A6', portrait:1,
      rowH:ttl.rowH, rows:about, merges:ttl.merges });
    Xl.save('GARUDA_' + kinds.length + 'reports_' + Rep.fileWho(code) + '_' + from + '_' + to, sheets);
    return { sheets:n };
  },
  /* every report in one workbook — one tab each, the same formatting */
  everything: function (code, from, to) {
    var ttl = Rep.ttl('GARUDA — all reports', Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to), 8);
    var about = ttl.rows.concat([Rep.kv('Employee', Xl.t(Rep.who(code), Xl.S.V)),
      Rep.kv('From', Xl.dt(from)), Rep.kv('To', Xl.dt(to)),
      Rep.kv('By', Xl.t(DB.me.name, Xl.S.V)), [],
      [Xl.t('What is in this file', Xl.S.T2), Xl.t('', Xl.S.T2)]]);
    var sheets = [], n = 0;
    Object.keys(Rep.ANY).forEach(function (kind) {
      if (kind === 'SecOrderLines') return;
      /* masters are never part of "all reports" for anyone who may not have them */
      if (!Rep.mayHave(kind)) return;
      var rows = Rep.anyRows(kind, code, from, to);
      about.push([Xl.t(I18n.s(Rep.ANY[kind].t), Xl.S.K), Xl.n(rows.length)]);
      if (!rows.length) return;
      var sub = Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to) + '  ·  ' + rows.length + ' row';
      sheets.push(Rep.anySheet(kind, rows, null, sub)); n++;
      if (kind === 'SecOrders') {
        var pos = {}; rows.forEach(function (o) { pos[String(o.PoNumber)] = 1; });
        var lines = DB.rows('SecOrderLines').filter(function (l) { return pos[String(l.PoNumber)]; });
        if (lines.length) { sheets.push(Rep.anySheet('SecOrderLines', lines, null, sub)); n++; }
      }
    });
    sheets.unshift({ name:'About', cols:[30, 16, 14, 14, 14, 14, 14, 14], tab:'FF8890A6', portrait:1,
      rowH:ttl.rowH, rows:about, merges:ttl.merges });
    Xl.save('GARUDA_ALL_' + Rep.fileWho(code) + '_' + from + '_' + to, sheets);
    return { sheets:n };
  },
  tab: function (name, cols, rows) {
    var out = [cols.map(Xl.h)];
    rows.forEach(function (r) {
      out.push(cols.map(function (c) {
        var v = r[c];
        if (/date/i.test(c) && /^\d{4}-\d{2}-\d{2}/.test(String(v))) return Xl.dt(v);
        if (typeof v === 'number') return Xl.n(v, /value|mrp|amount|total/i.test(c) ? Xl.S.money : Xl.S.int);
        return Xl.t(v);
      }));
    });
    Xl.save(name + '_' + today(), [{ name:name.slice(0, 31), cols:cols.map(function (c) {
      return /json|remark|address|reason/i.test(c) ? 40 : Math.min(30, Math.max(11, c.length + 4)); }),
      rows:out, freeze:1, filter:'A1:' + Xl.col(cols.length - 1) + out.length }]);
  }
};

/* ═══════════════ DFR (day timeline) ═══════════════ */
var Dfr = {
  push: function () {
    var t = today(), code = DB.me.code;
    var acts = [];
    DB.mine('SecOrders').filter(function (r) { return toISO(r.Date) === t; }).forEach(function (o) {
      acts.push({ ts:o.Ts, type:'Order', store:o.StoreName, detail:o.Status + ' · ' + inr(o.TotValue) }); });
    DB.mine('NewStores').filter(function (r) { return toISO(r.Date) === t; }).forEach(function (o) {
      acts.push({ ts:o.Ts, type:'New Outlet', store:o.StoreName, detail:o.Town || '' }); });
    DB.mine('PosmAudit').filter(function (r) { return toISO(r.Date) === t; }).forEach(function (o) {
      acts.push({ ts:o.Ts, type:'POSM Audit', store:o.StoreName, detail:o.Element || '' }); });
    DB.mine('PosmRequirement').filter(function (r) { return toISO(r.Date) === t; }).forEach(function (o) {
      acts.push({ ts:o.Ts, type:'POSM Req', store:o.StoreName, detail:'Required: ' + (o.Requirement || '') }); });
    acts.sort(function (a, b) { return String(a.ts).localeCompare(String(b.ts)); });
    return DB.save('Dfr', { Id:code + '_' + t, Date:t, VisitJson:JSON.stringify(acts),
      StoreCount:acts.length, OrderCount:acts.filter(function (a) { return a.type === 'Order'; }).length }, { quiet:true });
  }
};

/* ═══════════════ SEC — my orders ═══════════════ */
var Sec = {
  addPo:'', addQ:'',                       /* which order the product picker is adding to, + its search */
  /* ── PRIMARY SALES — pending secondary demand the distributor cannot currently supply ──
     Grouped by distributor because stock is a distributor-level number, not a per-store one. Only
     PENDING ("Order in Process") secondary orders count: a Billing Done order already reduced the
     distributor's real stock, so it already shows up (reduced) in their next upload — counting it
     again here would double-charge demand against stock that has already absorbed it. */
  primary: function () {
    var pend = DB.mine('SecOrders').filter(function (o) { return o.Status === 'Order in Process' && o.DbCode; });
    if (!pend.length) return { rows:[], loading:false };
    var need = {}, dbNames = {};
    pend.forEach(function (o) {
      var db = String(o.DbCode);
      dbNames[db] = o.DbName || dbNames[db] || '';
      Sec.lines(o).forEach(function (l) {
        var sku = String(l.Sku || ''); if (!sku) return;
        need[db] = need[db] || {};
        need[db][sku] = need[db][sku] || { name:l.SkuName, brand:l.Brand || '', qty:0 };
        need[db][sku].qty += num(l.Units);
      });
    });
    var out = [], loading = false;
    Object.keys(need).forEach(function (db) {
      var c = Stock.get('', db);
      if (!c) { Stock.load('', db); loading = true; return; }
      if (c.err) return;
      var stock = {};
      (c.db || []).forEach(function (r) { var k = Stock.sku(r); if (k) stock[k] = (stock[k] || 0) + Stock.qty(r); });
      Object.keys(need[db]).forEach(function (sku) {
        var n = need[db][sku], have = num(stock[sku]);
        if (n.qty > have) out.push({ dbName:dbNames[db] || db, sku:sku, name:n.name, brand:n.brand,
          ordered:n.qty, stock:have, short:n.qty - have });
      });
    });
    out.sort(function (a, b) { return b.short - a.short; });
    return { rows:out, loading:loading };
  },
  /* ── the day's PRIMARY order, per distributor ──
     Secondary demand rolled up the way a distributor has to buy it: one row per distributor × SKU, the
     units the reps' orders promised, what the distributor's own upload says they are holding, and the
     shortfall they therefore have to order in. Synchronous on purpose — this feeds the EOD workbook,
     which cannot wait on a stock fetch, so a distributor whose stock is not in the cache reports its
     stock as unknown and its whole demand as the primary need rather than silently reading zero.
     `orders` is whichever set of SecOrders rows the caller means (the day's, for EOD). */
  primaryRows: function (orders) {
    var need = {}, dbNames = {};
    (orders || []).forEach(function (o) {
      var db = String(o.DbCode || ''); if (!db) return;
      dbNames[db] = o.DbName || dbNames[db] || '';
      Sec.lines(o).forEach(function (l) {
        var sku = String(l.Sku || ''); if (!sku) return;
        need[db] = need[db] || {};
        need[db][sku] = need[db][sku] || { name:l.SkuName || '', brand:l.Brand || '',
          cat:l.Category || '', msl:l.MslStatus || '', mrp:num(l.Mrp), qty:0, val:0 };
        need[db][sku].qty += num(l.Units);
        need[db][sku].val += num(l.Units) * num(l.Mrp);
      });
    });
    var out = [];
    Object.keys(need).sort().forEach(function (db) {
      var c = Stock.get('', db), known = !!(c && !c.err), stock = {};
      if (known) (c.db || []).forEach(function (r) {
        var k = Stock.sku(r); if (k) stock[k] = (stock[k] || 0) + Stock.qty(r); });
      Object.keys(need[db]).forEach(function (sku) {
        var n = need[db][sku], have = known ? num(stock[sku]) : null;
        out.push({ db:db, dbName:dbNames[db] || db, sku:sku, name:n.name, brand:n.brand, cat:n.cat,
          msl:n.msl, mrp:n.mrp, ordered:n.qty, value:n.val, stock:have,
          /* the shortfall is only as good as the stock reading it came from — carry that reading's own
             date onto the row, so nobody acts on a week-old number without knowing it is one */
          stockAt:known ? ((c && c.dbAt) || '') : '',
          short:have === null ? n.qty : Math.max(0, n.qty - have) });
      });
    });
    return out.sort(function (a, b) {
      return String(a.dbName).localeCompare(String(b.dbName)) || (b.short - a.short); });
  },
  primaryHtml: function () {
    var r = Sec.primary();
    if (!r.rows.length && !r.loading) return '';
    if (r.loading && !r.rows.length) return '<div class="sec-title">Primary Sales</div>' +
      '<div class="strip b"><span class="g"><span class="spin"></span></span>' +
      '<div class="m"><b>Distributor stock check ho raha hai…</b></div></div>';
    if (!r.rows.length) return '';
    return '<div class="sec-title">Primary Sales — distributor ko chahiye</div>' +
      '<div class="card"><div class="hint" style="margin-bottom:8px">In SKU ka pending secondary order ' +
        'distributor ke current stock se zyada hai — unhe primary order punch karne ko bolo.</div>' +
      '<div class="pane"><table><thead><tr><th>Product</th><th class="num">Ordered</th>' +
        '<th class="num">DB stock</th><th class="num">Short</th></tr></thead><tbody>' +
      r.rows.map(function (x) {
        return '<tr><td><b class="nm">' + esc(x.name || x.sku) + '</b><div class="hint">' +
          (x.brand ? esc(x.brand) + ' · ' : '') + esc(x.dbName) + '</div></td>' +
          '<td class="num">' + x.ordered + '</td>' +
          '<td class="num">' + x.stock + '</td>' +
          '<td class="num"><span class="pill p-warn">+' + x.short + '</span></td></tr>';
      }).join('') + '</tbody></table></div></div>';
  },
  html: function () {
    var t = today();
    var all = DB.mine('SecOrders').sort(function (a, b) { return String(b.Date).localeCompare(String(a.Date)); });
    var td = all.filter(function (o) { return toISO(o.Date) === t; });
    var pend = all.filter(function (o) { return String(o.Status) === 'Order in Process'; });
    var h = UI.head('', 'Mere orders', 'Yahan se units/value/status change kar sakte ho — same row update hoti hai, duplicate nahi banti.');
    h += '<div class="kpis">' + UI.kpi(td.length, 'Aaj', 'b') + UI.kpi(pend.length, 'Pending', pend.length ? 'w' : 'g') +
      UI.kpi(lakh(td.reduce(function (a, o) { return a + num(o.TotNsvLakh); }, 0)), 'Aaj NSV ₹L', 'b') +
      UI.kpi(all.length, 'Total', '') + '</div>';

    if (Posm.store && !Gate.locked())
      h += '<div class="banner b" style="margin-top:12px"><span></span><div><b>' + esc(Posm.store.StoreName) + '</b> ka POSM pending hai.' +
        '<div class="btns"><button class="btn sm" onclick="Router.go(\'posm\')">POSM karo </button></div></div></div>';

    h += Sec.primaryHtml();

    h += '<div class="sec-title">Orders</div>';
    if (!all.length) return h + '<div class="card">' + UI.empty('', 'Abhi koi order nahi') + '</div>';
    h += all.slice(0, 60).map(function (o) {
      var open = Sec.edit === o.PoNumber;
      var cls = o.Status === 'Billing Done' ? 'p-ok' : (o.Status === 'Order in Process' ? 'p-warn' : 'p-bad');
      var body = '<div class="card"><div class="lrow" style="padding-top:0">' +
        '<div class="m"><div class="t">' + esc(o.StoreName) + '</div>' +
        '<div class="s">' + dmy(o.Date) + ' · PO ' + esc(o.PoNumber) + ' · ' + esc(o.Source || '') + '</div>' +
        '<div class="s">' + num(o.TotSku) + ' SKU · ' + num(o.TotUnits) + ' units</div>' +
        '<div class="s">MRP value ' + inr(o.TotValue) + ' · NSV ' + lakh(o.TotNsvLakh) + 'L</div>' +
        Pics.link(o.StoreName, o.Date, o.CompanyCode) + '</div>' +
        '<div style="text-align:right"><span class="pill ' + cls + '">' + esc(o.Status) + '</span>' +
        '<div style="margin-top:6px"><button class="btn ghost sm" onclick="Sec.' + (open ? 'close' : 'open') +
          '(\'' + esc(o.PoNumber) + '\')">' + (open ? 'Close' : 'Edit') + '</button></div></div></div>';
      if (open) body += Sec.editHtml(o);
      return body + '</div>';
    }).join('');
    return h;
  },
  edit:null,
  open: function (po) { Sec.edit = Sec.edit === po ? null : po; render(); },

  /* ── the ONE reader for an order's lines ──
     `LinesJson` is a convenience copy; the real per-SKU rows live in SecOrderLines. If the JSON is
     missing, unparseable or truncated (a Sheets cell caps at 50,000 characters, which a long order can
     reach) the editor used to show "no products" for an order whose header clearly had some — and
     saving from that state would have written TotSku/TotUnits/TotValue back as ZERO.
     So: JSON first, line rows as the fallback. */
  lines: function (o) {
    var l = [];
    try { l = JSON.parse(o.LinesJson || '[]') || []; } catch (e) { l = []; }
    if (l.length) return l;
    return DB.rows('SecOrderLines')
      .filter(function (r) { return String(r.PoNumber) === String(o.PoNumber); })
      .map(function (r) { return { Sku:String(r.Sku), SkuName:r.SkuName, Brand:r.Brand,
        Category:r.Category, SubCategory:r.SubCategory, Mrp:num(r.Mrp), Units:num(r.Units),
        Value:num(r.Value), MslStatus:r.MslStatus || '' }; });
  },
  /* an order whose header has numbers but whose lines cannot be recovered must NOT be saved — that
     would replace real totals with zeros */
  orphan: function (o, lines) {
    return !lines.length && (num(o.TotSku) > 0 || num(o.TotUnits) > 0 || num(o.TotValue) > 0);
  },
  editHtml: function (o) {
    var lines = Sec.lines(o);
    var po = esc(o.PoNumber), tu = 0, tv = 0;
    lines.forEach(function (l) { tu += num(l.Units); tv += num(l.Value); });
    return '<div style="border-top:1px dashed var(--line);padding-top:10px">' +
      (lines.length ? lines.map(function (l, i) {
        return '<div class="oline"><div class="oline-h"><div class="m">' +
          '<div class="t">' + esc(l.SkuName) + '</div>' +
          '<div class="hint">' + esc(l.Brand || '') + ' · MRP ' + inr(l.Mrp) + '</div></div>' +
          '<button class="oline-x" onclick="Sec.delLine(\'' + po + '\',' + i + ')">Remove</button></div>' +
          '<div class="oline-n">' +
            '<span class="lbl">Units</span>' +
            '<input class="in" id="sl_u' + i + '" type="number" min="0" value="' + num(l.Units) + '">' +
            '<span class="lbl">MRP value</span>' +
            '<input class="in v" id="sl_v' + i + '" type="number" min="0" value="' + num(l.Value) + '">' +
            /* one explicit Save writes BOTH numbers in a single sheet write — the old per-field
               onchange fired twice and only when the field happened to lose focus */
            '<button class="btn ok" onclick="Sec.saveLine(\'' + po + '\',' + i + ',this)">Save</button>' +
          '</div></div>';
      }).join('') : UI.empty('', 'Is order me koi product nahi — neeche se add karo')) +
      '<div class="lrow"><div class="m"><div class="t">' + lines.length + ' SKU · ' + tu + ' units</div>' +
        '<div class="s">MRP value ' + inr(tv) + '</div><div class="s">NSV ' + lakh(tv * .6 / 1e5) + 'L</div></div>' +
        '<button class="btn ok sm" style="flex:0 0 auto" onclick="Sec.addOpen(\'' + po + '\')">Product add</button></div>' +
      /* status + remarks no longer commit on blur: ONE Save writes the whole order, so nothing is
         written behind the rep's back and nothing typed just before Save is lost */
      '<label class="f">Status</label><select class="in" id="sl_status">' +
        ['Order in Process','Billing Done','Cancel Order'].map(function (s) {
          return '<option value="' + s + '"' + (s === o.Status ? ' selected' : '') + '>' + s + '</option>'; }).join('') + '</select>' +
      '<label class="f">Remarks</label><input class="in" id="sl_rm" value="' + esc(o.Remarks || '') + '">' +
      /* what the sheet holds RIGHT NOW, so "did it save?" is answerable on screen */
      '<div class="hint" id="sl_state" style="margin-top:10px">Sheet me: <b>' + num(o.TotSku) + ' SKU · ' +
        num(o.TotUnits) + ' units · ' + inr(o.TotValue) + '</b> · ' + esc(o.Status) +
        (Sec.savedAt[o.PoNumber] ? ' · <b>Save hua ' + esc(Sec.savedAt[o.PoNumber]) + '</b>' : '') + '</div>' +
      '<div class="btns">' +
        '<button class="btn" id="sl_save" onclick="Sec.saveAll(\'' + po + '\',this)">Save order</button>' +
        '<button class="btn ghost" onclick="Sec.close(\'' + po + '\')">Close</button>' +
        '<button class="btn ghost sm" onclick="Sec.share(\'' + esc(o.PoNumber) + '\')">Share</button>' +
      '</div></div>';
  },
  /* ── ONE save for the whole panel ──
     The old footer had a "Done" button that read `Sec.edit=null;render();toast('Saved')` — it closed the
     panel and SAID Saved while writing nothing at all. Units only reached the sheet if the input
     happened to lose focus first, which on a phone it often does not. This reads every field on screen
     and writes once. */
  savedAt:{},
  saveAll: function (po, el) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o);
    if (Sec.orphan(o, lines)) return toast('Is order ki lines nahi mili — Sync karke dobara try karo', 5000);
    lines.forEach(function (l, i) {
      if (!$('sl_u' + i)) return;
      var u = num(val('sl_u' + i)), v = num(val('sl_v' + i));
      l.Units = u;
      l.Value = (v && v !== num(l.Value)) ? v : u * num(l.Mrp);   /* a hand-typed value wins */
    });
    var head = Object.assign({}, o, { Status:val('sl_status') || o.Status,
                                      Remarks:$('sl_rm') ? String($('sl_rm').value || '') : (o.Remarks || '') });
    if (head.Status === 'Billing Done' && !o.DeliveredAt)
      head.DeliveredAt = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    /* stamped BEFORE the commit, because commit() re-renders and that render draws the stamp */
    Sec.savedAt[po] = new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' });
    return Busy.run('saveall_' + po, el, 'Save ho raha hai…', function () {
      return Sec.commit(head, lines, 'Order update ho gaya — sheet me chala gaya')
        .then(function () { Log.add('Order', 'Edited', po, head.Status + ' · ' + lines.length + ' SKU'); });
    });
  },
  /* has anything on screen not been written yet? */
  dirty: function (po) {
    var o = DB.find('SecOrders', po); if (!o) return false;
    var lines = Sec.lines(o);
    if ($('sl_status') && val('sl_status') !== String(o.Status)) return true;
    if ($('sl_rm') && String($('sl_rm').value || '') !== String(o.Remarks || '')) return true;
    return lines.some(function (l, i) {
      if (!$('sl_u' + i)) return false;
      return num(val('sl_u' + i)) !== num(l.Units) || num(val('sl_v' + i)) !== num(l.Value);
    });
  },
  /* closing with unsaved edits used to throw them away silently */
  close: function (po) {
    if (!Sec.dirty(po)) { Sec.edit = null; render(); return; }
    UI.dialog({ icon:'', title:'Save kiye bina band karein?',
      msg:'Is order me kuch change kiya hai jo abhi sheet me nahi gaya.',
      ok:'Save karke band karo', cancel:'Bina save band karo' }).then(function (save) {
      if (save) return Sec.saveAll(po, null).then(function () { Sec.edit = null; render(); });
      Sec.edit = null; render();
    });
  },
  setLine: function (po, i, k, v) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o);
    if (!lines[i]) return;
    lines[i][k] = num(v);
    if (k === 'Units') lines[i].Value = num(v) * num(lines[i].Mrp);
    return Sec.commit(o, lines);
  },
  /* Save next to the numbers: reads BOTH boxes and writes once. Units alone still recomputes the value
     from MRP, but a value the rep typed by hand wins — that is the whole point of the second box. */
  saveLine: function (po, i, el) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o);
    if (!lines[i]) return;
    var u = num(val('sl_u' + i)), v = num(val('sl_v' + i));
    var was = num(lines[i].Units), wasV = num(lines[i].Value);
    if (u === was && v === wasV) return toast('Kuch change nahi hua');
    lines[i].Units = u;
    lines[i].Value = (v && v !== wasV) ? v : u * num(lines[i].Mrp);
    return Busy.run('line_' + po + '_' + i, el, 'Save…', function () {
      return Sec.commit(o, lines, lines[i].SkuName + ' update ho gaya');
    });
  },

  /* one place that writes an edited order: header totals + every line row, always in step */
  commit: function (o, lines, msg) {
    var po = String(o.PoNumber), tu = 0, tv = 0;
    lines.forEach(function (l) { tu += num(l.Units); tv += num(l.Value); });
    return DB.save('SecOrders', Object.assign({}, o, { LinesJson:JSON.stringify(lines), TotUnits:tu, TotValue:tv,
      TotSku:lines.length, TotNsvLakh:+(tv * .6 / 1e5).toFixed(4) }), { quiet:true })
      .then(function () {
        return DB.saveMany('SecOrderLines', lines.map(function (l) {
          return Object.assign({}, l, { LineId:po + '__' + l.Sku, PoNumber:po, Date:toISO(o.Date), StoreName:o.StoreName,
            CompanyCode:o.CompanyCode, NsvLakh:+(num(l.Value) * .6 / 1e5).toFixed(4), Status:o.Status }); }));
      })
      .then(function () { return Dfr.push(); })
      .then(function () { render(); if (msg) toast(msg); });
  },

  /* REMOVE a product — the line row is deleted from the sheet too, not just from the JSON */
  delLine: function (po, i) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o), l = lines[i];
    if (!l) return;
    UI.confirm({ icon:'', title:'Ye product hata dein?', danger:true,
      msg:'<b>' + esc(l.SkuName) + '</b><br>' + num(l.Units) + ' units · ' + inr(l.Value) +
          '<br>Order ka total dobara calculate ho jayega.',
      ok:'Haan, hatao', cancel:'Nahi' }).then(function (go) {
      if (!go) return;
      lines.splice(i, 1);
      return DB.remove('SecOrderLines', po + '__' + l.Sku)
        .then(function () { return Sec.commit(o, lines, '' + l.SkuName + ' hata diya'); })
        .then(function () { Log.add('Order', 'Line removed', po, l.SkuName); });
    });
  },

  /* ADD a product to an existing order — same finder behaviour as the Field tab */
  addOpen: function (po) {
    Sec.addPo = po; Sec.addQ = '';
    UI.sheet('Product add karo', '<input class="in" id="sec_q" placeholder="Naam ya code se dhoondho…" ' +
      'oninput="Sec.addQ=this.value;Sec.addList()"><div id="sec_list" class="slist" style="margin-top:10px"></div>');
    Sec.addList();
    var q = $('sec_q'); if (q) q.focus();
  },
  addList: function () {
    var box = $('sec_list'); if (!box) return;
    var o = DB.find('SecOrders', Sec.addPo) || {}, have = {};
    Sec.lines(o).forEach(function (l) { have[String(l.Sku)] = num(l.Units); });
    var q = String(Sec.addQ || '').toLowerCase().trim();
    /* search also matches the category, so "face wash" finds the SKUs even without the brand */
    var list = DB.products().filter(function (p) {
      return !q || (String(p.Name) + ' ' + String(p.Code) + ' ' + String(p.Brand) + ' ' +
                    String(p.Category) + ' ' + String(p.SubCategory)).toLowerCase().indexOf(q) >= 0; });
    box.innerHTML = I18n.tr('<div class="hint" style="margin-bottom:6px">' + list.length + ' SKU' +
        (list.length > 60 ? ' — search se narrow karo' : '') + '</div>' +
      (list.length ? list.slice(0, 60).map(function (p) {
        var n = have[String(p.Code)];
        return '<div class="lrow" style="cursor:pointer" onclick="Sec.addLine(\'' + esc(p.Code) + '\')">' +
          '<div class="m"><div class="t">' + esc(p.Name) + '</div><div class="s">' + esc(p.Brand || '') +
          ' · MRP ' + inr(p.MRP) + (/^msl$/i.test(String(p.MslStatus || '')) ? ' · <b>MSL</b>' : '') + '</div>' +
          '<div class="s">' + esc(p.Category || '—') + (p.SubCategory ? ' › ' + esc(p.SubCategory) : '') + '</div></div>' +
          '<span class="pill ' + (n ? 'p-blue' : 'p-ok') + '">' + (n ? n + ' added' : '+ Add') + '</span></div>';
      }).join('') : UI.empty('', 'Koi product nahi mila')));
  },
  addLine: function (code) {
    var o = DB.find('SecOrders', Sec.addPo); if (!o) return;
    var p = DB.products().filter(function (x) { return String(x.Code) === String(code); })[0];
    if (!p) return;
    var lines = Sec.lines(o);
    var ex = lines.filter(function (l) { return String(l.Sku) === String(p.Code); })[0];
    if (ex) { ex.Units = num(ex.Units) + 1; ex.Value = num(ex.Units) * num(ex.Mrp || p.MRP); }
    else lines.push({ Sku:String(p.Code), SkuName:p.Name, Brand:p.Brand, Category:p.Category,
      SubCategory:p.SubCategory, Mrp:num(p.MRP), Units:1, Value:num(p.MRP), MslStatus:p.MslStatus || '' });
    Sec.commit(o, lines, '' + p.Name).then(function () { Sec.addList(); });
  },
  setStatus: function (po, s) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o);          /* JSON, or rebuilt from the SecOrderLines rows */
    /* committing with no recoverable lines would rewrite real totals as zeros */
    if (Sec.orphan(o, lines)) return toast('Is order ki lines nahi mili — Sync karke dobara try karo', 5000);
    /* the status lives on the line rows too — commit rewrites both, so a report built off
       SecOrderLines can never disagree with the order header */
    var now = new Date().toISOString();
    var nu = Object.assign({}, o, { Status:s, StatusAt:now,
      DeliveredAt:s === 'Billing Done' ? now : (o.DeliveredAt || '') });
    /* a caller that needs to know when this is really done (Trk's Cancel-Order flow, which writes
       the reason only after the status commit lands) needs a REAL promise back — this used to fall
       off the end returning undefined, which nothing chained onto until now. */
    return Sec.commit(nu, lines, 'Status:' + s).then(function () { Log.add('Order', 'Status ' + s, po, o.StoreName); });
  },
  setField: function (po, k, v) {
    var o = DB.find('SecOrders', po); if (!o) return Promise.resolve();
    var patch = {}; patch[k] = v;
    return DB.save('SecOrders', Object.assign({}, o, patch), { quiet:true });
  },
  /* Full = the whole PO was invoiced, no extra detail needed. Partial = the distributor could only
     bill some of it — BilledUnits is the actual invoiced qty, BillingRemark is compulsory the
     moment BillingType is 'Partial' (enforced by the caller, Trk.saveBilling, before this runs). */
  setBilling: function (po, type, units, remark) {
    var o = DB.find('SecOrders', po); if (!o) return Promise.resolve();
    return DB.save('SecOrders', Object.assign({}, o, { BillingType:type,
      BilledUnits:type === 'Full' ? num(o.TotUnits) : num(units),
      BillingRemark:type === 'Full' ? '' : String(remark || '') }), { quiet:true });
  },
  share: function (po) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o);          /* JSON, or rebuilt from the SecOrderLines rows */
    var L = ['*GARUDA — Secondary Order*', 'PO: *' + o.PoNumber + '*', dmy(o.Date) + ' · ' + o.EmpName, '',
      'Store : ' + o.StoreName + (o.City ? ' (' + o.City + ')' : ''), 'DB    : ' + (o.DbName || '—'),
      'Status: ' + o.Status + (o.Reason ? ' (' + o.Reason + ')' : ''), ''];
    lines.forEach(function (l, i) { L.push((i + 1) + '. ' + l.SkuName + ' — ' + num(l.Units) + ' u · ' + inr(l.Value)); });
    L.push('', 'TOTAL: ' + num(o.TotSku) + ' SKU · ' + num(o.TotUnits) + ' units');
    L.push('MRP value: ' + inr(o.TotValue));
    L.push('NSV      : ₹' + lakh(o.TotNsvLakh) + 'L');
    if (o.Remarks) L.push('Remarks: ' + o.Remarks);
    UI.sheet('Order share karo', '<div class="btns"><button class="btn" onclick="UI.close();Share.wa(' + JSON.stringify(JSON.stringify(L.join('\n'))) + ')"> WhatsApp</button>' +
      '<button class="btn ghost" onclick="UI.close();Share.mail(\'Secondary Order ' + esc(o.PoNumber) + '\',' + JSON.stringify(JSON.stringify(L.join('\n'))) + ')"> Email</button></div>');
  }
};

/* ═══════════════ SEC ORDER — every shop's final order, adjustable mid-day ═══════════════
   The Orders tab is a list of purchase orders; this is the other question a rep gets asked at two in the
   afternoon: "what did you finally book for that shop?" So it is shop-first — one card per store with the
   order as it stands — and everything on it can be moved: a line's units up or down, a line out, or the
   whole shop back into the order flow to add something.

   It writes through Sec.commit, the same path the order screens use, so the header totals, the
   SecOrderLines rows and the LinesJson copy can never disagree with each other.                       */
var Fin = {
  day:'', open:'', q:{},

  /* which day is being adjusted — today unless the rep looks back */
  date: function () {
    var t = today();
    if (!Fin.day || Fin.day > t) Fin.day = t;
    return Fin.day;
  },
  /* the days this rep actually has orders for, newest first — nothing to scroll through that is empty */
  days: function () {
    var seen = {}, out = [];
    DB.mine('SecOrders').forEach(function (o) { var d = toISO(o.Date); if (d) seen[d] = 1; });
    seen[today()] = 1;
    Object.keys(seen).sort().reverse().forEach(function (d) { out.push(d); });
    return out.slice(0, 60);
  },
  /* one entry per SHOP for the chosen day: its order, its lines and its totals */
  shops: function () {
    var d = Fin.date(), out = [];
    DB.mine('SecOrders').forEach(function (o) {
      if (toISO(o.Date) !== d) return;
      var lines = Sec.lines(o), u = 0, v = 0;
      lines.forEach(function (l) { u += num(l.Units); v += num(l.Value); });
      out.push({ po:String(o.PoNumber), o:o, lines:lines, units:u, value:v,
                 name:o.StoreName || '', code:String(o.CompanyCode || o.ClientId || ''),
                 src:o.Source || '', st:String(o.Status || '') });
    });
    return out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  },

  html: function () {
    var d = Fin.date(), shops = Fin.shops();
    var h = UI.head('', 'Sec order — shop ka final order',
      'Din ke beech me koi adjust karne ko kahe to yahin se karo — units badlo, line hatao, ' +
      'ya us shop me naya product add karo.');

    var units = 0, value = 0, skus = 0;
    shops.forEach(function (s) { units += s.units; value += s.value; skus += s.lines.length; });
    h += '<div class="kpis">' +
      UI.kpi(shops.length, 'Shop', 'b') + UI.kpi(skus, 'SKU', '') +
      UI.kpi(units, 'Units', '') + UI.kpi(inr(value), 'MRP value', 'g') + '</div>';
    h += '<div class="kpis k3" style="margin-top:-2px">' +
      UI.kpi(lakh(value * .6 / 1e5), 'NSV ₹L', 'b') + '</div>';

    /* which day */
    h += '<div class="card" style="padding:10px"><div class="row two">' +
      '<div><label class="f">Din</label>' +
      '<select class="in" onchange="Fin.setDay(this.value)">' + Fin.days().map(function (k) {
        return '<option value="' + k + '"' + (k === d ? ' selected' : '') + '>' + dmy(k) +
          (k === today() ? ' (aaj)' : '') + '</option>'; }).join('') + '</select></div>' +
      '<div><label class="f">&nbsp;</label>' +
        '<button class="btn ghost" onclick="Router.go(\'field\')">Naya order</button></div>' +
      '</div>' +
      (Gate.locked() ? '<div class="hint" style="margin-top:8px;color:var(--bad);font-weight:700">' +
        'Aaj ka din lock hai — pehle Field tab se din dobara kholo.</div>' : '') + '</div>';

    if (!shops.length) return h + '<div class="card">' +
      UI.empty('', dmy(d) + ' ka koi order nahi hai') +
      '<div class="btns"><button class="btn" onclick="Router.go(\'field\')">Field tab kholo</button></div></div>';

    h += '<div class="sec-title">' + shops.length + ' shop · ' + dmy(d) + '</div>';
    h += shops.map(Fin.card).join('');
    return h;
  },

  card: function (s) {
    var op = Fin.open === s.po;
    var cls = /billing|delivered/i.test(s.st) ? 'p-ok' : /cancel|no.?order/i.test(s.st) ? 'p-bad' : 'p-warn';
    var h = '<div class="card' + (op ? ' op' : '') + '">' +
      '<div class="lrow" style="padding-top:0"><div class="m">' +
      '<div class="t">' + esc(s.name) + '</div>' +
      '<div class="s">' + esc(s.code || '—') + ' · PO ' + esc(s.po) + (s.src ? ' · ' + esc(s.src) : '') + '</div>' +
      '<div class="s"><b>' + s.lines.length + ' SKU · ' + s.units + ' units</b></div>' +
      '<div class="s">MRP value ' + inr(s.value) + ' · NSV ' + lakh(s.value * .6 / 1e5) + 'L</div></div>' +
      '<div style="text-align:right"><span class="pill ' + cls + '">' + esc(s.st) + '</span>' +
      '<div style="margin-top:6px"><button class="btn ' + (op ? 'ghost ' : '') + 'sm" onclick="Fin.tap(\'' +
        esc(s.po) + '\')">' + (op ? 'Close' : 'Adjust') + '</button></div></div></div>';
    if (!op) return h + '</div>';

    /* the lines, each with minus / plus / remove and a units box */
    h += '<div style="border-top:1px dashed var(--line);padding-top:10px">';
    if (!s.lines.length) h += UI.empty('', 'Is order me koi product nahi — neeche se add karo');
    s.lines.forEach(function (l, i) {
      var q = Fin.q[s.po + '|' + i];
      var u = q === undefined ? num(l.Units) : num(q);
      h += '<div class="oline"><div class="oline-h"><div class="m">' +
        '<div class="t">' + esc(l.SkuName) + '</div>' +
        '<div class="hint">' + esc(l.Brand || '') + ' · MRP ' + inr(l.Mrp) + ' · MRP value ' +
          inr(u * num(l.Mrp)) + '</div></div>' +
        '<button class="oline-x" onclick="Fin.drop(\'' + esc(s.po) + '\',' + i + ')">Remove</button></div>' +
        '<div class="dsave" style="border-top:0;margin-top:6px">' +
          '<button class="btn ghost" style="flex:0 0 44px;min-width:44px" onclick="Fin.step(\'' +
            esc(s.po) + '\',' + i + ',-1)">−</button>' +
          '<input class="in" style="flex:1 1 60px;text-align:center" type="number" min="0" ' +
            'id="fn_' + esc(s.po) + '_' + i + '" value="' + u +
            '" oninput="Fin.setQ(\'' + esc(s.po) + '\',' + i + ',this.value)">' +
          '<button class="btn ghost" style="flex:0 0 44px;min-width:44px" onclick="Fin.step(\'' +
            esc(s.po) + '\',' + i + ',1)">+</button>' +
          '<button class="btn ok" onclick="Fin.saveLine(\'' + esc(s.po) + '\',' + i + ',this)">Save</button>' +
        '</div></div>';
    });

    /* add a product: back to the shelf, with this shop already selected */
    h += '<div class="lrow"><div class="m"><div class="t">' + s.lines.length + ' SKU · ' + s.units +
      ' units</div><div class="s">MRP value ' + inr(s.value) + '</div>' +
      '<div class="s">NSV ' + lakh(s.value * .6 / 1e5) + 'L</div></div>' +
      '<button class="btn ok sm" style="flex:0 0 auto" onclick="Fin.add(\'' + esc(s.po) + '\')">Product add</button></div>';

    h += '<label class="f">Status</label>' +
      '<select class="in" onchange="Fin.setStatus(\'' + esc(s.po) + '\',this.value)">' +
      ['Order in Process','Billing Done','Cancel Order'].map(function (x) {
        return '<option value="' + x + '"' + (x === s.st ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
      '</select>' +
      '<div class="btns"><button class="btn ghost" onclick="Fin.tap(\'' + esc(s.po) + '\')">Close</button>' +
      '<button class="btn ghost sm" onclick="Sec.share(\'' + esc(s.po) + '\')">Share</button></div>';
    return h + '</div></div>';
  },

  setDay: function (v) { Fin.day = v; Fin.open = ''; Fin.q = {}; render(); },
  tap: function (po) { Fin.open = Fin.open === po ? '' : po; Fin.q = {}; render(); },
  setQ: function (po, i, v) { Fin.q[po + '|' + i] = v; },
  /* − / + move the box AND write it, because that is what a tap means here */
  step: function (po, i, by) {
    var s = Fin.one(po); if (!s) return;
    var l = s.lines[i]; if (!l) return;
    var k = po + '|' + i;
    var cur = Fin.q[k] === undefined ? num(l.Units) : num(Fin.q[k]);
    var nu = Math.max(0, cur + by);
    Fin.q[k] = nu;
    var box = $('fn_' + po + '_' + i);
    if (box) box.value = nu;
    Fin.write(po, function (lines) { lines[i].Units = nu; lines[i].Value = nu * num(lines[i].Mrp); },
      l.SkuName + ' — ' + nu + ' units');
  },
  saveLine: function (po, i, el) {
    var s = Fin.one(po); if (!s) return;
    var l = s.lines[i]; if (!l) return;
    var v = Fin.q[po + '|' + i];
    var nu = Math.max(0, num(v === undefined ? val('fn_' + po + '_' + i) : v));
    return Busy.run('fin_' + po + '_' + i, el, 'Save…', function () {
      return Fin.write(po, function (lines) {
        lines[i].Units = nu; lines[i].Value = nu * num(lines[i].Mrp); },
        l.SkuName + ' — ' + nu + ' units');
    });
  },
  drop: function (po, i) {
    var s = Fin.one(po); if (!s) return;
    var l = s.lines[i]; if (!l) return;
    return UI.confirm({ icon:'', title:'Line hatao?', danger:true,
      msg:'<b>' + esc(l.SkuName) + '</b> is order se hat jayega.',
      ok:'Haan, hatao', cancel:'Nahi' }).then(function (go) {
      if (!go) return;
      Fin.q = {};
      return Fin.write(po, function (lines) { lines.splice(i, 1); }, l.SkuName + ' hata diya');
    });
  },
  setStatus: function (po, st) {
    var s = Fin.one(po); if (!s) return;
    return Fin.write(po, null, 'Status — ' + st, st);
  },
  /* "add" belongs in the order flow, not in a second product picker: pick the shop up again and hand
     the rep the shelf he already knows */
  add: function (po) {
    var s = Fin.one(po); if (!s) return;
    var store = (DB.myStores() || []).filter(function (x) {
      return String(x.CompanyCode || x.ClientId) === s.code ||
             String(x.StoreName || '').toUpperCase() === String(s.name).toUpperCase(); })[0];
    if (!store) return toast('Ye shop master me nahi mila — Field tab se add karo');
    if (Gate.locked()) return toast('Aaj ka din lock hai — pehle din dobara kholo');
    Field.store = store;
    Field.src = s.src || 'Store Visit';
    Field.srcSet = true;
    Field.lines = s.lines.slice();
    Field.editPo = s.po;                       /* so the order screen updates THIS po, not a new one */
    Stk.open = ''; Stk.qty = {};
    Router.go('stk');
    toast(s.name + ' — shelf khul gaya, product add karo aur order complete karo', 4000);
  },
  one: function (po) {
    return Fin.shops().filter(function (s) { return s.po === String(po); })[0];
  },
  /* every write goes through Sec.commit, so the header, the lines and LinesJson stay in step */
  write: function (po, edit, msg, status) {
    var s = Fin.one(po); if (!s) return Promise.resolve();
    var lines = s.lines.map(function (l) { return Object.assign({}, l); });
    if (edit) edit(lines);
    var u = 0, v = 0;
    lines.forEach(function (l) { u += num(l.Units); v += num(l.Value); });
    var nu = Object.assign({}, s.o, { TotSku:lines.length, TotUnits:u, TotValue:v,
      TotNsvLakh:Math.round(v * .6 / 1e5 * 10000) / 10000, UpdatedAt:Date.now() });
    if (status) { nu.Status = status; nu.StatusAt = new Date().toISOString(); }
    return Sec.commit(nu, lines, msg).then(function () {
      Fin.q = {}; render();
    });
  }
};

/* ═══════════════ POSM ═══════════════ */
var Posm = {
  store:null, ans:null,
  date:'',                                  /* which beat this entry belongs to (default today) */
  need:'Yes',                               /* requirement Yes/No — decides which photo is compulsory */
  day: function () { return Posm.date || today(); },
  /* today -> camera only, always. A back-date -> camera only UNLESS an admin has granted this
     person Bypass (round 80) — gallery for an old visit is no longer free for the asking. */
  live: function () { return Cam.live(Posm.day()) || !Bypass.on(); },
  meta: function () {
    var s = Posm.store || {};
    return { module:'POSM', store:s.StoreName || '', companyCode:s.CompanyCode || '',
             recordId:(DB.me.code || '') + '_' + Posm.day() + '_' + String(s.CompanyCode || s.ClientId || 'NA'),
             date:Posm.day() };
  },
  setDay: function (v) {
    var d = toISO(v);
    if (d > today()) { toast('Aage ki date nahi chal sakti'); return render(); }
    Posm.date = d; render();
    toast(Cam.live(d) ? 'Aaj ka beat — live camera'
      : (Bypass.on() ? 'Purana beat — gallery se upload allowed (bypass ON)'
                     : 'Purana beat — live camera hi chalega, gallery ke liye admin se bypass maango'), 3600);
  },
  /* the date picker + a plain-language note about which photo source is allowed */
  dayHtml: function () {
    var d = Posm.day(), today_ = Cam.live(d), lv = Posm.live();
    return '<div class="card"><h3><span class="ic"></span>Kis din ka POSM?</h3>' +
      '<input class="in" type="date" max="' + today() + '" value="' + d + '" onchange="Posm.setDay(this.value)">' +
      '<div class="' + (lv ? 'hint' : 'banner w') + '" style="margin-top:8px">' +
      (today_ ? 'Aaj ka beat hai — photo <b>live camera</b> se hi lena hoga.'
        : (lv ? '<b>Purana beat (' + dmy(d) + ')</b> — gallery ke liye <b>admin approval (bypass)</b> chahiye. ' +
                'Abhi tak nahi diya gaya, isliye photo live camera se hi lena hoga.'
              : '<span></span><div><b>Purana beat (' + dmy(d) + ')</b><br><span style="font-weight:500">' +
                'Admin ne approve kiya hai (bypass ON) — gallery se photo upload kar sakte ho.</span></div>')) +
      '</div></div>';
  },
  html: function () {
    if (Gate.locked()) return Field.lockedHtml();
    var t = today();
    var mine = DB.mine('PosmAudit').filter(function (r) { return toISO(r.Date) === t; });
    var reqs = DB.mine('PosmRequirement').filter(function (r) { return toISO(r.Date) === t; });
    var h = UI.head('', 'POSM', 'Store me POSM laga hai ya nahi — dono case me entry karo.');
    if (!Posm.store) {
      h += '<div class="card"><h3><span class="ic"></span>Store</h3>' +
        '<div class="sub">Field tab me store ka order/visit save karo — wahi store yahan aa jayega. ' +
        'Niche <b>Next store</b> dabao — Field tab khul jayega.</div></div>';
    } else {
      h += '<div class="banner b"><span></span><div><b>' + esc(Posm.store.StoreName) + '</b><br><span style="font-weight:500">' +
        esc(Posm.store.City || '') + ' · ' + esc(Posm.store.CompanyCode || '') + '</span></div></div>';
      h += Posm.dayHtml();
      if (Posm.ans === null) {
        h += '<div class="card"><h3><span class="ic">?</span>Is store me POSM laga hai?</h3>' +
          '<div class="btns"><button class="btn ok" onclick="Posm.set(true)"> Haan — audit karo</button>' +
          '<button class="btn warn" onclick="Posm.set(false)"> Nahi — requirement bhejo</button></div></div>';
      } else if (Posm.ans) h += Posm.auditHtml();
      else h += Posm.reqHtml();
    }
    h += '<div class="card"><div class="btns" style="margin:0">' +
      '<button class="btn ghost" onclick="Posm.nextStore()"> Next store</button>' +
      '<button class="btn warn" onclick="Posm.closeDay()"> Close day</button></div></div>';
    h += '<div class="sec-title">Aaj ka POSM (' + (mine.length + reqs.length) + ')</div><div class="card">' +
      (mine.length + reqs.length ? mine.map(function (r) {
        return '<div class="lrow"><div class="m"><div class="t">' + esc(r.StoreName) + '</div><div class="s">' +
          esc(r.Element || '') + ' · ' + esc(r.Condition || '') + '</div>' +
          Pics.link(r.StoreName, r.Date, r.CompanyCode) + '</div><span class="pill p-ok">Audit</span></div>'; }).join('') +
        reqs.map(function (r) {
        return '<div class="lrow"><div class="m"><div class="t">' + esc(r.StoreName) + '</div><div class="s">Required: ' +
          esc(r.Requirement || '') + '</div>' + Pics.link(r.StoreName, r.Date, r.CompanyCode) +
          '</div><span class="pill p-warn">Req</span></div>'; }).join('')
      : UI.empty('', 'Aaj koi POSM entry nahi')) + '</div>';
    return h;
  },
  set: function (yes) {
    Posm.ans = yes;
    Cam.clear(['posm1','posm2','posm_x','shop','shelf','req_x']);   /* fresh answer = fresh photos */
    render();
  },
  /* the same reset saveAudit/saveReq already do on success, and then straight to Field — the next
     store is CHOSEN there, so landing on an empty POSM screen only made the rep tap again. */
  nextStore: function () {
    Posm.store = null; Posm.ans = null; Posm.date = ''; Posm.need = 'Yes';
    Cam.clear(['posm1','posm2','posm_x','shop','shelf','req_x']);
    Router.go('field');
  },
  /* CASE 1 — POSM laga hua hai: do photo compulsory, teesra optional */
  auditPhotos: function () {
    var o = { live:Posm.live(), sendJs:'Posm.meta()', cbJs:'Posm.shot' };
    return '<div class="sec-title">Photo (2 compulsory)</div>' +
      '<div class="ph-g two">' +
        Cam.tile('posm1', 'POSM ka close-up', true, o) +
        Cam.tile('posm2', 'Poori shelf jisme POSM dikhe', true, o) +
      '</div><div class="ph-g" style="margin-top:10px">' +
        Cam.tile('posm_x', 'Ek aur photo', false, o) + '</div>';
  },
  /* CASE 2 — POSM nahi hai. Requirement hai to shelf ka photo, warna poore shop ka. */
  reqPhotos: function () {
    var o = { live:Posm.live(), sendJs:'Posm.meta()', cbJs:'Posm.shot' }, need = val('pr_need') !== 'No';
    return '<div class="sec-title">Photo (1 compulsory)</div>' +
      (need
        ? '<div class="hint" style="margin-bottom:8px">Jis <b>shelf par POSM lagana hai</b> uska photo lo — jagah saaf dikhni chahiye.</div>' +
          '<div class="ph-g">' + Cam.tile('shelf', 'Shelf jahan POSM lagega', true, o) + '</div>'
        : '<div class="hint" style="margin-bottom:8px">POSM ki zaroorat nahi hai, to <b>poore shop ka</b> ek photo lo — ' +
          'counter aur shelf dono frame me aane chahiye.</div>' +
          '<div class="ph-g">' + Cam.tile('shop', 'Poore shop ka photo', true, o) + '</div>') +
      '<div class="ph-g" style="margin-top:10px">' + Cam.tile('req_x', 'Ek aur photo', false, o) + '</div>';
  },
  auditHtml: function () {
    var S = { El:['Wobbler','Shelf Strip','Dangler','Poster','Standee','FSU','CTU','Vinyl','Glow Sign','Other'],
      Ty:['Soft POSM','Hard Asset'], Lo:['Brand Block','Category Block','Both'],
      Br:['Mamaearth','The Derma Co.','BBlunt','Aqualogica',"Dr. Sheth's",'ME Color Care'],
      As:['FSU','CTU','Shelf Unit','Display Rack','Gondola','Counter Display','Wall Unit'],
      Do:['Board Branding','Light Branding','Header','Fixture Branding','Wall Branding','Pillar','Window'],
      Cn:['Excellent','Good','Fair','Damaged'], Vi:['Fully Visible','Partially Visible','Not Visible'],
      Ac:['No Action','Maintenance','Replacement','Relocation','Removal'],
      Ib:['Agency','Distributor','Sales Team'], Vb:['BDE','ASM','RSM'] };
    var sel = function (id, arr, lbl, req) {
      return '<div><label class="f">' + lbl + (req ? ' <span class="req">*</span>' : '') + '</label><select class="in" id="' + id + '">' +
        '<option value="">— Select —</option>' + arr.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') + '</select></div>'; };
    return '<div class="card"><h3><span class="ic"></span>Store audit</h3>' +
      '<div class="row two">' + sel('pa_el', S.El, 'POSM element', 1) + sel('pa_ty', S.Ty, 'POSM type') + '</div>' +
      '<div class="row two">' + sel('pa_lo', S.Lo, 'Install location') + sel('pa_br', S.Br, 'Honasa brand', 1) + '</div>' +
      '<div class="row two">' + sel('pa_as', S.As, 'Asset type') + '<div><label class="f">Installation period</label><input class="in" id="pa_pd" type="date"></div></div>' +
      '<div class="row two">' + sel('pa_do', S.Do, 'Brand dominance') + sel('pa_cn', S.Cn, 'Condition', 1) + '</div>' +
      '<div class="row two">' + sel('pa_vi', S.Vi, 'Visibility') + sel('pa_ac', S.Ac, 'Action required') + '</div>' +
      '<div class="row two">' + sel('pa_ib', S.Ib, 'Installed by') + sel('pa_vb', S.Vb, 'Verified by') + '</div>' +
      '<div class="row two"><div><label class="f">Verification date</label><input class="in" id="pa_vd" type="date" value="' + today() + '"></div>' +
        '<div><label class="f">Next review</label><input class="in" id="pa_nr" type="date"></div></div>' +
      '<label class="f">Remarks</label><textarea class="in" id="pa_rm" rows="2"></textarea>' +
      Posm.auditPhotos() +
      '<div class="banner w" id="pa_need" style="margin-top:10px;display:' + (Posm.auditReady() ? 'none' : '') + '">' +
        '<span></span><div><b>Dono compulsory photo lo</b><br><span style="font-weight:500">POSM ka close-up aur ' +
        'poori shelf — tabhi save hoga.</span></div></div>' +
      '<div class="btns"><button class="btn" id="pa_save" onclick="Posm.saveAudit(this)"' + (Posm.auditReady() ? '' : ' disabled') +
        '> Audit save karo</button>' +
      '<button class="btn ghost" onclick="Posm.ans=null;render()"> Wapas</button></div></div>';
  },
  /* Taking a photo must unlock Save straight away. A full render would rebuild this form and throw away
     the element / brand / condition / remarks the rep already chose, so only the gate is refreshed. */
  shot: function () {
    var b = $('pa_save'); if (b) b.disabled = !Posm.auditReady();
    var n = $('pa_need'); if (n) n.style.display = Posm.auditReady() ? 'none' : '';
    var rb = $('pr_save'); if (rb) rb.disabled = !Posm.reqReady();
    var rn = $('pr_need_note'); if (rn) rn.style.display = Posm.reqReady() ? 'none' : '';
  },
  /* ONE readiness test per screen, used by the button's disabled state AND by the handler — a
     bypassed user is ready without the photos, everyone else is not. */
  auditReady: function () { return Bypass.on() || (Cam.ok('posm1') && Cam.ok('posm2')); },
  saveAudit: function (el) {
    if (Busy.busy('posm')) return toast('Ruko — POSM save ho raha hai');
    if (!Posm.auditReady()) return toast('POSM ke 2 photo compulsory hain');
    if (!val('pa_el')) return toast('POSM element select karo');
    if (!val('pa_br')) return toast('Brand select karo');
    if (!val('pa_cn')) return toast('Condition select karo');
    var s = Posm.store, id = uid('SA');
    var row = { Id:id, Date:Posm.day(), ClientId:String(s.ClientId || ''), CompanyCode:String(s.CompanyCode || ''),
      StoreName:s.StoreName, StoreType:s.StoreType || '', City:s.City || '', PosmStatus:'Installed',
      Element:val('pa_el'), PosmType:val('pa_ty'), Location:val('pa_lo'), Brand:val('pa_br'), AssetType:val('pa_as'),
      Period:toISO(val('pa_pd')), Dominance:val('pa_do'), Condition:val('pa_cn'), Visibility:val('pa_vi'), Action:val('pa_ac'),
      InstalledBy:val('pa_ib'), VerifiedBy:val('pa_vb'), VerifyDate:toISO(val('pa_vd')), NextReview:toISO(val('pa_nr')),
      Remarks:val('pa_rm') };
    return Busy.run('posm', el, 'Save ho raha hai…', function () {
      return DB.save('PosmAudit', row).then(function () { return Dfr.push(); }).then(function () {
        Log.add('POSM', 'Audit', id, s.StoreName);
        Posm.ans = null; Posm.store = null;
        Cam.clear(['posm1','posm2','posm_x']);
        Nav.build(); render();
        toast('POSM audit save — next store karo');
      });
    });
  },
  reqHtml: function () {
    return '<div class="card"><h3><span class="ic"></span>POSM requirement</h3>' +
      '<label class="f">Kya POSM chahiye? <span class="req">*</span></label>' +
      '<select class="in" id="pr_need" onchange="Posm.need=this.value;render()">' +
        ['Yes','No'].map(function (o) { return '<option value="' + o + '"' + (Posm.need === o ? ' selected' : '') + '>' + o + '</option>'; }).join('') +
      '</select>' +
      /* ── Yes: the same questionnaire the audit uses, in the previous app's words, plus what the
         store is worth — a POSM request is a spend decision, and whoever approves it needs the
         element, where it goes, for which brand, and how much the shop actually sells.
         "No" means there is nothing to ask about: all of it disappears and only the reason stays. */
      (Posm.need === 'No' ? '' : Posm.reqFields()) +
      '<label class="f">Remarks <span class="req">*</span></label><textarea class="in" id="pr_rm" rows="2" placeholder="' +
        (Posm.need === 'No' ? 'Kyun zaroorat nahi hai' : 'Kyun chahiye / store ka kya kehna hai') + '"></textarea>' +
      Posm.reqPhotos() +
      '<div class="banner w" id="pr_need_note" style="margin-top:10px;display:' + (Posm.reqReady() ? 'none' : '') + '">' +
        '<span></span><div><b>' + (Posm.need === 'No' ? 'Poore shop ka photo lo' : 'Shelf ka photo lo') +
        '</b><br><span style="font-weight:500">Ye compulsory hai — tabhi save hoga.</span></div></div>' +
      '<div class="btns"><button class="btn" id="pr_save" onclick="Posm.saveReq(this)"' + (Posm.reqReady() ? '' : ' disabled') +
        '> Requirement save karo</button>' +
      '<button class="btn ghost" onclick="Posm.ans=null;render()"> Wapas</button></div></div>';
  },
  /* the requirement questionnaire — same option lists as the store audit, so the two describe the
     same world, and the same numbering the previous app used */
  reqFields: function () {
    var S = { El:['Wobbler','Shelf Strip','Dangler','Poster','Standee','FSU','CTU','Vinyl','Glow Sign','Other'],
      Ty:['Soft POSM','Hard Asset'], Lo:['Brand Block','Category Block','Both'],
      Br:['Mamaearth','The Derma Co.','BBlunt','Aqualogica',"Dr. Sheth's",'ME Color Care'],
      As:['FSU','CTU','Shelf Unit','Display Rack','Gondola','Counter Display','Wall Unit'],
      Do:['Board Branding','Light Branding','Header','Fixture Branding','Wall Branding','Pillar','Window'] };
    var sel = function (id, arr, lbl, req) {
      return '<div><label class="f">' + lbl + (req ? ' <span class="req">*</span>' : '') +
        '</label><select class="in" id="' + id + '">' + '<option value="">— Select —</option>' +
        arr.map(function (o) { return '<option value="' + esc(o) + '">' + esc(o) + '</option>'; }).join('') +
        '</select></div>'; };
    return '<div class="row two">' + sel('pr_el', S.El, 'Kaunsa element', 1) + sel('pr_ty', S.Ty, 'POSM type') + '</div>' +
      '<div class="row two">' + sel('pr_lo', S.Lo, 'Kahan lagana hai') + sel('pr_br', S.Br, 'Honasa brand', 1) + '</div>' +
      '<div class="row two">' + sel('pr_as', S.As, 'Asset type') + sel('pr_do', S.Do, 'Branding chahiye') + '</div>' +
      '<div class="row two"><div><label class="f">Kitne chahiye</label>' +
        '<input class="in" id="pr_qty" type="number" min="1" value="1"></div>' +
        '<div><label class="f">Store ka monthly income ₹</label>' +
        '<input class="in" id="pr_inc" type="number" inputmode="numeric" placeholder="e.g. 250000"></div></div>' +
      '<div class="row two"><div><label class="f">Store ka daily sale ₹</label>' +
        '<input class="in" id="pr_day" type="number" inputmode="numeric" placeholder="e.g. 8000"></div>' +
        '<div><label class="f">Kab tak chahiye</label><input class="in" id="pr_by" type="date"></div></div>';
  },
  reqReady: function () { return Bypass.on() || Cam.ok(Posm.need === 'No' ? 'shop' : 'shelf'); },
  saveReq: function (el) {
    if (Busy.busy('posm')) return toast('Ruko — save ho raha hai');
    if (!val('pr_rm')) return toast('Remarks likho');
    if (!Posm.reqReady()) return toast(Posm.need === 'No' ? 'Poore shop ka photo compulsory hai'
                                                         : 'Shelf ka photo compulsory hai');
    /* a request without an element or a brand cannot be acted on by anyone downstream */
    if (Posm.need !== 'No') {
      if (!val('pr_el')) return toast('Kaunsa element chahiye — select karo');
      if (!val('pr_br')) return toast('Honasa brand select karo');
    }
    var s = Posm.store, id = uid('REQ'), yes = Posm.need !== 'No';
    var row = { Id:id, Date:Posm.day(), ClientId:String(s.ClientId || ''), CompanyCode:String(s.CompanyCode || ''),
      StoreName:s.StoreName, StoreType:s.StoreType || '', City:s.City || '', Requirement:val('pr_need'),
      /* nothing was asked when nothing is needed, so nothing is recorded for it */
      Element:yes ? val('pr_el') : '', PosmType:yes ? val('pr_ty') : '', Location:yes ? val('pr_lo') : '',
      Brand:yes ? val('pr_br') : '', AssetType:yes ? val('pr_as') : '', Dominance:yes ? val('pr_do') : '',
      Qty:yes ? num(val('pr_qty')) : '', MonthlyIncome:yes ? num(val('pr_inc')) : '',
      DaySale:yes ? num(val('pr_day')) : '', NeededBy:yes ? val('pr_by') : '',
      Remarks:val('pr_rm') };
    return Busy.run('posm', el, 'Save ho raha hai…', function () {
      return DB.save('PosmRequirement', row).then(function () { return Dfr.push(); }).then(function () {
        Log.add('POSM', 'Requirement', id, s.StoreName);
        Posm.ans = null; Posm.store = null;
        Cam.clear(['shop','shelf','req_x']);
        Nav.build(); render();
        toast('Requirement save — next store karo');
      });
    });
  },
  closeDay: function () {
    var t = today();
    var n = DB.mine('SecOrders').filter(function (r) { return toISO(r.Date) === t; }).length;
    UI.confirm({ icon:'', title:'Aaj ka din close karein?',
      msg:'Aaj <b>' + n + ' store</b> ka kaam save hua hai.<br>Close karne ke baad naya order / POSM save nahi hoga \u2014 lekin zaroorat pade to din dobara khol sakte ho.',
      ok:'Haan, close karo', cancel:'Abhi nahi' }).then(function (go) {
      if (!go) return;
      Gate.lock('closeday'); Log.add('Day', 'Closed', t, '');
      Router.go('eod'); toast(' Din close \u2014 EOD save karo');
    });
  }
};

/* ═══════════════ EOD ═══════════════ */
var Eod = {
  agg: function () {
    var t = today(), code = DB.me.code;
    var ord = DB.mine('SecOrders').filter(function (r) { return toISO(r.Date) === t; });
    var lines = DB.mine('SecOrderLines').filter(function (r) { return toISO(r.Date) === t; });
    var ns = DB.mine('NewStores').filter(function (r) { return toISO(r.Date) === t; });
    var pa = DB.mine('PosmAudit').filter(function (r) { return toISO(r.Date) === t; });
    var pr = DB.mine('PosmRequirement').filter(function (r) { return toISO(r.Date) === t; });
    var plan = DB.find('DayPlan', code + '_' + t) || {};
    var withOrd = ord.filter(function (o) { return num(o.TotUnits) > 0; });
    var brand = {};
    lines.forEach(function (l) { var b = l.Brand || 'Other'; brand[b] = (brand[b] || 0) + num(l.NsvLakh); });
    var msl = lines.filter(function (l) { return /^msl$/i.test(String(l.MslStatus || '')); }).length;
    /* everything punched that is NOT an MSL line. Derived, never stored — MSL + non-MSL is always the
       whole line count, so a separate sheet column could only ever go out of step with it. */
    var nonMsl = lines.length - msl;
    return { t:t, plan:plan, ord:ord, lines:lines, ns:ns, pa:pa, pr:pr, withOrd:withOrd, brand:brand,
      msl:msl, nonMsl:nonMsl,
      sc:num(plan.ScTarget) || 7, tc:ord.length, pc:withOrd.length,
      tele:ord.filter(function (o) { return o.Source === 'Telephonic Call'; }).length,
      value:ord.reduce(function (a, o) { return a + num(o.TotValue); }, 0),
      nsv:ord.reduce(function (a, o) { return a + num(o.TotNsvLakh); }, 0) };
  },
  html: function () {
    var a = Eod.agg(), saved = DB.find('Eod', DB.me.code + '_' + a.t);
    var h = UI.head('', 'EOD — din close karo', 'Sab figures automatic hain. Check karke save karo, phir report bhejo.');
    if (Gate.locked()) h += '<div class="banner g"><span></span><div><b>Din close ho gaya</b>' +
      (Store.get(K.lock, {}).at ? ' (' + esc(Store.get(K.lock, {}).at) + ')' : '') +
      '.<div class="btns"><button class="btn sm ghost" onclick="Field.reopen()"> Dobara kholo</button></div></div></div>';

    h += '<div class="kpis">' + UI.kpi(a.tc + ' / ' + a.sc, 'TC / SC', a.tc >= a.sc ? 'g' : 'w') +
      UI.kpi(a.pc, 'PC', 'g') + UI.kpi(lakh(a.nsv), 'NSV ₹L', 'b') + UI.kpi(a.ns.length, 'Naye outlet', 'w') + '</div>';
    h += '<div class="kpis" style="margin-top:10px">' + UI.kpi(a.pa.length, 'POSM audit', '') +
      UI.kpi(a.pr.length, 'POSM req', '') + UI.kpi(a.msl, 'MSL lines', '') +
      UI.kpi(a.nonMsl, 'Non-MSL lines', '') + UI.kpi(inr(a.value), 'MRP value', 'b') +
      UI.kpi(a.tele, 'Telephonic calls', '') + '</div>';

    /* ONE brand table, not two — it used to be a plain generic KPI loop here AND a duplicated (twice!)
       "Brand-wise" section below it, all three built the same target-vs-achieved shape. brandRows()
       already carries every brand from the plan even at zero achievement (that IS the point of the
       report — a zero against a target must never be hidden), and already dedupes the TDC credit
       across its 6 sub-rows, which the old inline loop here did not. */
    h += '<div class="sec-title">Target vs Achievement (₹ Lakh)</div><div class="card">' +
      Eod.brandRows(a).html + '</div>';

    h += '<div class="sec-title">Order status</div><div class="card">' +
      ['Billing Done','Order in Process','Cancel Order'].map(function (s) {
        var g = a.ord.filter(function (o) { return o.Status === s; });
        var gv = g.reduce(function (x, o) { return x + num(o.TotValue); }, 0);
        var gn = g.reduce(function (x, o) { return x + num(o.TotNsvLakh); }, 0);
        return '<div class="lrow"><div class="m"><div class="t">' + s + '</div><div class="s">' + g.length +
          ' store · MRP value ' + inr(gv) + ' · NSV ' + lakh(gn) + 'L</div></div>' +
          '<span class="pill ' + (s === 'Billing Done' ? 'p-ok' : s === 'Order in Process' ? 'p-warn' : 'p-bad') + '">' + g.length + '</span></div>'; }).join('') +
      '</div>';

    h += '<div class="card"><label class="f">Remarks (optional)</label><textarea class="in" id="eod_rm" rows="2">' +
      esc(saved ? saved.Remarks || '' : '') + '</textarea>' +
      '<div class="btns"><button class="btn" onclick="Eod.save(this)"> EOD save &amp; din close</button></div>' +
      (saved ? '<div class="hint" style="margin-top:8px">Last save: ' + esc(saved.ClosedAt || saved.Ts || '') + '</div>' : '') + '</div>';

    /* ── the EOD image ──
       Same card as the morning one, with the day's real numbers. It is the report a manager actually
       reads on WhatsApp, so it carries the detail the Excel carries, and it cannot be edited.
       Gated behind an actual close: the image is only drawn — and WhatsApp / mail / Excel only become
       tappable — once EOD is saved. Before that the numbers can still change with the next tap, and a
       report sent off a live draft is worse than no report at all. */
    h += Gate.locked() ?
      '<div class="card"><h3>Din ka report — WhatsApp image</h3>' +
      '<div class="sub">Subah wali card ki tarah, lekin aaj ke poore numbers ke saath. Text nahi, image jaati hai.</div>' +
      '<div id="eod_card" style="margin-top:12px"><div class="skel" style="height:180px;border-radius:12px"></div></div>' +
      '<div class="btns two"><button class="btn ok two" onclick="Card.sendEod(this)">WhatsApp par image bhejo' +
        '<span class="who">HOD · ZM · RSM · ASM</span></button>' +
      '<button class="btn ghost" onclick="Card.zoom(\'eod\')">Review</button></div>' +
      '<div class="btns"><button class="btn ghost sm" onclick="Eod.mail()">Send on mail</button>' +
      '<button class="btn ghost sm" onclick="Eod.excel()">Excel</button></div></div>'
      : '<div class="card"><h3>Din ka report — WhatsApp image</h3>' +
      '<div class="hint">EOD save karke din close karo — tabhi report ki image aur WhatsApp / mail / Excel access milega.</div></div>';
    return h;
  },
  after: function () { if (Gate.locked()) Card.preview('eod'); },
  /* ONE brand-wise builder for the screen, the image and the workbook, so the three can never
     disagree about a brand's target or its achievement. */
  brandRows: function (a) {
    var tgt = Plan.tgt(), rows = [], tT = 0, tA = 0;
    tgt.forEach(function (x) {
      var got = 0;
      Object.keys(a.brand).forEach(function (b) { if (Eod.match(b, x[0])) got += num(a.brand[b]); });
      /* a TDC target row is one of six slices of the same brand, so the achievement cannot be split
         across them — it is credited to the whole TDC group once, on the first TDC row */
      rows.push([x[0], num(x[1]), got]);
      tT += num(x[1]);
    });
    /* de-duplicate the TDC credit: keep it on the first matching row only */
    var seen = {};
    rows.forEach(function (r) {
      var k = /^TDC/i.test(r[0]) ? 'TDC' : r[0];
      if (seen[k]) r[2] = 0; else seen[k] = 1;
      tA += r[2];
    });
    var html = '<div class="tw"><table><thead><tr><th>Brand</th><th class="num">Target</th>' +
      '<th class="num">Achieved</th><th class="num">%</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var p = r[1] > 0 ? Math.round(r[2] / r[1] * 100) : 0;
        return '<tr><td>' + esc(r[0]) + '</td><td class="num">' + lakh(r[1]) + '</td>' +
          '<td class="num">' + lakh(r[2]) + '</td><td class="num"><span class="pill ' +
          (p >= 100 ? 'p-ok' : p > 0 ? 'p-warn' : 'p-bad') + '">' + p + '%</span></td></tr>';
      }).join('') +
      '<tr class="tot"><td><b>TOTAL</b></td><td class="num"><b>' + lakh(tT) + '</b></td>' +
      '<td class="num"><b>' + lakh(tA) + '</b></td><td class="num"><b>' +
      (tT > 0 ? Math.round(tA / tT * 100) : 0) + '%</b></td></tr></tbody></table></div>';
    return { rows:rows, tT:tT, tA:tA, html:html };
  },
  match: function (brand, label) {
    var b = String(brand).toUpperCase(), l = label.toUpperCase();
    if (l.indexOf('BB') >= 0) return b.indexOf('BBLUNT') >= 0;
    if (l.indexOf('AQ') >= 0) return b.indexOf('AQUA') >= 0;
    if (l.indexOf('DRS') >= 0) return b.indexOf('SHETH') >= 0;
    if (l.indexOf('CC') >= 0) return b.indexOf('COLOR') >= 0;
    return b.indexOf('DERMA') >= 0 || b.indexOf('TDC') >= 0;   /* TDC rows */
  },
  save: function (el) {
    var a = Eod.agg();
    return Busy.run('eod_' + a.t, el, 'Save ho raha hai…', function () { return DB.save('Eod', { Id:DB.me.code + '_' + a.t, Date:a.t, Sc:a.sc, Tc:a.tc, Pc:a.pc, Nso:a.ns.length,
      PosmCount:a.pa.length, MslCount:a.msl, OrderValue:a.value, NsvLakh:+a.nsv.toFixed(4),
      BrandJson:JSON.stringify(a.brand), EodJson:JSON.stringify({ plan:a.plan, orders:a.ord.length }),
      Remarks:val('eod_rm'), ClosedAt:new Date().toLocaleTimeString('en-IN', { hour:'2-digit', minute:'2-digit' }) })
      .then(function () { return Dfr.push(); })
      .then(function () { Gate.lock('eod'); Log.add('EOD', 'Saved', a.t, a.tc + ' visits');
        render(); Nav.build(); toast('EOD save — din close ho gaya'); }); });
  },
  msg: function () {
    var a = Eod.agg(), p = a.plan;
    var L = ['*GARUDA — EOD Report*', dmy(a.t) + ' · ' + DB.me.name + ' (' + DB.me.code + ')', ''];
    L.push('Beat  : ' + (p.Town || '—') + ' / ' + (p.Beat || '—'));
    L.push('TC/SC : ' + a.tc + ' / ' + a.sc + '  (PC: ' + a.pc + ')');
    L.push('MRP value : ' + inr(a.value));
    L.push('NSV       : ₹' + lakh(a.nsv) + ' L');
    L.push('NSO       : ' + a.ns.length);
    L.push('POSM      : ' + a.pa.length + ' audit, ' + a.pr.length + ' req');
    L.push('');
    L.push('*Brand-wise NSV (₹L)*');
    Object.keys(a.brand).sort().forEach(function (b) { L.push('' + b + ' — ' + lakh(a.brand[b])); });
    L.push('');
    L.push('*Store-wise*');
    a.ord.forEach(function (o, i) { L.push((i + 1) + '. ' + o.StoreName + ' — ' + o.Status +
      (num(o.TotUnits) ? ' · ' + num(o.TotUnits) + 'u · ' + inr(o.TotValue) : '')); });
    if (a.ns.length) { L.push(''); L.push('*Naye outlet*');
      a.ns.forEach(function (n, i) { L.push((i + 1) + '. ' + n.StoreName + ' — ' + (n.Town || '')); }); }
    if (val('eod_rm')) { L.push(''); L.push('Remarks: ' + val('eod_rm')); }
    L.push(''); L.push('_Sent from GARUDA_');
    return L.join('\n');
  },
  /* "Send on mail" is a plain redirect — it opens a pre-filled Gmail compose (Share.mail) with the
     same report text the WhatsApp message used to carry, addressed to the HOD's Master_Config
     email if one is set. No backend round trip, no attachment upload: the rep still has "Excel"
     right next to it to download the workbook first if they want to attach it by hand. */
  mail: function () {
    var to = String(DB.cfg('HOD_Email_ID', '') || '').trim();
    var a = Eod.agg(), subject = 'EOD ' + dmy(a.t) + ' — ' + DB.me.name + ' (' + DB.me.code + ')';
    var body = Eod.msg().replace(/\*/g, '');
    Share.mail(subject, body, to);
  },
  excel: function () { return Rep.eod(); }
};

/* ═══════════════ SUMMARY ═══════════════ */
/* ═══════════════ TRACKER — the rep's own follow-up board ═══════════════
   Secondary orders, new outlets and POSM requirements in ONE list, with a status the EMPLOYEE owns.
   Nothing here is an approval: he rings his ASM, gets an answer, and records the stage himself — so
   HOD and Admin have no button and no say on this screen. Every change is an upsert on the SAME row
   (never a new one) and syncs like everything else, so the sheet always shows the real stage. */
var Trk = {
  kind:'ord', filter:'open',
  /* ── TAT is NOT a tab here any more ──
     "Orders stuck past their turnaround" is an ALERT, not a follow-up board of its own: it was a
     filtered view of the very rows already sitting on the Orders tab, so it said the same thing
     twice. It now lives in the Notification centre (Notif.TAT_DAYS), which is where every other
     "somebody should chase this" line already goes. */
  KINDS:[['ord', 'Orders'], ['ns', 'New outlets'], ['pq', 'POSM'], ['poi', 'PO vs Invoice']],
  TAB:{ ord:'SecOrders', ns:'NewStores', pq:'PosmRequirement' },
  /* one status list per type, in the order the work actually moves */
  ST:{
    ord:['Order in Process', 'Billing Done', 'Cancel Order'],
    ns: ['Pending', 'Sent to ASM', 'Code created', 'First billing done', 'Dropped'],
    pq: ['Pending', 'Sent to ASM', 'Approved by ASM', 'Dispatched', 'Installed', 'Rejected']
  },
  stList: function (k) { return Trk.ST[k] || Trk.ST.ord; },
  /* finished either way (drives the Open/Done filter) and finished BADLY (drives the red pill) */
  DONE:['Billing Done', 'Cancel Order', 'First billing done', 'Dropped',
        'Installed', 'Rejected'],
  BAD:['Cancel Order', 'Dropped', 'Rejected'],
  shut: function (s) { return Trk.DONE.indexOf(s) >= 0; },
  pill: function (s) { return Trk.BAD.indexOf(s) >= 0 ? 'p-bad' : Trk.shut(s) ? 'p-ok' : 'p-warn'; },
  /* a status the employee never picked (older rows, a row created before this screen existed, or a
     SHEET row still carrying the retired 'No Order' value) still has to land on a real option, or
     the dropdown would silently show the first one — 'No Order' is gone as a choice, but a row that
     already has it must read as Cancel Order, never silently reopen as 'Order in Process'. */
  st: function (k, v) {
    var s = String(v || '').trim(), list = Trk.stList(k);
    if (list.indexOf(s) >= 0) return s;
    if (/approv/i.test(s)) return k === 'pq' ? 'Approved by ASM' : k === 'ns' ? 'Code created' : list[0];
    if (/reject|declin|no.?order/i.test(s)) return k === 'ord' ? 'Cancel Order' : k === 'ns' ? 'Dropped' : 'Rejected';
    return list[0];
  },

  /* ONE reader — every type is flattened to the same shape so the list, the counts and the save path
     have no per-type branches to disagree about */
  rows: function () {
    var k = Trk.kind, out = [];
    if (k === 'ord') DB.mine('SecOrders').forEach(function (o) {
      out.push({ key:String(o.PoNumber), date:toISO(o.Date), title:o.StoreName || '',
        sub:o.PoNumber + ' · ' + num(o.TotSku) + ' SKU · ' + num(o.TotUnits) + ' units · MRP value ' + inr(o.TotValue),
        sub2:(o.Source || '') + (o.DbName ? ' · ' + o.DbName : ''),
        st:Trk.st('ord', o.Status), note:o.Remarks || '', at:o.StatusAt || o.DeliveredAt || '',
        units:num(o.TotUnits), billType:o.BillingType || '', billUnits:o.BilledUnits, billRemark:o.BillingRemark || '' });
    });
    if (k === 'ns') DB.mine('NewStores').forEach(function (r) {
      out.push({ key:String(r.StoreId), date:toISO(r.Date), title:r.StoreName || '',
        sub:r.StoreId + ' · ' + (r.Town || '—') + (r.Beat ? ' / ' + r.Beat : ''),
        sub2:(r.DbName || '') + (r.OwnerMobile ? ' · ' + r.OwnerMobile : ''),
        st:Trk.st('ns', r.Status), note:r.StatusReason || '', at:r.StatusAt || '' });
    });
    if (k === 'pq') DB.mine('PosmRequirement').forEach(function (r) {
      out.push({ key:String(r.Id), date:toISO(r.Date), title:r.StoreName || '',
        sub:(r.Element || '—') + ' · ' + (r.City || '—'),
        sub2:r.Remarks || '', st:Trk.st('pq', r.Status), note:r.StatusReason || '', at:r.StatusAt || '' });
    });
    /* open work first, then newest — a rep opens this screen to see what is still stuck */
    return out.sort(function (a, b) {
      var da = Trk.shut(a.st) ? 1 : 0, db = Trk.shut(b.st) ? 1 : 0;
      return da - db || String(b.date).localeCompare(String(a.date));
    });
  },

  /* how much OPEN work each type is carrying — read straight from the rows, so the badge on a tab is
     that tab's own number whether or not it is the one on screen */
  openCounts: function () {
    var was = Trk.kind, out = {};
    Trk.KINDS.forEach(function (c) {
      Trk.kind = c[0];
      out[c[0]] = Trk.rows().filter(function (r) { return !Trk.shut(r.st); }).length;
    });
    Trk.kind = was;
    return out;
  },
  navHtml: function () {
    /* one count per type — of its OWN open items, not of whichever tab happens to be showing.
       Outer .card div deliberately left OPEN — see call sites. */
    var openBy = Trk.openCounts();
    return '<div class="card" style="padding:10px 14px 0"><div class="tnav fit" id="tk_chips">' +
      Trk.KINDS.map(function (c) {
        var n = openBy[c[0]] || 0;
        return '<button class="' + (Trk.kind === c[0] ? 'on' : '') + '"' +
          (Trk.kind === c[0] ? ' data-on="1"' : '') + ' onclick="Trk.go(\'' + c[0] + '\')">' +
          esc(c[1]) + (n ? '<span class="bdg">' + n + '</span>' : '') + '</button>'; }).join('') + '</div>';
  },
  html: function () {
    if (Trk.kind === 'poi') return Trk.poiHtml();
    var all = Trk.rows();
    var open = all.filter(function (r) { return !Trk.shut(r.st); });
    var sub = 'Apne order, naye outlet aur POSM ka status khud update karo. Koi approval nahi — ' +
      'ASM se baat karke jo hua wahi yahan mark kar do, sheet me chala jayega.';
    var h = UI.head('', 'Tracker', sub);

    h += '<div class="kpis k3">' +
      UI.kpi(open.length, 'Open — action chahiye', open.length ? 'r' : 'g') +
      UI.kpi(all.length - open.length, 'Closed', 'g') +
      UI.kpi(all.length, 'Total', 'b') + '</div>';

    /* leaves the outer .card div open — closed right below, after the Open/Closed/All chips,
       exactly like the original single-card layout */
    h += Trk.navHtml();

    /* the number belongs on OPEN only — "Closed (12)" is a fact, not something that needs doing */
    var chips = [['open', 'Open', open.length], ['done', 'Closed', 0], ['all', 'All', 0]];
    h += '<div style="display:flex;gap:6px;margin:10px 0 4px">' + chips.map(function (c) {
      return '<button class="btn ' + (Trk.filter === c[0] ? '' : 'ghost') + ' sm" style="flex:1 1 0"' +
        ' onclick="Trk.set(\'' + c[0] + '\')">' + esc(c[1]) +
        (c[2] ? ' <span class="bdg">' + c[2] + '</span>' : '') + '</button>'; }).join('') + '</div></div>';

    var show = all.filter(function (r) {
      return Trk.filter === 'all' || (Trk.filter === 'open' ? !Trk.shut(r.st) : Trk.shut(r.st)); });
    if (!show.length) return h + '<div class="card">' +
      UI.empty('', all.length ? 'Is filter me kuch nahi hai' : 'Abhi is type ka kuch nahi bhara') + '</div>';

    h += '<div class="sec-title">' + show.length + ' item' + (show.length > 1 ? 's' : '') + '</div>';
    h += show.slice(0, 80).map(Trk.card).join('');
    if (show.length > 80) h += '<div class="hint">Sirf pehle 80 dikha rahe hain — filter use karo.</div>';
    h += '<div class="card"><div class="btns">' +
      '<button class="btn ghost" id="tk_sync" onclick="Sync.now(true,this)">Sync</button></div></div>';
    return h;
  },
  after: function () {
    var s = $('tk_chips'); if (!s) return;
    s.classList.toggle('fit', s.scrollWidth <= s.clientWidth + 2);
  },

  /* transient UI choice for the Full/Partial toggle — a tap must reveal the Partial fields (or
     save Full instantly) without waiting on a full save round trip first */
  billSel:{},
  card: function (r) {
    var k = Trk.kind, q = Appr.q(r.key), id = Appr.jid(r.key);
    var h = '<div class="card">' +
      '<div class="lrow" style="padding-top:0"><div class="m">' +
        '<div class="t">' + esc(r.title) + '</div>' +
        '<div class="s">' + dmy(r.date) + ' · ' + esc(r.sub) + '</div>' +
        (r.sub2 ? '<div class="s">' + esc(r.sub2) + '</div>' : '') + '</div>' +
      '<span class="pill ' + Trk.pill(r.st) + '">' + esc(r.st) + '</span></div>' +
      '<label class="f">Status</label>' +
      '<select class="in" onchange="Trk.setSt(\'' + q + '\',this.value)">' +
        Trk.stList(k).map(function (s) {
          return '<option value="' + esc(s) + '"' + (s === r.st ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join('') +
      '</select>' +
      /* Full vs Partial only ever means something once the order is actually billed */
      (r.st === 'Billing Done' ? Trk.billingHtml(r, id, q) : '') +
      '<label class="f">Note — ASM ne kya kaha</label>' +
      '<div style="display:flex;gap:6px;align-items:center">' +
      '<input class="in" style="flex:1 1 0;min-width:0" id="tk_n_' + id + '" value="' + esc(r.note) + '" placeholder="Follow-up note">' +
      '<button class="btn ghost sm" style="flex:0 0 auto" onclick="Trk.setNote(\'' + q + '\',\'' + id + '\',this)">Save</button></div>' +
      (r.at ? '<div class="hint" style="margin-top:6px">Updated ' + esc(Appr.when(r.at)) + '</div>' : '') +
      '</div>';
    return h;
  },
  /* order is 20, distributor could only bill 10 — Full means the whole PO was invoiced (one tap,
     saves immediately, nothing else to fill); Partial demands the actual invoiced qty AND a reason
     before it can be saved, because "some of it" with no explanation is not a usable record. */
  billingHtml: function (r, id, q) {
    var type = Trk.billSel[r.key] !== undefined ? Trk.billSel[r.key] : (r.billType || 'Full');
    return '<div style="margin:10px 0;padding-top:10px;border-top:1px dashed var(--line)">' +
      '<label class="f">Billing — poora ya partial?</label>' +
      '<div class="seg"><button type="button" class="' + (type === 'Full' ? 'on' : '') +
        '" onclick="Trk.setBillType(\'' + q + '\',\'Full\')">Full</button>' +
      '<button type="button" class="' + (type === 'Partial' ? 'on' : '') +
        '" onclick="Trk.setBillType(\'' + q + '\',\'Partial\')">Partial</button></div>' +
      (type === 'Partial'
        ? '<div class="row two" style="margin-top:8px">' +
            '<div><label class="f">Invoiced units <span class="req">*</span></label>' +
            '<input class="in" id="tk_bu_' + id + '" type="number" min="0" value="' +
              (r.billUnits !== undefined && r.billUnits !== '' && r.billUnits !== null ? num(r.billUnits) : '') + '"></div>' +
            '<div><label class="f">PO units</label><input class="in lk" readonly value="' + r.units + '"></div></div>' +
          '<label class="f">Reason <span class="req">*</span></label>' +
          '<input class="in" id="tk_br_' + id + '" value="' + esc(r.billRemark || '') +
            '" placeholder="e.g. distributor ke paas 10 hi units the">' +
          '<div class="btns" style="margin-top:8px"><button class="btn ok sm" ' +
            'onclick="Trk.saveBilling(\'' + q + '\',\'' + id + '\',this)">Partial billing save karo</button></div>'
        : (r.billType === 'Full' ? '<div class="hint" style="margin-top:6px">Poora order (' + r.units +
            ' units) invoice ho gaya maana gaya hai.</div>' : '')) +
      '</div>';
  },
  setBillType: function (key, t) {
    Trk.billSel[key] = t;
    if (t === 'Full') {
      Sec.setBilling(key, 'Full').then(function () { render(); toast('Full billing mark ho gaya'); });
      return;
    }
    render();
  },
  saveBilling: function (key, id, el) {
    var u = val('tk_bu_' + id), rm = val('tk_br_' + id);
    if (!u || num(u) <= 0) return toast('Invoiced units bharo');
    if (!rm) return toast('Partial billing ka reason likhna zaroori hai');
    Busy.run('tkbill_' + id, el, 'Save…', function () {
      return Sec.setBilling(key, 'Partial', u, rm).then(function () {
        delete Trk.billSel[key];
        Log.add('Tracker', 'Partial billing', key, u + ' units — ' + rm);
        render(); toast('Partial billing save ho gaya');
      });
    });
  },

  /* ── the only writer for status — Cancel Order asks for a reason FIRST, and only commits once
     one is given; the <select> is reverted (via render()) if the rep backs out of the dialog */
  setSt: function (key, s) {
    var k = Trk.kind, now = new Date().toISOString();
    if (k === 'ord' && s === 'Cancel Order') {
      return UI.prompt({ icon:'', title:'Order cancel karna hai?', danger:true,
        msg:'Reason likhna zaroori hai — ASM aur HOD dono ko yehi dikhega.',
        label:'Cancel karne ka reason', placeholder:'e.g. shop band tha, stock nahi chahiye…',
        multiline:true, required:true, requiredMsg:'Reason likhna zaroori hai', ok:'Cancel karo'
      }).then(function (reason) {
        if (!reason) { render(); return; }
        return Sec.setStatus(key, s).then(function () { return Sec.setField(key, 'Remarks', reason); })
          .then(function () { render(); toast('Order cancel ho gaya'); });
      });
    }
    if (k === 'ord') return Sec.setStatus(key, s);
    var tab = Trk.TAB[k], r = DB.find(tab, key);
    if (!r) return toast('Ye row nahi mili — Sync karo');
    DB.save(tab, Object.assign({}, r, { Status:s, StatusAt:now })).then(function () {
      Log.add('Tracker', 'Status ' + s, key, k);
      render(); toast('Status: ' + s);
    });
  },
  setNote: function (key, id, el) {
    var k = Trk.kind, box = $('tk_n_' + id), v = box ? box.value : '';
    if (k === 'ord') { Sec.setField(key, 'Remarks', v); return toast('Note save ho gaya'); }
    var tab = Trk.TAB[k], r = DB.find(tab, key);
    if (!r) return toast('Ye row nahi mili — Sync karo');
    Busy.run('tk_' + id, el, 'Save…', function () {
      return DB.save(tab, Object.assign({}, r, { StatusReason:v, StatusAt:new Date().toISOString() }))
        .then(function () { Log.add('Tracker', 'Note', key, k); render(); toast('Note save ho gaya'); });
    });
  },
  go: function (k) { Trk.kind = k; render(); },
  set: function (f) { Trk.filter = f; render(); },

  /* ── PO vs Invoice Generated — ordered units against what was actually billed, side by side.
     Cancel Order is excluded: nothing was ever meant to be invoiced there, so it is not a "gap".
     Every block OPENS: a rep who sees "gap 8" immediately wants to know which SKUs, which
     distributor and what reason was recorded — poiDetail() puts all of it under the row rather
     than sending him to another tab to look the same order up again. */
  poiOpen:{},
  poiToggle: function (po) { Trk.poiOpen[po] = !Trk.poiOpen[po]; render(); },
  poiRows: function () {
    return DB.mine('SecOrders').filter(function (o) {
      return num(o.TotUnits) > 0 && o.Status !== 'Cancel Order';
    }).map(function (o) {
      var billed = o.BillingType ? num(o.BilledUnits) : (o.Status === 'Billing Done' ? num(o.TotUnits) : 0);
      return { po:String(o.PoNumber), store:o.StoreName, date:o.Date, poUnits:num(o.TotUnits), billed:billed,
        status:o.Status, type:o.BillingType || '', row:o };
    }).sort(function (a, b) { return String(b.date).localeCompare(String(a.date)); });
  },
  poiHtml: function () {
    var rows = Trk.poiRows();
    var h = UI.head('', 'Tracker', 'PO me kitna order tha, uske against kitna invoice bana — dono side by side. ' +
      'Kisi bhi order par tap karo, poori detail khul jayegi.');
    var totPo = 0, totBill = 0, gaps = 0;
    rows.forEach(function (r) { totPo += r.poUnits; totBill += r.billed; if (r.poUnits - r.billed > 0) gaps++; });
    h += '<div class="kpis k3">' + UI.kpi(totPo, 'PO units', 'b') + UI.kpi(totBill, 'Invoiced units', 'g') +
      UI.kpi(totPo ? Math.round(totBill / totPo * 100) + '%' : '—', 'Fill rate', '') + '</div>';
    h += Trk.navHtml() + '</div>';
    if (!rows.length) return h + '<div class="card">' + UI.empty('', 'Abhi koi order nahi') + '</div>';
    h += '<div class="sec-title">' + rows.length + ' order' +
      (gaps ? ' · ' + gaps + ' me gap hai' : '') + '</div>';
    h += rows.map(Trk.poiCard).join('');
    return h;
  },
  /* one order = one tappable block. Closed it is the same four numbers the table carried; open it is
     everything the sheet knows about that PO. */
  poiCard: function (r) {
    var gap = r.poUnits - r.billed, op = !!Trk.poiOpen[r.po];
    var pill = gap > 0 ? '<span class="pill p-warn">Gap ' + gap + '</span>'
      : r.billed > 0 ? '<span class="pill p-ok">Poora invoice</span>'
      : '<span class="pill p-grey">Invoice baaki</span>';
    var h = '<div class="card ap k-ord' + (op ? ' op' : '') + '" onclick="Trk.poiToggle(\'' +
        Appr.q(r.po) + '\')">' +
      '<div class="ap-h"><div class="m">' +
        '<div class="t">' + esc(r.store || '—') + '</div>' +
        '<div class="s">' + esc(r.po) + ' · ' + dmy(r.date) +
          (r.type ? ' · ' + esc(r.type) : '') + '</div>' +
        '<div class="sum">PO ' + r.poUnits + ' units · invoice ' + r.billed + ' units' +
          (r.poUnits ? ' · ' + Math.round(r.billed / r.poUnits * 100) + '%' : '') + '</div>' +
      '</div>' + pill + '<span class="ap-x">' + (op ? '▴' : '▾') + '</span></div>';
    if (op) h += '<div onclick="event.stopPropagation()">' + Trk.poiDetail(r) + '</div>';
    return h + '</div>';
  },
  /* the whole record of one PO: the order as punched, the invoice as recorded, and the SKU lines.
     Read straight from the SecOrders row, so it can never drift from what the sheet holds. */
  poiDetail: function (r) {
    var o = r.row, gap = r.poUnits - r.billed;
    var lines = [];
    try { lines = JSON.parse(o.LinesJson || '[]') || []; } catch (e) {}
    if (!lines.length) lines = DB.rows('SecOrderLines').filter(function (l) {
      return String(l.PoNumber) === r.po; });

    var h = '<div class="sec-title" style="margin-top:12px">Order — jaisa punch hua</div>' +
      '<table class="ap-t">' +
      '<tr><td>PO number</td><td><b>' + esc(r.po) + '</b></td></tr>' +
      '<tr><td>Store</td><td><b>' + esc(o.StoreName || '—') + '</b></td></tr>' +
      '<tr><td>Store code / city</td><td><b>' + esc(o.CompanyCode || '—') + ' · ' + esc(o.City || '—') + '</b></td></tr>' +
      '<tr><td>Distributor</td><td><b>' + esc(o.DbName || '—') + '</b></td></tr>' +
      '<tr><td>Order date</td><td><b>' + dmy(o.Date) + '</b></td></tr>' +
      '<tr><td>Visit type</td><td><b>' + esc(o.Source || '—') + '</b></td></tr>' +
      '<tr><td>SKU / units</td><td><b>' + num(o.TotSku) + ' SKU · ' + r.poUnits + ' units</b></td></tr>' +
      '<tr><td>MRP value</td><td><b>' + inr(o.TotValue) + '</b></td></tr>' +
      '<tr><td>NSV</td><td><b>' + lakh(o.TotNsvLakh) + ' L</b></td></tr>' +
      (o.Remarks ? '<tr><td>Remarks</td><td><b>' + esc(o.Remarks) + '</b></td></tr>' : '') +
      '</table>';

    /* the invoice half — only ever meaningful once billing was actually marked */
    h += '<div class="sec-title" style="margin-top:12px">Invoice — jo actually bana</div>';
    if (!r.type && r.status !== 'Billing Done') {
      h += '<div class="banner b"><span></span><div><b>Invoice abhi nahi bana</b><br>' +
        '<span style="font-weight:500">Order abhi "' + esc(o.Status || '—') + '" par hai. Orders tab me ' +
        'billing mark karoge to poori detail yahan aa jayegi.</span></div></div>';
    } else {
      var pct = r.poUnits ? Math.round(r.billed / r.poUnits * 100) : 0;
      var unitVal = r.poUnits ? num(o.TotValue) / r.poUnits : 0;
      h += '<table class="ap-t">' +
        '<tr><td>Billing type</td><td><b>' + esc(r.type || 'Full') + '</b></td></tr>' +
        '<tr><td>Order status</td><td><b>' + esc(o.Status || '—') + '</b></td></tr>' +
        '<tr><td>PO units</td><td><b>' + r.poUnits + '</b></td></tr>' +
        '<tr><td>Invoiced units</td><td><b>' + r.billed + '</b></td></tr>' +
        '<tr><td>Gap</td><td><b>' + (gap > 0 ? gap + ' units short' : 'Koi gap nahi') + '</b></td></tr>' +
        '<tr><td>Fill rate</td><td><b>' + pct + '%</b></td></tr>' +
        '<tr><td>Invoice value (approx)</td><td><b>' + inr(Math.round(unitVal * r.billed)) +
          '</b><div class="hint">PO ke average unit rate se nikala hua</div></td></tr>' +
        (gap > 0 ? '<tr><td>Bina invoice ka value</td><td><b>' + inr(Math.round(unitVal * gap)) + '</b></td></tr>' : '') +
        (o.BillingRemark ? '<tr><td>Partial ka reason</td><td><b>' + esc(o.BillingRemark) + '</b></td></tr>' : '') +
        '<tr><td>Billing mark hua</td><td><b>' + (Appr.when(o.StatusAt || o.DeliveredAt) || '—') + '</b></td></tr>' +
        '</table>';
    }

    if (!lines.length) return h + '<div class="hint" style="margin-top:8px">Is order ki SKU lines abhi ' +
      'local me nahi hain — Sync karo.</div>';

    /* per-SKU, with the same proportional split applied so a partial invoice reads line by line too */
    var ratio = r.poUnits ? r.billed / r.poUnits : 0;
    var u = 0, v = 0, nsv = 0;
    lines.forEach(function (l) { u += num(l.Units); v += num(l.Value); nsv += num(l.NsvLakh); });
    h += '<div class="sec-title" style="margin-top:12px">' + lines.length + ' SKU</div>' +
      '<div class="tw"><table><thead><tr><th>SKU</th><th class="num">MRP</th>' +
      '<th class="num">PO qty</th><th class="num">Invoiced</th><th class="num">MRP value</th>' +
      '<th class="num">NSV ₹L</th></tr></thead><tbody>' +
      lines.map(function (l) {
        var q = num(l.Units), b = Math.round(q * ratio);
        return '<tr><td><b class="nm">' + esc(l.SkuName || l.Sku || '—') + '</b>' +
          '<div class="hint">' + esc(l.Brand || '') + (l.Category ? ' · ' + esc(l.Category) : '') +
          (l.MslStatus ? ' · ' + esc(l.MslStatus) : '') + '</div></td>' +
          '<td class="num">' + inr(l.Mrp) + '</td>' +
          '<td class="num">' + q + '</td>' +
          '<td class="num">' + b + '</td>' +
          '<td class="num">' + inr(l.Value) + '</td>' +
          '<td class="num">' + lakh(l.NsvLakh) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td><b>TOTAL</b></td><td></td><td class="num"><b>' + u + '</b></td>' +
      '<td class="num"><b>' + r.billed + '</b></td><td class="num"><b>' + inr(v) + '</b></td>' +
      '<td class="num"><b>' + lakh(nsv) + '</b></td></tr></tbody></table></div>';
    if (ratio > 0 && ratio < 1) h += '<div class="hint" style="margin-top:6px">Partial billing me ' +
      'per-SKU invoiced qty proportion se nikali gayi hai — exact SKU-wise invoice distributor ke paas hai.</div>';
    h += '<div class="btns"><button class="btn ghost sm" onclick="Trk.go(\'ord\')">Orders tab me kholo</button></div>';
    return h;
  }
};

/* ═══════════════ NOTIFICATION CENTRE — everything that is asking for attention ═══════════════
   Three screens already answer "what did I ask for and what came back" (Approvals), "what am I
   chasing" (Tracker) and "what is due today" (the hero card). None of them ever SAYS anything: they
   all wait to be opened. So the things with nobody to raise them — an order sitting at "Order in
   Process" for ten days, a POSM requirement the ASM never moved, a new outlet with no code, a PO
   half invoiced, the PJP window about to shut — were invisible until somebody went looking.

   This is that missing voice. Every line is DERIVED from data the app already holds, so there is no
   new sheet, no push service and nothing to keep in sync: open the tab and the alerts are recomputed
   from SecOrders / NewStores / PosmRequirement / PjpDraft / Deviation / TaDa exactly as they stand.
   The only stored state is which ids the reader has already seen, in localStorage per employee — a
   read receipt is personal, and it must survive a sync that rewrites every row underneath it.

   HOD-pushed Notify rows are folded in as well, and marking one read here closes it on the sheet
   too, so this screen and the Approvals feed can never disagree about what has been seen. */
var Notif = {
  kindF:'all', filter:'unread', open:{},

  /* the ages at which "still open" becomes "somebody should chase this" */
  TAT_DAYS:7,        /* an order still at "Order in Process" this long needs an ASM nudge */
  NS_DAYS:7,         /* a new outlet with no code after a week */
  PQ_DAYS:7,         /* a POSM requirement the ASM has not moved */
  DEV_DAYS:1,        /* a plan change is a SAME-DAY decision — a day old is already late */
  PJP_DAYS:2,
  FRESH_DAYS:30,     /* a decision older than this is history, not news */

  KINDS:[['TAT', 'TAT — order atka hai'], ['Billing', 'Billing / invoice'],
         ['New outlet', 'Naya outlet'], ['POSM', 'POSM'], ['PJP', 'PJP'],
         ['Plan change', 'Plan change'], ['TA/DA', 'TA/DA'], ['Update', 'HOD update']],
  KCLS:{ 'TAT':'k-ord', 'Billing':'k-ord', 'New outlet':'k-plan', 'POSM':'k-plan',
         'PJP':'k-pjp', 'Plan change':'k-plan', 'TA/DA':'k-tada', 'Update':'k-pjp' },
  kcls: function (k) { return Notif.KCLS[k] || 'k-pjp'; },
  /* how loud, not what kind — red is "you are late", amber is "look at this", the rest is news */
  SEV:{ bad:['Zaroori', 'p-bad'], warn:['Dekho', 'p-warn'], ok:['Ho gaya', 'p-ok'],
        info:['Update', 'p-blue'] },
  RANK:{ bad:0, warn:1, info:2, ok:3 },
  /* only red and amber are WORK — an approval that came through is news, not a to-do */
  todo: function (o) { return !o.read && (o.sev === 'bad' || o.sev === 'warn'); },

  /* ── read receipts, per employee, on this device ──
     Keyed by employee code because a shared phone in a market is normal, and one rep dismissing his
     own alerts must not silence the next person who logs in. */
  rkey: function () { return K.ntf + '_' + ((DB.me && DB.me.code) || 'x'); },
  read: function () { return Store.get(Notif.rkey(), {}) || {}; },
  days: function (t) { return t ? Math.floor((Date.now() - t) / 86400000) : 0; },
  fresh: function (t) { return !!t && Notif.days(t) <= Notif.FRESH_DAYS; },

  /* ── the feed ──
     One pass per source, each pushing the SAME shape: id (stable, so a read receipt sticks), kind,
     severity, one-line title, one-line summary, the rows behind it, and where to go about it. */
  list: function () {
    var rd = Notif.read(), out = [];
    var add = function (o) { o.read = !!rd[o.id]; o.t = o.t || 0; out.push(o); };

    /* ══ 1. TAT — orders that never turned into an invoice ══ */
    DB.mine('SecOrders').forEach(function (o) {
      if (String(o.Status || '') !== 'Order in Process') return;
      var t = Appr.ts(o.Ts) || Appr.ts(o.Date), d = Notif.days(t);
      if (d <= Notif.TAT_DAYS) return;
      add({ id:'tat_' + Appr.jid(o.PoNumber), kind:'TAT', sev:d > Notif.TAT_DAYS * 2 ? 'bad' : 'warn', t:t,
        title:(o.StoreName || 'Order') + ' — ' + d + ' din se pending',
        sum:'PO abhi tak "Order in Process" hai — ' + num(o.TotUnits) + ' units · ' + inr(o.TotValue) +
          '. ASM ko nudge karo.',
        rows:[['PO', String(o.PoNumber || '—')], ['Store', o.StoreName || '—'],
              ['Distributor', o.DbName || '—'], ['Order date', dmy(o.Date)],
              ['Kitne din se', d + ' din'],
              ['SKU / units', num(o.TotSku) + ' / ' + num(o.TotUnits)],
              ['MRP value', inr(o.TotValue)],
              ['Aakhri note', o.Remarks || '—']],
        go:['trk', 'ord', 'Tracker me status update karo'] });
    });

    /* ══ 2. BILLING — the PO vs invoice gap, and the invoice that did land ══ */
    DB.mine('SecOrders').forEach(function (o) {
      if (String(o.Status || '') === 'Cancel Order' || !num(o.TotUnits)) return;
      var po = num(o.TotUnits);
      var billed = o.BillingType ? num(o.BilledUnits) : (o.Status === 'Billing Done' ? po : 0);
      var t = Appr.ts(o.StatusAt) || Appr.ts(o.DeliveredAt) || Appr.ts(o.Ts) || Appr.ts(o.Date);
      if (String(o.BillingType || '') === 'Partial' && po - billed > 0) {
        add({ id:'gap_' + Appr.jid(o.PoNumber), kind:'Billing', sev:'warn', t:t,
          title:(o.StoreName || 'Order') + ' — ' + (po - billed) + ' units invoice nahi hue',
          sum:'Partial billing: ' + billed + ' / ' + po + ' units bane' +
            (o.BillingRemark ? ' — ' + o.BillingRemark : ''),
          rows:[['PO', String(o.PoNumber || '—')], ['Store', o.StoreName || '—'],
                ['Distributor', o.DbName || '—'],
                ['PO units', String(po)], ['Invoiced units', String(billed)],
                ['Gap', (po - billed) + ' units'],
                ['Fill rate', Math.round(billed / po * 100) + '%'],
                ['Reason', o.BillingRemark || '—']],
          go:['trk', 'poi', 'PO vs Invoice me poori detail dekho'] });
      } else if (String(o.Status || '') === 'Billing Done' && Notif.fresh(t)) {
        add({ id:'bil_' + Appr.jid(o.PoNumber), kind:'Billing', sev:'ok', t:t,
          title:(o.StoreName || 'Order') + ' — invoice ban gaya',
          sum:'Poora order invoice ho gaya — ' + billed + ' units · ' + inr(o.TotValue),
          rows:[['PO', String(o.PoNumber || '—')], ['Store', o.StoreName || '—'],
                ['Distributor', o.DbName || '—'], ['Order date', dmy(o.Date)],
                ['Invoiced units', String(billed)], ['MRP value', inr(o.TotValue)],
                ['Billing type', o.BillingType || 'Full']],
          go:['trk', 'poi', 'PO vs Invoice me poori detail dekho'] });
      }
    });

    /* ══ 3. NEW OUTLETS the ASM never coded ══ */
    DB.mine('NewStores').forEach(function (r) {
      var st = Trk.st('ns', r.Status);
      if (Trk.shut(st)) return;
      var t = Appr.ts(r.Ts) || Appr.ts(r.Date), d = Notif.days(t);
      if (d <= Notif.NS_DAYS) return;
      add({ id:'ns_' + Appr.jid(r.StoreId), kind:'New outlet', sev:d > Notif.NS_DAYS * 2 ? 'bad' : 'warn', t:t,
        title:(r.StoreName || 'Naya outlet') + ' — ' + d + ' din se ' + st,
        sum:'Naye outlet ka code abhi tak nahi bana. ASM se follow-up karo.',
        rows:[['Store', r.StoreName || '—'], ['Store id', String(r.StoreId || '—')],
              ['Town / beat', (r.Town || '—') + (r.Beat ? ' / ' + r.Beat : '')],
              ['Distributor', r.DbName || '—'], ['Kholne ki date', dmy(r.Date)],
              ['Kitne din se', d + ' din'], ['Status', st],
              ['Aakhri note', r.StatusReason || '—']],
        go:['trk', 'ns', 'Tracker me status update karo'] });
    });

    /* ══ 4. POSM requirements nobody moved ══ */
    DB.mine('PosmRequirement').forEach(function (r) {
      var st = Trk.st('pq', r.Status);
      if (Trk.shut(st)) return;
      var t = Appr.ts(r.Ts) || Appr.ts(r.Date), d = Notif.days(t);
      if (d <= Notif.PQ_DAYS) return;
      add({ id:'pq_' + Appr.jid(r.Id), kind:'POSM', sev:d > Notif.PQ_DAYS * 2 ? 'bad' : 'warn', t:t,
        title:(r.StoreName || 'POSM') + ' — ' + d + ' din se ' + st,
        sum:(r.Element || 'POSM') + ' ka requirement abhi tak ' + st + ' hai.',
        rows:[['Store', r.StoreName || '—'], ['Element', r.Element || '—'],
              ['Qty', num(r.Qty) ? String(num(r.Qty)) : '—'], ['City', r.City || '—'],
              ['Kab tak chahiye', r.NeededBy ? dmy(r.NeededBy) : '—'],
              ['Maanga', dmy(r.Date)], ['Kitne din se', d + ' din'], ['Status', st],
              ['Aakhri note', r.StatusReason || '—']],
        go:['trk', 'pq', 'Tracker me status update karo'] });
    });

    /* ══ 5. PJP — the window, and whatever the HOD did with the plan ══ */
    try {
      if (!Auth.isAdmin() && Pjp.winOpen() && !Pjp.approvedFor(Pjp.winMonth())) {
        var wm = Pjp.winMonth();
        add({ id:'pjpwin_' + wm, kind:'PJP', sev:'bad', t:Date.now(),
          title:'PJP window khula hai — ' + (monthName(wm) || wm),
          sum:'1 tareekh tak plan bhejna hai. Approve nahi hua to Field tab band rahega.',
          rows:[['Month', monthName(wm) || wm], ['Window', '27 se 1 tareekh tak'],
                ['Abhi ka status', 'Approve nahi hua']],
          go:['pjp', '', 'PJP tab kholo'] });
      }
    } catch (e) {}
    DB.mine('PjpDraft').forEach(function (d) {
      var st = Appr.norm(d.Status), t = Appr.ts(d.HodAt) || Appr.ts(d.UpdatedAt) || Appr.ts(d.SubmittedAt);
      var sent = Appr.ts(d.SubmittedAt);
      if (st === 'rejected' || st === 'partial') {
        var nrej = (Admin.rejDays(d) || []).length;
        add({ id:'pjpd_' + Appr.jid(d.Key) + '_' + (t || 0), kind:'PJP', sev:'bad', t:t,
          title:'PJP ' + (st === 'partial' ? 'me kuch din reject hue' : 'reject hua') +
            ' — ' + (monthName(d.Month) || d.Month || ''),
          sum:(st === 'partial' ? nrej + ' din theek karke dobara bhejo' : 'Dusra plan banake bhejo') +
            (d.RejectReason ? ' — ' + d.RejectReason : ''),
          rows:[['Month', monthName(d.Month) || d.Month || '—'],
                ['Kisne', (d.HodBy || '—') + (d.HodRole ? ' (' + d.HodRole + ')' : '')],
                ['Kab', Appr.when(t) || '—'],
                ['Reason', d.RejectReason || '—'],
                ['Reject hue din', nrej ? String(nrej) : '—']],
          go:['pjp', '', 'PJP tab me theek karo'] });
      } else if (st === 'approved' && Notif.fresh(t)) {
        add({ id:'pjpa_' + Appr.jid(d.Key) + '_' + (t || 0), kind:'PJP', sev:'ok', t:t,
          title:'PJP approve ho gaya — ' + (monthName(d.Month) || d.Month || ''),
          sum:'Plan Master_PJP me chala gaya — Plan tab me roz dikhega.',
          rows:[['Month', monthName(d.Month) || d.Month || '—'],
                ['Kisne approve kiya', (d.HodBy || '—') + (d.HodRole ? ' (' + d.HodRole + ')' : '')],
                ['Kab', Appr.when(t) || '—'],
                ['Field din bhare', Appr.cover(d.Coverage) || '—']],
          go:['plan', '', 'Plan tab kholo'] });
      } else if (st === 'pending' && Notif.days(sent) > Notif.PJP_DAYS) {
        add({ id:'pjpw_' + Appr.jid(d.Key), kind:'PJP', sev:'warn', t:sent,
          title:'PJP ' + Notif.days(sent) + ' din se HOD ke paas hai',
          sum:(monthName(d.Month) || d.Month || '') + ' ka plan abhi tak decide nahi hua — HOD ko yaad dilao.',
          rows:[['Month', monthName(d.Month) || d.Month || '—'],
                ['Bheja', Appr.when(sent) || '—'],
                ['Pending', Appr.gap(Date.now() - sent)]],
          go:['appr', '', 'Approvals me dekho'] });
      }
    });

    /* ══ 6. PLAN CHANGES — a same-day decision, so a day of silence is already a problem ══ */
    DB.mine('Deviation').forEach(function (d) {
      var st = Appr.norm(d.Status), t = Appr.ts(d.HodAt) || Appr.ts(d.UpdatedAt) || Appr.ts(d.Ts);
      var sent = Appr.ts(d.Ts) || Appr.ts(d.Date);
      var want = (d.NewTown || '—') + ' / ' + (d.NewBeat || '—');
      if (st === 'pending' && Notif.days(sent) >= Notif.DEV_DAYS) {
        add({ id:'devw_' + Appr.jid(d.Id), kind:'Plan change', sev:'warn', t:sent,
          title:'Plan change ' + dmy(d.Date) + ' — abhi tak decide nahi hua',
          sum:'Maanga tha ' + want + '. Jab tak approve nahi hota, PJP wala beat hi chalega.',
          rows:[['Date', dmy(d.Date)], ['PJP me tha', (d.PlannedTown || '—') + ' / ' + (d.PlannedBeat || '—')],
                ['Aap ne maanga', want], ['Reason', d.Reason || '—'],
                ['Bheja', Appr.when(sent) || '—'], ['Pending', Appr.gap(Date.now() - sent)]],
          go:['appr', '', 'Approvals me dekho'] });
      } else if ((st === 'approved' || st === 'rejected') && Notif.fresh(t)) {
        add({ id:'dev_' + Appr.jid(d.Id) + '_' + (t || 0), kind:'Plan change',
          sev:st === 'approved' ? 'ok' : 'bad', t:t,
          title:'Plan change ' + dmy(d.Date) + ' — ' + (st === 'approved' ? 'approve' : 'reject') + ' ho gaya',
          sum:st === 'approved' ? want + ' par kaam kar sakte ho.'
            : 'Ye beat dobara request nahi kar sakte — koi dusra beat chuno.' +
              (d.HodRemarks ? ' ' + d.HodRemarks : ''),
          rows:[['Date', dmy(d.Date)], ['Aap ne maanga', want],
                ['Kisne', (d.HodBy || '—') + (d.HodRole ? ' (' + d.HodRole + ')' : '')],
                ['Kab', Appr.when(t) || '—'], ['HOD ka message', d.HodRemarks || '—']],
          go:['plan', '', 'Plan tab kholo'] });
      }
    });

    /* ══ 7. TA/DA — a deduction is the rep's move, an approval is news ══ */
    DB.mine('TaDa').forEach(function (r) {
      var st = Appr.norm(r.Status), t = Appr.ts(r.HodAt) || Appr.ts(r.UpdatedAt);
      var mo = monthName(r.Month) || r.Month || '';
      if (st === 'partial' || st === 'rejected') {
        add({ id:'tada_' + Appr.jid(r.Id) + '_' + (t || 0), kind:'TA/DA', sev:'bad', t:t,
          title:'TA/DA ' + mo + ' — ' + (st === 'rejected' ? 'reject hua' : 'deduction ke saath wapas aaya'),
          sum:'Claim ' + inr(r.Total) + (num(r.DeductTotal) ? ' · deduction ' + inr(r.DeductTotal) : '') +
            ' — theek karke dobara bhejo.',
          rows:[['Month', mo || '—'], ['Claim', inr(r.Total)],
                ['Deduction', num(r.DeductTotal) ? '− ' + inr(r.DeductTotal) : '—'],
                ['Net payable', inr(r.NetTotal || (num(r.Total) - num(r.DeductTotal)))],
                ['Kisne', (r.HodBy || '—') + (r.HodRole ? ' (' + r.HodRole + ')' : '')],
                ['Kab', Appr.when(t) || '—'], ['HOD ka message', r.HodRemarks || '—']],
          go:['tada', '', 'TA/DA tab me theek karo'] });
      } else if (st === 'approved' && Notif.fresh(t)) {
        add({ id:'tadaa_' + Appr.jid(r.Id) + '_' + (t || 0), kind:'TA/DA', sev:'ok', t:t,
          title:'TA/DA ' + mo + ' approve ho gaya',
          sum:'Net payable ' + inr(r.NetTotal || r.Total) + '.',
          rows:[['Month', mo || '—'], ['Claim', inr(r.Total)],
                ['Deduction', num(r.DeductTotal) ? '− ' + inr(r.DeductTotal) : '—'],
                ['Net payable', inr(r.NetTotal || (num(r.Total) - num(r.DeductTotal)))],
                ['Kisne approve kiya', (r.HodBy || '—') + (r.HodRole ? ' (' + r.HodRole + ')' : '')],
                ['Kab', Appr.when(t) || '—']],
          go:['appr', '', 'Approvals me dekho'] });
      }
    });

    /* ══ 8. whatever the HOD pushed by hand ══ */
    DB.mine('Notify').forEach(function (n) {
      var t = Appr.ts(n.Ts), shut = String(n.Status || '').toLowerCase() === 'closed';
      add({ id:'nt_' + Appr.jid(n.Id), kind:'Update', sev:shut ? 'info' : 'warn', t:t,
        title:n.Title || 'Update',
        sum:String(n.Detail || '').split('\n')[0] || 'HOD ne kuch update kiya hai.',
        rows:[['Kya badla', n.Detail || '—'], ['Kisne', n.By || '—'], ['Kab', Appr.when(t) || '—']],
        sheetKey:n.Id, sheetRead:shut,
        go:['appr', '', 'Approvals me dekho'] });
    });

    /* a Notify row already closed on the sheet is read everywhere, even on a fresh device */
    out.forEach(function (o) { if (o.sheetRead) o.read = true; });
    /* unread first, then loudest, then newest — the order somebody scans a notification list in */
    return out.sort(function (a, b) {
      return (a.read ? 1 : 0) - (b.read ? 1 : 0) ||
             (Notif.RANK[a.sev] || 3) - (Notif.RANK[b.sev] || 3) ||
             (b.t || 0) - (a.t || 0);
    });
  },

  /* the one number the nav badge and the chip both use */
  unread: function () {
    try { return Notif.list().filter(function (o) { return !o.read; }).length; } catch (e) { return 0; }
  },

  html: function () {
    var all = Notif.list();
    var h = UI.head('', 'Notifications',
      'Har wo cheez jo aapka dhyaan maang rahi hai — atke hue order, POSM, naye outlet, ' +
      'PJP ka window aur HOD ke update. Kisi bhi card par tap karke detail dekho.');

    var un = all.filter(function (o) { return !o.read; }).length;
    var todo = all.filter(Notif.todo).length;
    h += '<div class="kpis k3">' +
      UI.kpi(un, 'Naya', un ? 'r' : 'g') +
      UI.kpi(todo, 'Action chahiye', todo ? 'r' : 'g') +
      UI.kpi(all.length, 'Total', 'b') + '</div>';

    /* the SAME two dropdowns Approvals uses — type on the left, read state on the right, and the
       count against an option is what still needs doing, never a total */
    var kinds = [['all', 'Sab', todo]];
    Notif.KINDS.forEach(function (k) {
      var g = all.filter(function (o) { return o.kind === k[0]; });
      if (!g.length) return;
      kinds.push([k[0], k[1], g.filter(Notif.todo).length]);
    });
    var byKind = all.filter(function (o) { return Notif.kindF === 'all' || o.kind === Notif.kindF; });
    var nUn = byKind.filter(function (o) { return !o.read; }).length;
    var states = [['unread', 'Naya', nUn], ['read', 'Dekh liya', 0], ['all', 'Sab', 0]];
    h += '<div class="card" style="padding:10px"><div class="row two">' +
      '<div><label class="f">Type</label><select class="in" onchange="Notif.setKind(this.value)">' +
        kinds.map(function (c) {
          return '<option value="' + esc(c[0]) + '"' + (Notif.kindF === c[0] ? ' selected' : '') + '>' +
            esc(c[1]) + (c[2] ? ' (' + (c[2] > 99 ? '99+' : c[2]) + ')' : '') + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label class="f">Status</label><select class="in" onchange="Notif.set(this.value)">' +
        states.map(function (c) {
          return '<option value="' + esc(c[0]) + '"' + (Notif.filter === c[0] ? ' selected' : '') + '>' +
            esc(c[1]) + (c[2] ? ' (' + (c[2] > 99 ? '99+' : c[2]) + ')' : '') + '</option>'; }).join('') +
      '</select></div></div>' +
      (un ? '<div class="btns"><button class="btn ghost sm" onclick="Notif.markAll()">Sab dekh liya</button></div>' : '') +
      '</div>';

    var show = byKind.filter(function (o) {
      return Notif.filter === 'all' || (Notif.filter === 'unread' ? !o.read : o.read); });
    if (!show.length) return h + '<div class="card">' +
      UI.empty('', all.length ? 'Is filter me kuch nahi hai'
        : 'Sab kuch theek hai — koi notification nahi.') + '</div>';

    h += '<div class="sec-title">' + show.length + ' notification' + (show.length > 1 ? 's' : '') + '</div>';
    h += show.slice(0, 80).map(Notif.card).join('');
    if (show.length > 80) h += '<div class="hint">Sirf pehle 80 dikha rahe hain — filter use karo.</div>';
    h += '<div class="card"><div class="btns">' +
      '<button class="btn ghost" onclick="Sync.now(true,this)">Sync</button></div></div>';
    return h;
  },

  card: function (o) {
    var op = !!Notif.open[o.id], sev = Notif.SEV[o.sev] || Notif.SEV.info;
    var h = '<div class="card ap ' + Notif.kcls(o.kind) + (op ? ' op' : '') +
        '" onclick="Notif.toggle(\'' + Appr.q(o.id) + '\')">' +
      '<div class="ap-h"><div class="m">' +
        '<div class="t">' + (o.read ? '' : '<span class="pill p-open" style="margin-right:6px">Naya</span>') +
          esc(o.title) + '</div>' +
        '<div class="s"><span class="pill k-pill ' + Notif.kcls(o.kind) + '">' + esc(o.kind) + '</span>' +
          (o.t ? ' · ' + esc(Appr.when(o.t)) : '') + '</div>' +
        (o.sum ? '<div class="sum">' + esc(o.sum) + '</div>' : '') +
      '</div><span class="pill ' + sev[1] + '">' + sev[0] + '</span>' +
      '<span class="ap-x">' + (op ? '▴' : '▾') + '</span></div>';
    if (op) {
      h += '<table class="ap-t">' + o.rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td></tr>'; }).join('') + '</table>';
      h += '<div class="btns" onclick="event.stopPropagation()">' +
        (o.go ? '<button class="btn" onclick="Notif.jump(\'' + o.go[0] + '\',\'' + (o.go[1] || '') + '\')">' +
          esc(o.go[2] || 'Kholo') + '</button>' : '') +
        '<button class="btn ghost" onclick="Notif.see(\'' + Appr.q(o.id) + '\',' + (o.read ? '0' : '1') + ')">' +
          (o.read ? 'Dobara naya karo' : 'Dekh liya') + '</button></div>';
    }
    return h + '</div>';
  },

  /* opening a notification IS reading it — nobody taps a card and then hunts for a "mark read" button */
  toggle: function (id) {
    Notif.open[id] = !Notif.open[id];
    if (Notif.open[id]) Notif.see(id, 1, true);
    else render();
  },
  /* on = 1 read, 0 back to unread. A Notify row is closed on the SHEET too, so the Approvals feed
     and this screen always agree about what has been seen. */
  see: function (id, on, quiet) {
    var m = Notif.read();
    if (on) m[id] = Date.now(); else delete m[id];
    Store.set(Notif.rkey(), m);
    Nav._c = null;
    var it = Notif.list().filter(function (x) { return x.id === id; })[0];
    if (it && it.sheetKey && on && !it.sheetRead) {
      DB.save('Notify', { Id:it.sheetKey, Status:'Closed' }, { quiet:true }).then(function () { render(); });
    }
    render();
    if (!quiet) toast(on ? 'Dekh liya mark ho gaya' : 'Naya mark ho gaya');
  },
  markAll: function () {
    var m = Notif.read(), list = Notif.list(), n = 0;
    list.forEach(function (o) {
      if (o.read) return;
      m[o.id] = Date.now(); n++;
      if (o.sheetKey && !o.sheetRead) DB.save('Notify', { Id:o.sheetKey, Status:'Closed' }, { quiet:true });
    });
    Store.set(Notif.rkey(), m);
    Nav._c = null; render();
    toast(n ? n + ' notification dekh liye' : 'Kuch naya nahi tha');
  },
  jump: function (v, k) {
    if (k && v === 'trk') Trk.kind = k;
    Router.go(v);
  },
  set: function (f) { Notif.filter = f; render(); },
  setKind: function (k) { Notif.kindF = k; Notif.filter = 'all'; render(); }
};

/* ═══════════════ TA / DA — the travel claim, built from the policy ═══════════════
   Honasa "Offline and Retail Travel Policy" v1, effective 1 Feb 2026. Every number below comes from
   that document; nothing here is invented, because a claim screen that guesses a rate is worse than no
   claim screen at all. The rules that decide entitlement (not just the rates) are encoded too:

     • HQ and Ex-HQ: the daily travel allowance AND the food allowance are both claimable;
     • a MEETING day pays neither — "on days when meetings are planned, Daily allowance whether travel
       or food would not be applicable";
     • a weekly off, a holiday or leave pays nothing;
     • outstation pays by NIGHTS: a 3-day / 2-night tour is 2 outstation days, and the return day is paid
       at the Ex-HQ rate;
     • per-km is capped per station type (75 / 150 / 250 km) and needs a logbook, so the km go on the row;
     • the senior slabs have no per-day food figure at all — they have a MONTHLY food budget which has
       to cover HQ, Ex-HQ and outstation together, so the screen tracks it as a budget, not a per-day sum;
     • women may claim lodging one level up (non-metro at the metro rate);
     • Mumbai has its own lodging rate, above the other metros.

   The month is pre-filled from what the rep already told the app: the DayPlan's station and
   working-with. That is the difference between a form and a claim — he corrects it, he does not type it.
   One row per employee-month in TaDa (policy: "only one expense report to be raised for all expenses
   incurred in a month"), sent to HOD from here and decided in Approvals. */
var Tada = {
  month:'', days:null, open:'', _dirty:false, _t:null,

  /* ── the policy ──
     Each slab: the designations it covers (short codes as they appear in LoginConfig, and the long
     names from the policy), then HQ / Ex-HQ / Outstation entitlements and lodging. */
  METRO:['DELHI','NEW DELHI','DELHI NCR','NCR','GURGAON','GURUGRAM','NOIDA','GHAZIABAD','FARIDABAD',
         'MUMBAI','KOLKATA','HYDERABAD','CHENNAI','BANGALORE','BENGALURU'],
  SLABS:[
    { id:'s1', name:'BDO / BDE / Sales Activation Officer',
      /* SBDE and ISR are carried by the older app's designation list; both sit at the field-officer
         level, so they resolve here rather than to the senior slab */
      codes:['BDO','BDE','SAO','SBDE','SBDE-GT','BDE-GT','BDE-MT','BDO-GT','BDO-MT','ISR',
             'BUSINESS DEVELOPMENT OFFICER','BUSINESS DEVELOPMENT EXECUTIVE',
             'SALES ACTIVATION OFFICER'],
      hq:{ da:300, food:150 },
      ex:{ da:450, food:150, tickets:true, station:200 },
      out:{ metro:1250, nonMetro:1000, foodMetro:400, foodNonMetro:250, tickets:true, station:200 },
      lodge:{ nonMetro:1800, metro:2500, mumbai:3000 },
      travel:'3AC train / sleeper / non-Volvo bus (on actuals)' },
    { id:'s2', name:'Senior BDE / Sales Automation Specialist / MT / RSDM',
      codes:['SSE','SR BDE','SENIOR BDE','SAS','MT','RSDM','SR. BDE',
             'SALES AUTOMATION SPECIALIST','MANAGEMENT TRAINEE',
             'RETAIL SALES DEVELOPMENT MANAGER'],
      hq:{ da:400, food:200 },
      ex:{ da:500, food:200, tickets:true, station:200 },
      out:{ metro:1500, nonMetro:1200, foodMetro:750, foodNonMetro:500, tickets:true, station:200 },
      lodge:{ nonMetro:2500, metro:3000, mumbai:5000 },
      travel:'3AC train / sleeper / non-Volvo bus (on actuals)' },
    { id:'s3', name:'ASM / Sr ASM / ASM Trainee / Regional BA Lead / Area Manager / Area Trainer / Regional BD-VM-Planner-Projects',
      codes:['ASM','SR ASM','SENIOR ASM','ASMT','ASM TRAINEE','RBL','AM','AM-RETAIL','AT','RBD',
             'RVM','RP','RPJ','AREA SALES MANAGER','SENIOR AREA SALES MANAGER','AREA MANAGER',
             'AREA TRAINER','REGIONAL BA LEAD','REGIONAL BD','REGIONAL VM','REGIONAL PLANNER',
             'REGIONAL PROJECTS'],
      hq:{ da:400, food:250, perKm:9, kmCap:75 },
      ex:{ da:750, food:250, tickets:true, perKm:9, kmCap:150, cab:true },
      out:{ metro:1800, nonMetro:1500, foodMetro:1000, foodNonMetro:750, tickets:true,
            perKm:9, kmCap:250, cab:true },
      lodge:{ nonMetro:4000, metro:5000, mumbai:6000 },
      travel:'Within 500 km: Volvo bus / 2AC train. Beyond 500 km: economy air, manager approval 7 days ahead' },
    { id:'s4', name:'Regional KAM',
      codes:['RKAM','R-KAM','REGIONAL KAM','REGIONAL KEY ACCOUNT MANAGER'],
      hq:{ da:400, food:250, perKm:9, kmCap:75 },
      ex:{ da:750, food:250, tickets:true, perKm:9, kmCap:150, cab:true },
      out:{ metro:0, nonMetro:0, foodMetro:1250, foodNonMetro:1000, tickets:true,
            perKm:9, kmCap:250, cab:true, billsOnly:true },
      lodge:{ nonMetro:4000, metro:5000, mumbai:6000 },
      travel:'Within 500 km: Volvo bus / 2AC train. Beyond 500 km: economy air, manager approval 7 days ahead' },
    { id:'s5', name:'Acting RSM / RSM / Regional Manager (Retail)',
      codes:['RSM','ACTING RSM','RM','RM-RETAIL','REGIONAL SALES MANAGER','REGIONAL MANAGER'],
      hq:{ perKm:9, kmCap:75, cab:true, foodMonth:15000 },
      ex:{ tickets:true, perKm:9, kmCap:150, cab:true, foodMonth:15000 },
      out:{ metro:0, nonMetro:0, tickets:true, perKm:9, kmCap:250, cab:true, billsOnly:true,
            foodMonth:15000 },
      lodge:{ nonMetro:6000, metro:7000, mumbai:8000 },
      travel:'Within 500 km: Volvo bus / 2AC train. Beyond 500 km: economy air, manager approval 7 days ahead' },
    { id:'s6', name:'Zonal Sales Manager',
      codes:['ZSM','ZM','ZONAL SALES MANAGER','ZONAL MANAGER','ZONAL BUSINESS MANAGER'],
      hq:{ perKm:10, kmCap:0, cab:true, foodMonth:20000 },
      ex:{ tickets:true, perKm:10, kmCap:0, cab:true, foodMonth:20000 },
      out:{ metro:0, nonMetro:0, tickets:true, perKm:10, kmCap:0, cab:true, billsOnly:true,
            foodMonth:20000 },
      lodge:{ nonMetro:6000, metro:7000, mumbai:8000 },
      travel:'Prior manager approval at least 5 days ahead; under 5 days needs the Chief Business Officer' }
  ],
  MEET:{ s3:700, s4:700, s5:8000, s6:8000 },      /* team-meeting budget per month */

  /* the designation comes from LoginConfig / Master_Employees in short form; match on the code list
     first, then on any word of the long name, and fall back to the junior-most slab so a claim is never
     silently generous */
  slab: function (d) {
    var v = String(d || (DB.me && DB.me.desig) || '').toUpperCase().replace(/[^A-Z0-9 -]/g, ' ').trim();
    if (!v) return Tada.SLABS[0];
    for (var i = 0; i < Tada.SLABS.length; i++) {
      if (Tada.SLABS[i].codes.some(function (c) { return v === c; })) return Tada.SLABS[i];
    }
    /* a longer designation string: look for the code as a whole word. Senior slabs are tried first so
       "SR ASM" does not stop at "ASM", and a spelled-out title matches its own entry, not a fragment of
       a bigger one. */
    for (var j = Tada.SLABS.length - 1; j >= 0; j--) {
      var hit = Tada.SLABS[j].codes.some(function (c) {
        return new RegExp('(^| )' + c.replace(/[-]/g, '[- ]?') + '( |$)').test(v); });
      if (hit) return Tada.SLABS[j];
    }
    return Tada.SLABS[0];
  },
  isMetro: function (town) {
    var t = String(town || '').toUpperCase();
    return Tada.METRO.some(function (m) { return t.indexOf(m) >= 0; });
  },
  isMumbai: function (town) { return /MUMBAI/i.test(String(town || '')); },
  /* the policy's own words for a woman's lodging entitlement: one level up. Takes a code because an HOD
     reviewing a claim is pricing SOMEBODY ELSE's month. */
  female: function (code) {
    var e = DB.emp(code || DB.me.code) || {};
    return /^f|female|woman|ms\b|mrs\b/i.test(String(e.Gender || e.Sex || ''));
  },

  /* ── the month ── */
  key: function () { return DB.me.code + '_' + Tada.mon(); },
  mon: function () {
    var t = today().slice(0, 7);
    if (!Tada.month || Tada.month > t) Tada.month = t;
    return Tada.month;
  },
  row: function () {
    return DB.find('TaDa', Tada.key()) ||
      { Id:Tada.key(), EmpCode:DB.me.code, EmpName:DB.me.name, Month:Tada.mon(), Status:'Draft' };
  },
  dates: function () {
    var a = Tada.mon().split('-'), y = +a[0], m = +a[1], n = new Date(y, m, 0).getDate(), out = [];
    var t = today(), doj = DB.doj(DB.me.code);
    for (var d = 1; d <= n; d++) {
      var k = y + '-' + p2(m) + '-' + p2(d);
      if (k > t) break;                                   /* a claim for a day not yet worked */
      if (doj && k < doj) continue;
      out.push(k);
    }
    return out;
  },

  /* STATIONS: what kind of day it was. Derived from the CITY (see stFor) and overridable per day. */
  ST:[['hq', 'HQ (base city)'], ['ex', 'Ex-HQ (same-day return)'],
      ['out', 'Outstation (night stay)'], ['meet', 'Team meeting'], ['off', 'Off / leave / holiday']],
  stLbl: function (s) {
    var x = Tada.ST.filter(function (y) { return y[0] === s; })[0];
    return x ? x[1] : s || '—';
  },

  /* ── city → station ──
     The sheet carries the rep's HQ (Master_Employees.HQ) and every town's state (Master_Stores), so the
     station follows from the city the PJP already has: same city as HQ is HQ, another city in the same
     state is a same-day Ex-HQ trip, another state is outstation. Three Master_Config keys override it
     town by town when the business wants to say otherwise. */
  hqCity: function (code) {
    var e = DB.emp(code || DB.me.code) || {};
    var v = String(e.HQ || '').trim();
    if (v) return v;
    var s = (DB.myStores() || [])[0] || {};
    return String(s.EmAsmHq || s.AsmHq || s.City || '').trim();
  },
  cfgTowns: function (k) {
    return String(DB.cfg(k, '') || '').split(/[,;|]/).map(function (x) { return Plan.norm(x); })
      .filter(Boolean);
  },
  /* the master writes "DELHI", the PJP writes "New Delhi", a rep writes "Delhi NCR" — one posting.
     Whole-word containment either way, so "Noida" still does not swallow "Greater Noida West". */
  sameCity: function (a, b) {
    var x = Plan.norm(a), y = Plan.norm(b);
    if (!x || !y) return false;
    if (x === y) return true;
    return new RegExp('(^| )' + y + '( |$)').test(x) || new RegExp('(^| )' + x + '( |$)').test(y);
  },
  stFor: function (city, code) {
    var c = Plan.norm(city);
    if (!c) return '';
    if (Tada.cfgTowns('TADA_HQ_TOWNS').indexOf(c) >= 0) return 'hq';
    if (Tada.cfgTowns('TADA_EX_TOWNS').indexOf(c) >= 0) return 'ex';
    if (Tada.cfgTowns('TADA_OUT_TOWNS').indexOf(c) >= 0) return 'out';
    if (Tada.sameCity(city, Tada.hqCity(code))) return 'hq';
    var sh = Plan.norm(Plan.stateOf(Tada.hqCity(code))), sc = Plan.norm(Plan.stateOf(city));
    if (sh && sc) return sh === sc ? 'ex' : 'out';
    return 'ex';                                          /* known city, unknown state — same-day trip */
  },
  /* every city this rep can pick: his own towns from the master, plus whatever the PJP already says */
  cities: function (extra) {
    var a = Plan.towns('');
    var hq = Tada.hqCity();
    [hq, extra].forEach(function (x) {
      if (x && a.map(Plan.norm).indexOf(Plan.norm(x)) < 0) a = [x].concat(a);
    });
    return a;
  },
  OFFISH:/^(leave|sunday|off day|weekly off|holiday|meeting.*|activity.*)$/i,
  /* what the PJP says about this date — the plan the rep already filled, then the published master */
  plan: function (k) {
    var p = DB.find('DayPlan', DB.me.code + '_' + k);
    if (p) return { ww:String(p.WorkingWith || ''), city:String(p.Town || ''), station:String(p.Station || '') };
    var m = DB.pjpFor(DB.me.code, k);
    return m ? { ww:String(m.Ww || m.Week || ''), city:String(m.Town || ''),
                 station:String(m.Station || '') }
             : { ww:'', city:'', station:'' };
  },

  /* a day with nothing claimed — the shape every day has, so a month saved by an older build still
     prices correctly */
  blank: function () {
    return { st:'hq', city:'', ta:0, da:0, lodge:0, night:0,
             taT:0, daT:0, note:'', from:'' };
  },
  /* pre-fill a day from the PJP */
  /* the PJP is the source of truth for WHERE a day was worked; the claim only prices it */
  fromPlan: function (k) {
    var p = Tada.plan(k);
    var city = Tada.OFFISH.test(String(p.city).trim()) ? '' : String(p.city).trim();
    var st = /meeting|activity/i.test(p.ww) ? 'meet'
      : /weekly off|leave|holiday|off day|sunday/i.test(p.ww) ? 'off'
      : /outstation/i.test(p.station) ? 'out'
      : /ex.?hq/i.test(p.station) ? 'ex'
      : /hq/i.test(p.station) ? 'hq'
      : (Tada.stFor(city) || 'hq');
    return { st:st, city:city, has:!!(p.ww || p.city || p.station) };
  },
  seed: function (k) {
    var b = Tada.blank(), f = Tada.fromPlan(k);
    b.st = f.st; b.city = f.city;
    b.night = b.st === 'out' ? 1 : 0;
    b.from = 'plan';
    return b;
  },
  /* Older drafts: the city was "town", travel was a mode + km/fare, and food was its own figure.
     Fold them into the two numbers the screen now shows, so a month saved last week still adds up. */
  migrate: function (r) {
    if (!r) return r;
    if (r.town && !r.city) r.city = r.town;
    if (r.ta === undefined) {
      var t = 0;
      if (r.fare !== undefined) t += num(r.fare);
      if (r.ticket !== undefined) t += num(r.ticket);
      if (r.cab !== undefined) t += num(r.cab);
      r.ta = t; r.taT = t ? 1 : 0;
    }
    if (r.food !== undefined && num(r.food) && !r.daT) { r.da = num(r.da) + num(r.food); r.daT = 1; }
    return r;
  },
  load: function () {
    var r = Tada.row(), k = Tada.key();
    if (Tada.days && Tada._for === k) return r;
    var saved = {};
    try { saved = JSON.parse(r.DaysJson || '{}') || {}; } catch (e) {}
    Tada.days = {};
    Tada.dates().forEach(function (d) {
      var row = saved[d] ? Tada.migrate(Object.assign(Tada.seed(d), saved[d])) : Tada.seed(d);
      /* the rep cannot edit these two, so a plan that changed after he saved must win here */
      var f = Tada.fromPlan(d);
      if (f.has) { row.st = f.st; row.city = f.city; if (row.st !== 'out') { row.night = 0; row.lodge = 0; }
                   else if (!row.night) row.night = 1; }
      Tada.days[d] = row;
    });
    Tada._for = k;
    return r;
  },
  /* the context calc needs: whose days, whose slab, whose gender. Mine by default; an HOD passes a row. */
  ctx: function (r) {
    if (!r) return { days:Tada.days, S:Tada.slab(), code:DB.me.code };
    var days = {};
    try { days = JSON.parse(r.DaysJson || '{}') || {}; } catch (e) {}
    Object.keys(days).forEach(function (d) {
      days[d] = Tada.migrate(Object.assign(Tada.blank(), days[d])); });
    return { days:days, S:Tada.slab(r.Designation), code:r.EmpCode };
  },

  /* The station and the city belong to the PJP, so they are not in here: what the rep owns is what the
     day cost him and a note about it. */
  set: function (d, f, v) {
    /* Approved is final for the employee — HOD's own adjust flow writes through hodDo/hodSet, a
       completely separate path, so this guard never blocks a legitimate HOD correction */
    if (/approved/i.test((Tada.row() || {}).Status || '')) return;
    Tada.load();
    if (!Tada.days[d]) Tada.days[d] = Tada.seed(d);
    var r = Tada.days[d];
    if (f === 'st' || f === 'city') return;                 /* the plan's, not his */
    r[f] = f === 'note' ? v : num(v);
    r.from = 'rep';
    /* the rep's own numbers, once typed, are never silently rewritten by a policy default */
    if (f === 'da') r.daT = 1;
    if (f === 'ta') r.taT = 1;
    Tada._dirty = true;
    clearTimeout(Tada._t);
    Tada._t = setTimeout(Tada.flush, 900);
  },
  /* drop an edit and go back to what the slab says */
  reset: function (d, f) {
    Tada.load();
    var r = Tada.days[d]; if (!r) return;
    if (f === 'da') { r.daT = 0; r.da = 0; }
    if (f === 'ta') { r.taT = 0; r.ta = 0; }
    Tada._dirty = true; Tada.flush(); render();
  },

  /* ── what the POLICY says a day is worth (the estimate that lands in the boxes) ── */
  pol: function (d, cx) {
    cx = cx || Tada.ctx();
    var r = (cx.days || {})[d] || Tada.blank(), S = cx.S;
    /* a meeting day and an off day pay no daily allowance — the policy is explicit */
    if (r.st === 'off' || r.st === 'meet') return { da:0, lodge:0, nights:0 };
    /* and a day the PJP does not cover has no rate to offer: without a city there is no metro / non-metro
       and no station to price, so the day stays empty until the plan says something */
    if (!String(r.city || '').trim()) return { da:0, lodge:0, nights:0, noPlan:true };
    var P = r.st === 'hq' ? S.hq : r.st === 'ex' ? S.ex : S.out;
    var metro = Tada.isMetro(r.city), nights = Math.max(1, num(r.night));
    if (r.st === 'out') {
      /* "bills only" slabs (R-KAM, RSM, ZSM) have no fixed outstation allowance at all — pre-filling
         their food ceiling as if it were a DA would be inviting a claim nobody has a bill for */
      var per = P.billsOnly ? 0 : (metro ? P.metro : P.nonMetro);
      var food = (P.billsOnly || P.foodMonth) ? 0 : (metro ? P.foodMetro : P.foodNonMetro);
      var L = S.lodge, cap = Tada.isMumbai(r.city) ? L.mumbai : (metro ? L.metro : L.nonMetro);
      /* the policy's own words: a woman may take the next level up in a non-metro */
      if (Tada.female(cx.code) && !metro && !Tada.isMumbai(r.city)) cap = L.metro;
      return { da:(per + food) * nights, lodge:cap * nights, nights:nights, perNight:per + food };
    }
    /* HQ and Ex-HQ: the fixed daily allowance and the food figure are one number to the rep */
    return { da:num(P.da) + (P.foodMonth ? 0 : num(P.food)), lodge:0, nights:0 };
  },

  /* ── what one day is worth ──
     Returns the amounts AND the reasons, so the screen can explain itself and an HOD can see how every
     rupee was reached without asking. */
  calc: function (d, cx) {
    cx = cx || Tada.ctx();
    var S = cx.S, r = (cx.days || {})[d] || Tada.blank();
    var out = { da:0, ta:0, lodge:0, why:[], warn:[], bills:[] };
    if (r.st === 'off') { out.why.push('Off / leave / holiday — policy me DA nahi milta'); return out; }
    var pol = Tada.pol(d, cx);
    var nights = Math.max(1, num(r.night));

    /* TA — what the journey actually cost. There is no policy rate for it: the bill decides, and the
       slab's own travel class (printed above) says what he may travel by. */
    out.ta = num(r.ta);
    if (out.ta) out.bills.push('Travel bill / ticket / logbook');

    if (r.st === 'meet') {
      /* the policy pays a meeting day nothing but the travel to it */
      out.why.push('Meeting day — sirf TA milta hai, DA nahi');
      if (num(r.da)) out.warn.push('Meeting day par DA nahi milta — HOD ise deduct kar sakta hai');
      return out;
    }

    /* only worth saying once he has actually claimed something for the day */
    if (pol.noPlan && (r.taT || r.daT || num(r.lodge)))
      out.warn.push('Is din ka city PJP me nahi hai — PJP theek karao, tabhi rate lagega');

    /* DA — the policy figure is filled in and the rep may correct it; over the figure is paid into the
       claim and flagged, so the HOD sees it here instead of finding it in payroll */
    out.da = r.daT ? num(r.da) : pol.da;
    if (out.da) {
      out.why.push(r.st === 'out'
        ? nights + ' night × ' + inr(pol.perNight || 0) + ' (DA + food)'
        : 'DA ' + inr(pol.da) + ' policy ke hisaab se');
    }
    if (r.daT && num(r.da) > pol.da && pol.da)
      out.warn.push('DA policy rate ' + inr(pol.da) + ' se zyada likha hai — HOD check karega');
    if (!pol.da && !out.da)
      out.why.push('Is role ke liye fixed DA nahi hai — TA aur bills par claim hota hai');

    /* LODGING — outstation only, capped per night by town (Mumbai has its own rate) */
    if (r.st === 'out') {
      out.lodge = Math.min(num(r.lodge), pol.lodge || 0);
      if (pol.lodge && num(r.lodge) > pol.lodge) out.warn.push('Lodging cap ' + inr(pol.lodge / nights) + '/raat');
      if (out.lodge) out.bills.push('Hotel bill (GST of the state)');
      if (!num(r.night)) out.warn.push('Kitni raat ruke, wo bharo');
    }

    /* a day the rep has not filled in yet claims nothing, and nothing is not a mistake */
    if (!Tada.dayTot(out) && !r.taT && !r.daT && !num(r.lodge)) {
      out.why = ['Is din ka koi claim nahi bhara'];
      out.warn = [];
    }
    return out;
  },
  dayTot: function (c) { return num(c.da) + num(c.ta) + num(c.lodge); },

  total: function (cx, dates) {
    if (!cx) { Tada.load(); cx = Tada.ctx(); }
    var S = cx.S, t = { da:0, ta:0, lodge:0, days:0, nights:0,
      warn:0, bills:{}, byStation:{ hq:0, ex:0, out:0, meet:0, off:0 } };
    (dates || Tada.dates()).forEach(function (d) {
      var r = (cx.days || {})[d] || Tada.blank(), c = Tada.calc(d, cx);
      t.byStation[r.st] = (t.byStation[r.st] || 0) + 1;
      if (r.st === 'out') t.nights += Math.max(1, num(r.night));
      if (Tada.dayTot(c)) t.days++;
      t.da += c.da; t.ta += c.ta; t.lodge += c.lodge;
      t.warn += c.warn.length;
      c.bills.forEach(function (b) { t.bills[b] = (t.bills[b] || 0) + 1; });
    });
    var row = cx.row || Tada.row();
    t.meet = num(row.MeetAmount);
    t.meetCap = Tada.MEET[S.id] || 0;
    t.foodMonth = (S.hq.foodMonth || 0);
    t.grand = t.da + t.ta + t.lodge + t.meet;
    t.deduct = Tada.dedTot(row);
    t.net = Math.max(0, t.grand - t.deduct);
    return t;
  },

  /* ── the HOD's deductions live on the same row, one entry per date ── */
  ded: function (r) {
    try { return JSON.parse((r || Tada.row()).DeductJson || '{}') || {}; } catch (e) { return {}; }
  },
  dedTot: function (r) {
    var d = Tada.ded(r), s = 0;
    Object.keys(d).forEach(function (k) { s += num(d[k] && d[k].amt); });
    return s;
  },
  dedN: function (r) {
    var d = Tada.ded(r), n = 0;
    Object.keys(d).forEach(function (k) { if (num(d[k] && d[k].amt) > 0) n++; });
    return n;
  },

  flush: function () {
    if (!Tada._dirty) return null;
    Tada._dirty = false;
    var t = Tada.total(), r = Tada.row();
    return DB.save('TaDa', { Id:Tada.key(), EmpCode:DB.me.code, EmpName:DB.me.name, Month:Tada.mon(),
      Designation:(DB.emp(DB.me.code) || {}).Designation || DB.me.desig || '',
      Station:'', Status:/pending|approved|return/i.test(r.Status || '') ? r.Status : 'Draft',
      DaysJson:JSON.stringify(Tada.days), DaAmount:t.da, FoodAmount:0, TravelAmount:t.ta,
      LodgeAmount:t.lodge, MeetAmount:t.meet, MeetCity:r.MeetCity || '', OtherAmount:0,
      Nights:t.nights, DeductJson:r.DeductJson || '', DeductTotal:t.deduct, NetTotal:t.net,
      Total:t.grand, UpdatedAt:Date.now() }, { quiet:true });
  },
  saveDay: function (d, el) {
    Tada._dirty = true;
    return Busy.run('tdday_' + d, el, 'Save…', function () {
      var p = Tada.flush() || Promise.resolve();
      return p.then(function () { Tada.open = ''; render(); toast(dmy(d) + ' save ho gaya'); });
    });
  },
  setMeet: function (v) {
    var t = Tada.total(), cap = t.meetCap;
    var r = Tada.row();
    Tada._dirty = true;
    DB.save('TaDa', Object.assign({}, r, { Id:Tada.key(), MeetAmount:num(v), UpdatedAt:Date.now() }), { quiet:true });
    if (cap && num(v) > cap) toast('Meeting budget cap ' + inr(cap) + ' per month', 3500);
    clearTimeout(Tada._t); Tada._t = setTimeout(function () { Tada._dirty = true; Tada.flush(); render(); }, 900);
  },
  setMeetCity: function (v) {
    var r = Tada.row();
    DB.save('TaDa', Object.assign({}, r, { Id:Tada.key(), MeetCity:v, UpdatedAt:Date.now() }), { quiet:true });
  },

  /* ── the screen ── */
  html: function () {
    var r = Tada.load(), S = Tada.slab(), t = Tada.total();
    var st = String(r.Status || 'Draft');
    var sent = /pending/i.test(st), okd = /approved/i.test(st), back = /return/i.test(st);
    var h = UI.head('', 'TA / DA claim',
      'Policy ke hisaab se apne mahine ka travel claim banao — din ka city aur station PJP se aa jata hai, ' +
      'DA aur food estimate hain jo aap badal sakte ho.');

    /* who this is, and therefore which slab */
    h += '<div class="card"><div class="c-h"><h3>' + esc(monthName(Tada.mon())) + '</h3>' +
      '<span class="pill ' + (okd ? 'p-ok' : back ? 'p-bad' : sent ? 'p-warn' : 'p-grey') + '">' +
        esc(back ? 'HOD ne wapas bheja' : st) + '</span></div>' +
      '<div class="row two"><div><label class="f">Month</label>' +
      '<input class="in" type="month" max="' + today().slice(0, 7) + '" value="' + Tada.mon() +
      '" onchange="Tada.setMonth(this.value)"></div>' +
      '<div><label class="f">Designation</label>' +
      '<input class="in lk" readonly value="' + esc((DB.emp(DB.me.code) || {}).Designation || DB.me.desig || '—') + '"></div></div>' +
      '<div class="hint" style="margin-top:8px">Aapka slab: <b>' + esc(S.name) + '</b> · HQ: <b>' +
        esc(Tada.hqCity() || '—') + '</b></div></div>';

    /* what the policy allows this slab — read once, trusted all month */
    h += '<div class="sec-title">Aapka entitlement</div><div class="card">' +
      Tada.slabTable(S) +
      '<div class="hint" style="margin-top:8px">Travel class: ' + esc(S.travel) + '</div>' +
      '<div class="hint">Metro cities: Delhi NCR, Mumbai, Kolkata, Hyderabad, Chennai, Bangalore. ' +
      'Mumbai ka lodging rate alag hai.' + (Tada.female() ? ' Female employee — lodging ek level upar claim kar sakti hain.' : '') + '</div></div>';

    if (okd) h += '<div class="banner g"><span></span><div><b>Ye claim approve ho gaya</b><br>' +
      '<span style="font-weight:500">Payment date: ' + dmy(Tada.payDate(r.HodAt)) + '</span></div></div>';
    else if (back) h += '<div class="banner r"><span></span><div><b>HOD ne ' + inr(t.deduct) +
      ' deduct karke wapas bheja</b><br><span style="font-weight:500">' + Tada.dedN(r) +
      ' din par deduction hai — neeche laal line me HOD ka reason likha hai. Theek karke ya samjha kar ' +
      'dobara bhej do.</span></div></div>';
    else if (sent) h += '<div class="banner b"><span></span><div><b>HOD ke paas hai</b><br>' +
      '<span style="font-weight:500">Approve hone tak edit kar sakte ho — dobara bhej dena.</span></div></div>';

    /* the money */
    h += '<div class="sec-title">Mahine ka total</div><div class="card">' +
      '<div class="kpis k3" style="margin-bottom:0">' +
        UI.kpi(inr(t.deduct ? t.net : t.grand), t.deduct ? 'Net claim' : 'Total claim', 'b') +
        UI.kpi(t.days, 'Claim din', 'g') +
        UI.kpi(t.warn, 'Warning', t.warn ? 'r' : 'g') + '</div>' +
      '<div class="tw" style="margin-top:10px"><table><tbody>' +
      [['DA (daily allowance)', t.da], ['TA (travel allowance)', t.ta],
       ['Lodging cost', t.lodge], ['Team meeting', t.meet]]
      .map(function (x) { return '<tr><td>' + esc(x[0]) + '</td><td class="num">' + inr(x[1]) + '</td></tr>'; }).join('') +
      /* counts, not money: how much of the month was spent away from base */
      '<tr><td>Ex-HQ visits</td><td class="num">' + t.byStation.ex + ' din</td></tr>' +
      '<tr><td>Outstation visits</td><td class="num">' + t.byStation.out + ' din · ' + t.nights + ' raat</td></tr>' +
      '<tr class="tot"><td><b>TOTAL</b></td><td class="num"><b>' + inr(t.grand) + '</b></td></tr>' +
      (t.deduct ? '<tr><td style="color:var(--bad)">HOD deduction</td>' +
        '<td class="num" style="color:var(--bad)">− ' + inr(t.deduct) + '</td></tr>' +
        '<tr class="tot"><td><b>Net payable</b></td><td class="num"><b>' + inr(t.net) + '</b></td></tr>' : '') +
      '</tbody></table></div>' +
      (t.foodMonth ? '<div class="hint" style="margin-top:8px">Is role ka food monthly budget ' +
        inr(t.foodMonth) + ' hai — DA me alag se food nahi jodte, bill lagao.</div>' : '') +
      (t.meetCap ? '<div class="row two" style="margin-top:10px"><div><label class="f">Team meeting bill (' +
        inr(t.meetCap) + (S.id === 's3' || S.id === 's4' ? ' per employee' : ' per zone') + ' / month)</label>' +
        '<input class="in" type="number" min="0" value="' + num(t.meet) +
        '" oninput="Tada.setMeet(this.value)"></div>' +
        '<div><label class="f">Meeting kis city me</label>' + Tada.citySel('', r.MeetCity || '', 'Tada.setMeetCity(this.value)') +
        '</div></div>' +
        '<div class="hint" style="margin-top:6px">' + (t.meetCap && t.meet > t.meetCap ? 'Cap se zyada' : 'Cap ke andar') + '</div>' : '') +
      '<div class="hint" style="margin-top:8px">Bills lagenge: ' +
        (Object.keys(t.bills).length ? esc(Object.keys(t.bills).join(', ')) : 'koi nahi (sirf DA)') +
        '. DA ke liye bill ki zaroorat nahi hoti.</div>' +
      '</div>';

    /* the days */
    var ds = Tada.dates(), ded = Tada.ded(r);
    h += '<div class="sec-title">Din-wise (' + ds.length + ')</div>';
    if (!ds.length) return h + '<div class="card">' + UI.empty('', 'Is month ka koi din abhi nahi aaya') + '</div>';
    h += '<div class="card">';
    var pane = !Tada.open;
    if (pane) h += '<div class="pane" style="max-height:430px">';
    var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    ds.forEach(function (d) {
      var row = Tada.days[d], c = Tada.calc(d), op = Tada.open === d;
      var amt = Tada.dayTot(c), dd = ded[d] || {};
      var bad = c.warn.length || num(dd.amt) > 0;
      /* inset, not full-bleed: this list lives inside a padded card (and sometimes inside a scrolling
         pane), where a -14px bleed hangs past the content box */
      h += '<div class="drow' + (bad ? ' bad inset' : (op ? ' op inset' : '')) + '">' +
        '<div class="dr-h"><div class="m">' +
          '<div class="t">' + dmy(d) + ' <span class="hint">' + DAY[new Date(d + 'T00:00:00').getDay()] + '</span>' +
          (row.from === 'plan' ? ' <span class="pill p-grey">plan se</span>' : '') +
          (c.warn.length ? ' <span class="pill p-bad">' + c.warn.length + '</span>' : '') + '</div>' +
          '<div class="s">' + esc(Tada.stLbl(row.st)) +
            /* an off day owes no city; a claimable day without one cannot be priced, so it is flagged */
            (row.st === 'off' || row.st === 'meet' ? (row.city ? ' · ' + esc(row.city) : '')
              : ' · ' + (row.city ? esc(row.city) : '<b style="color:var(--bad)">city nahi</b>')) +
            (row.st === 'out' && num(row.night) ? ' · ' + num(row.night) + ' raat' : '') +
            (amt ? ' · ' + inr(amt) : ' · —') + '</div></div>' +
        (okd ? '<span class="pill p-grey" style="flex:0 0 auto">Locked</span>'
             : '<button class="btn ghost xs" onclick="Tada.tap(\'' + d + '\')">' + (op ? 'Close' : 'Edit') + '</button>') +
        '</div>' +
        (num(dd.amt) > 0 ? '<div class="hint" style="color:var(--bad);font-weight:700;margin:2px 0 0">' +
          'HOD deduction − ' + inr(dd.amt) + (dd.note ? ' · ' + esc(dd.note) : '') + '</div>' : '') +
        (op && !okd ? Tada.dayEdit(d, row, c, S) : '') +
        '</div>';
    });
    if (pane) h += '</div><div class="hint" style="margin-top:8px">List scroll karo — ' + ds.length +
      ' din. Kisi bhi din par Edit dabao.</div>';
    h += '</div>';

    /* send */
    h += '<div class="card"><div class="c-h"><h3>HOD ko bhejo</h3>' +
      '<span class="pill ' + (t.warn ? 'p-bad' : 'p-ok') + '">' + (t.warn ? t.warn + ' warning' : 'Sab theek') + '</span></div>' +
      '<div class="sub">Ek mahine ka ek hi claim jata hai. 5 tarikh tak approve hua to 17 ko payment, ' +
      '15 tarikh tak hua to 30 ko.</div>' +
      '<label class="f">Remarks</label><input class="in" id="td_rm" value="' + esc(r.Remarks || '') + '">' +
      '<div class="btns"><button class="btn' + (okd ? ' ghost' : '') + '" onclick="Tada.send(this)"' +
        (okd ? ' disabled' : '') + '>' + (sent || back ? 'Dobara bhejo' : 'HOD ko bhejo') + '</button>' +
      '<button class="btn ghost" onclick="Tada.excel()">Excel</button></div>' +
      '<div class="btns" style="margin-top:8px">' +
        '<button class="btn ghost" onclick="Tada.pdf()">TA/DA PDF download</button>' +
        '<button class="btn ghost" onclick="Tada.policyView()">Travel policy</button></div>' +
      (r.HodRemarks ? '<div class="banner ' + (back ? 'r' : 'b') + '" style="margin-top:10px">' +
        '<span></span><div><b>HOD ka message</b><br><span style="font-weight:500">' + esc(r.HodRemarks) + '</span></div></div>' : '') +
      '</div>';
    return h;
  },
  citySel: function (d, cur, handler) {
    var list = Tada.cities(cur);
    return '<select class="in" onchange="' + (handler || ('Tada.set(\'' + d + '\',\'city\',this.value)')) + '">' +
      '<option value=""' + (cur ? '' : ' selected') + '>— city chuno —</option>' +
      list.map(function (x) { return '<option' + (Plan.norm(x) === Plan.norm(cur) ? ' selected' : '') +
        '>' + esc(x) + '</option>'; }).join('') + '</select>';
  },
  slabTable: function (S) {
    var line = function (P, what) {
      return '<tr><td>' + what + '</td><td>' + esc(Tada.polLine(P)) + '</td><td>' +
        esc(Tada.polFood(P)) + '</td></tr>';
    };
    return '<div class="tw"><table><thead><tr><th>Station</th><th>Travel</th><th>Food</th></tr></thead><tbody>' +
      line(S.hq, 'HQ') + line(S.ex, 'Ex-HQ') + line(S.out, 'Outstation') +
      '<tr class="tot"><td><b>Lodging cost</b></td><td colspan="2"><b>' + inr(S.lodge.nonMetro) +
      ' non-metro · ' + inr(S.lodge.metro) + ' metro · ' + inr(S.lodge.mumbai) +
      ' Mumbai</b></td></tr></tbody></table></div>';
  },
  dayEdit: function (d, r, c, S) {
    var pol = Tada.pol(d);
    var numf = function (f, lbl, v, extra) {
      return '<div><label class="f">' + lbl + '</label><input class="in" type="number" min="0" value="' +
        num(v) + '" oninput="Tada.set(\'' + d + '\',\'' + f + '\',this.value)">' + (extra || '') + '</div>';
    };
    /* the station and the city are the PJP's word, so they are shown, not offered */
    var h = '<div class="dr-b">' +
      '<div class="row two"><div><label class="f">Station</label>' +
        '<input class="in lk" readonly value="' + esc(Tada.stLbl(r.st)) + '"></div>' +
      '<div><label class="f">City</label>' +
        '<input class="in lk" readonly value="' + esc(r.city || '—') + '"></div></div>' +
      '<div class="hint" style="margin-top:6px">Station aur city PJP se aate hain — badalna ho to PJP ' +
        '(ya Change PJP) me badlo.</div>';

    if (r.st === 'off') {
      h += '<div class="hint" style="margin-top:8px">' + esc(c.why[0] || '') + '</div>' + Tada.dayBar(d);
      return h + '</div>';
    }

    var f2 = [];
    /* TA is asked on every claimable day; DA only where the policy pays one */
    f2.push(numf('ta', 'TA — travel ₹', r.ta,
      '<div class="hint">Bus / train / auto / cab / apni gaadi — jo kharch hua</div>'));
    if (r.st !== 'meet') f2.push(numf('da', 'DA — daily allowance ₹', r.daT ? r.da : pol.da,
      '<div class="hint">Policy ' + inr(pol.da) + (r.daT ? ' · <a class="pl" onclick="Tada.reset(\'' + d +
        '\',\'da\')">policy rate wapas</a>' : '') + '</div>'));
    if (r.st === 'out') {
      f2.push(numf('night', 'Kitni raat ruke', r.night));
      f2.push(numf('lodge', 'Lodge cost ₹ (GST ke saath)', r.lodge,
        '<div class="hint">Cap ' + inr(pol.lodge) + ' (' + Math.max(1, num(r.night)) + ' raat)</div>'));
    }
    while (f2.length % 2) f2.push('<div></div>');
    for (var i = 0; i < f2.length; i += 2) h += '<div class="row two" style="margin-top:8px">' + f2[i] + f2[i + 1] + '</div>';
    if (r.st === 'meet') h += '<div class="hint" style="margin-top:6px">Meeting day par sirf TA milta hai.</div>';

    h += '<label class="f">Note (optional)</label><input class="in" value="' + esc(r.note || '') +
      '" oninput="Tada.set(\'' + d + '\',\'note\',this.value)">';
    h += '<div class="tw" style="margin-top:10px"><table><tbody>' +
      [['DA', c.da], ['TA', c.ta], ['Lodge cost', c.lodge]]
      .filter(function (x) { return x[1]; })
      .map(function (x) { return '<tr><td>' + x[0] + '</td><td class="num">' + inr(x[1]) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td><b>Din ka total</b></td><td class="num"><b>' +
      inr(Tada.dayTot(c)) + '</b></td></tr></tbody></table></div>' +
      (c.why.length ? '<div class="hint" style="margin-top:6px">' + esc(c.why.join(' · ')) + '</div>' : '') +
      (c.bills.length ? '<div class="hint">Bill lagega: ' + esc(c.bills.join(', ')) + '</div>' : '') +
      c.warn.map(function (w) { return '<div class="hint" style="color:var(--bad);font-weight:700">! ' + esc(w) + '</div>'; }).join('');
    return h + Tada.dayBar(d) + '</div>';
  },
  /* one explicit Save per day — an autosave the rep cannot see is an autosave he does not trust */
  dayBar: function (d) {
    return '<div class="dsave" style="margin-top:10px"><div class="hint" style="flex:1 1 auto">' +
      'Save karne ke baad ye din band ho jayega.</div>' +
      '<button class="btn ok" onclick="Tada.saveDay(\'' + d + '\',this)">Save</button>' +
      '<button class="btn ghost" onclick="Tada.tap(\'' + d + '\')">Close</button></div>';
  },
  tap: function (d) { Tada.open = Tada.open === d ? '' : d; render(); },
  setMonth: function (m) { Tada.flush(); Tada.month = m; Tada.days = null; Tada.open = ''; render(); },
  after: function () { Flush.reg('tada', Tada.flush); },

  send: function (el) {
    var t = Tada.total(), r = Tada.row();
    if (/approved/i.test(r.Status || '')) return toast('Ye claim approve ho chuka hai');
    if (!t.grand) return toast('Claim me kuch nahi hai — pehle din bharo');
    var noCity = Tada.dates().filter(function (d) {
      var x = Tada.days[d]; return x && x.st !== 'off' && x.st !== 'meet' && !String(x.city || '').trim() &&
        Tada.dayTot(Tada.calc(d)) > 0; });
    if (noCity.length) { Tada.open = noCity[0]; render();
      return toast(dmy(noCity[0]) + ' ki city bharo — station usi se decide hota hai', 4000); }
    var warn = t.warn ? 'Isme ' + t.warn + ' warning hai — cap se zyada amount cut ho jayega. ' : '';
    return UI.confirm({ icon:'', title:'TA/DA claim bhejna hai?',
      msg:'<b>' + esc(monthName(Tada.mon())) + '</b> — ' + inr(t.grand) + ' ka claim, ' + t.days +
        ' din.<br>' + warn + 'Mahine me ek hi claim jata hai.',
      ok:'Haan, bhej do', cancel:'Abhi nahi' }).then(function (go) {
      if (!go) return;
      Tada._dirty = true;
      return Busy.run('tada_' + Tada.key(), el, 'Bhej raha hai…', function () {
        var r2 = Tada.row();
        return DB.save('TaDa', Object.assign({}, r2, { Id:Tada.key(), Month:Tada.mon(),
          Designation:(DB.emp(DB.me.code) || {}).Designation || DB.me.desig || '',
          DaysJson:JSON.stringify(Tada.days), DaAmount:t.da, FoodAmount:0, TravelAmount:t.ta,
          LodgeAmount:t.lodge, MeetAmount:t.meet, OtherAmount:0, Nights:t.nights,
          DeductTotal:t.deduct, NetTotal:t.net,
          Revision:num(r2.Revision) + 1,
          Total:t.grand, Remarks:val('td_rm'), Status:'Pending', HodAt:'', HodBy:'',
          Date:today(), SubmittedAt:new Date().toISOString(), UpdatedAt:Date.now() })).then(function () {
          Log.add('TaDa', 'Submitted', Tada.key(), inr(t.grand));
          render(); toast('Claim HOD ko chala gaya — ' + inr(t.grand), 4000);
        });
      });
    });
  },
  /* same payment rule the app already described in prose — resolved to one real date instead */
  payDate: function (hodAt) {
    var b = hodAt ? new Date(hodAt) : new Date();
    var pd = new Date(b.getFullYear(), b.getMonth(), b.getDate() <= 5 ? 17 : 30);
    return pd.getFullYear() + '-' + p2(pd.getMonth() + 1) + '-' + p2(pd.getDate());
  },
  excel: function () { return Rep.tada(Tada.mon()); },

  /* ── the two documents a rep asks for ──
     the policy he is paid under, and his own claim in a form he can forward or keep. */
  POLICY:'Travel-Policy.pdf',
  policyUrl: function () { return String(DB.cfg('Policy_PDF_URL', '') || '').trim() || Tada.POLICY; },
  /* read it right here first — download is one tap away inside the same viewer, not the only option */
  policyView: function () {
    var url = Tada.policyUrl();
    UI.sheet('Travel policy', '<div style="height:70vh;min-height:320px;border:1px solid var(--line);' +
      'border-radius:10px;overflow:hidden"><iframe src="' + esc(url) + '" title="Travel policy" ' +
      'style="width:100%;height:100%;border:0"></iframe></div>' +
      '<div class="btns" style="margin-top:10px">' +
      '<button class="btn ghost" onclick="Tada.policy()">Download</button>' +
      '<button class="btn ghost" onclick="UI.close()">Band karo</button></div>');
  },
  policy: function () {
    /* the file ships beside the app; a Master_Config key can point at a newer copy in Drive */
    var url = Tada.policyUrl();
    var a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    if (!/^https?:/i.test(url)) a.download = 'Honasa-Travel-Policy.pdf';
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); }, 3000);
    toast('Policy download ho rahi hai');
  },
  pdf: function () {
    return Pdf.logo().then(function (logo) {
    var r = Tada.load(), S = Tada.slab(), t = Tada.total(), e = DB.emp(DB.me.code) || {};
    var ded = Tada.ded(r), ds = Tada.dates();
    var d = Pdf.doc();
    Pdf.head(d, 'TA / DA claim', monthName(Tada.mon()) + '  ·  ' + DB.me.name + ' (' + DB.me.code + ')', logo);

    Pdf.h2(d, 'Employee');
    Pdf.kv(d, [
      ['Employee', DB.me.name + ' (' + DB.me.code + ')'],
      ['Designation', e.Designation || DB.me.desig || '—'],
      ['HQ', Tada.hqCity() || '—'], ['Zone', e.Zone || '—'],
      ['Policy slab', S.name],
      ['Status', String(r.Status || 'Draft')],
      ['ASM', e.AsmName || '—'], ['HOD', e.HodName || '—']
    ]);

    Pdf.h2(d, 'Claim');
    var money = [['DA (daily allowance)', inr(t.da)], ['TA (travel allowance)', inr(t.ta)],
                 ['Lodge cost', inr(t.lodge)], ['Team meeting', inr(t.meet)]];
    Pdf.table(d, [{ t:'Head', w:300 }, { t:'Amount', w:110, a:'r' }],
      money.concat([{ c:['TOTAL', inr(t.grand)], bold:true, fill:0.93 }])
        .concat(t.deduct ? [{ c:['HOD deduction', '- ' + inr(t.deduct)] },
                            { c:['NET PAYABLE', inr(t.net)], bold:true, fill:0.93 }] : []));
    d.y -= 4;
    Pdf.kv(d, [['Claim days', String(t.days)], ['Outstation nights', String(t.nights)],
               ['Ex-HQ visits', String(t.byStation.ex)], ['Outstation visits', String(t.byStation.out)],
               ['HQ days', String(t.byStation.hq)], ['Warnings', String(t.warn)]]);

    Pdf.h2(d, 'Day-wise');
    var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var cols = [{ t:'Date', w:52 }, { t:'Day', w:26 }, { t:'Station', w:64 }, { t:'City', w:78 },
                { t:'Nt', w:20, a:'r' }, { t:'DA', w:48, a:'r' }, { t:'TA', w:48, a:'r' },
                { t:'Lodge', w:48, a:'r' }, { t:'Total', w:52, a:'r' }, { t:'Ded.', w:44, a:'r' },
                { t:'Note / reason', w:139, wrap:true }];
    var rows = ds.map(function (k) {
      var row = Tada.days[k], c = Tada.calc(k), dd = ded[k] || {};
      var note = [row.note || '', dd.note ? 'HOD: ' + dd.note : ''].filter(Boolean).join(' | ');
      return { c:[dmy(k), DAY[new Date(k + 'T00:00:00').getDay()], Tada.stLbl(row.st), row.city || '—',
                  row.st === 'out' ? String(num(row.night)) : '', c.da ? inr(c.da) : '',
                  c.ta ? inr(c.ta) : '', c.lodge ? inr(c.lodge) : '',
                  Tada.dayTot(c) ? inr(Tada.dayTot(c)) : '', num(dd.amt) ? '- ' + inr(dd.amt) : '', note],
               fill:num(dd.amt) ? 0.96 : -1 };
    });
    rows.push({ c:['TOTAL', '', '', '', String(t.nights), inr(t.da), inr(t.ta), inr(t.lodge),
                   inr(t.grand - t.meet), t.deduct ? '- ' + inr(t.deduct) : '', ''],
                bold:true, fill:0.93 });
    Pdf.table(d, cols, rows);

    Pdf.h2(d, 'Policy — ' + S.name);
    Pdf.table(d, [{ t:'Station', w:70 }, { t:'Travel', w:230 }, { t:'Food', w:110 }],
      [['HQ', Tada.polLine(S.hq), Tada.polFood(S.hq)],
       ['Ex-HQ', Tada.polLine(S.ex), Tada.polFood(S.ex)],
       ['Outstation', Tada.polLine(S.out), Tada.polFood(S.out)],
       { c:['Lodging', inr(S.lodge.nonMetro) + ' non-metro / ' + inr(S.lodge.metro) + ' metro / ' +
            inr(S.lodge.mumbai) + ' Mumbai', ''], bold:true }]);
    d.y -= 2;
    d.text(Pdf.ML, d.y, Pdf.clip('Travel class: ' + S.travel, 8, Pdf.W - Pdf.ML - Pdf.MR), 8, false, 0.4);

    Pdf.foot(d, 'GARUDA · ' + DB.me.name + ' · ' + monthName(Tada.mon()) +
      ' · generated ' + dmy(today()) + '. One claim per month; approved by the 5th is paid on the 17th, ' +
      'by the 15th on the 30th.');
    var f = Pdf.save(d, 'TADA_' + DB.me.code + '_' + Tada.mon(), 'TA/DA ' + monthName(Tada.mon()), logo);
    toast('PDF ban gaya — ' + f.name);
    return f;
    });
  },
  /* the slab's own row, in one line each — shared by the screen table and the PDF */
  polLine: function (P) {
    var bits = [];
    if (P.da) bits.push('DA ' + inr(P.da));
    if (P.metro || P.nonMetro) bits.push('DA ' + inr(P.metro) + ' metro / ' + inr(P.nonMetro) + ' non-metro');
    if (P.perKm) bits.push(inr(P.perKm) + '/km' + (P.kmCap ? ' upto ' + P.kmCap + ' km' : ''));
    if (P.tickets) bits.push('bus / train actual');
    if (P.cab) bits.push('cab actual');
    if (P.billsOnly && !P.metro) bits.push('bills only');
    return bits.join(' · ') || '—';
  },
  polFood: function (P) {
    return P.foodMonth ? inr(P.foodMonth) + ' / month'
      : P.food ? inr(P.food) + ' / din'
      : (P.foodMetro ? inr(P.foodMetro) + ' metro / ' + inr(P.foodNonMetro) + ' non-metro' : '—');
  },

  /* ══════════ THE HOD's SIDE ══════════
     A claim is a month of days, not a number: the HOD reads every day the way the rep filled it, and
     where a day is not worth what was claimed he cuts an amount and says why. The note is compulsory —
     a deduction nobody explained is the thing the rep argues about next month. */
  hod:{ id:'', d:{} },
  /* post-decision adjust mode, one claim at a time — see hodView/hodEditStart/hodEditCancel */
  hodEditKey:'',
  /* the generic Approvals contract still routes "approve / reject" through Appr.act(); for a claim both
     of those mean "open it and read it", so this takes the HOD to the month instead of deciding it */
  jump: function (id) {
    Router.go('appr');
    Appr.open['tada_' + Appr.jid(id)] = true;
    render();
    toast('Poora claim dekho — har din par deduction daal sakte ho', 3800);
  },
  hodLoad: function (r) {
    if (Tada.hod.id === r.Id) return Tada.hod.d;
    Tada.hod = { id:r.Id, d:{} };
    var saved = Tada.ded(r);
    Object.keys(saved).forEach(function (k) {
      Tada.hod.d[k] = { amt:num(saved[k] && saved[k].amt), note:String((saved[k] && saved[k].note) || '') };
    });
    return Tada.hod.d;
  },
  hodSet: function (id, d, f, v) {
    var r = DB.find('TaDa', id); if (!r) return;
    var m = Tada.hodLoad(r);
    if (!m[d]) m[d] = { amt:0, note:'' };
    m[d][f] = f === 'amt' ? num(v) : String(v || '');
    Tada.hodPaint(r);
  },
  hodSum: function (r) {
    var m = Tada.hodLoad(r), cx = Tada.ctx(r), dates = Object.keys(cx.days).sort();
    cx.row = r;
    var t = Tada.total(cx, dates), ded = 0, miss = 0;
    Object.keys(m).forEach(function (k) {
      var a = num(m[k].amt);
      if (a > 0) { ded += a; if (!String(m[k].note || '').trim()) miss++; }
    });
    return { t:t, cx:cx, dates:dates, ded:ded, miss:miss, net:Math.max(0, t.grand - ded), m:m };
  },
  /* the running net, without a re-render that would take the caret out of the box being typed in */
  hodPaint: function (r) {
    var s = Tada.hodSum(r);
    var a = $('tdh_ded'), b = $('tdh_net'), c = $('tdh_miss');
    if (a) a.innerHTML = I18n.tr('− ' + inr(s.ded));
    if (b) b.innerHTML = I18n.tr(inr(s.net));
    if (c) c.innerHTML = s.miss ? I18n.s('Reason likhna baaki hai') + ': ' + s.miss : '';
  },
  hodView: function (id, can) {
    var r = DB.find('TaDa', id);
    if (!r) return '<div class="hint">Claim row nahi mila</div>';
    var s = Tada.hodSum(r), S = s.cx.S;
    var h = '<div class="sec-title" style="margin-top:12px">Poora TA/DA — ' +
      esc(monthName(r.Month) || r.Month) + '</div>';
    h += '<div class="card"><div class="hint">' + esc(r.EmpName || '') + ' · ' +
      esc(r.Designation || '—') + ' · slab: <b>' + esc(S.name) + '</b></div>' +
      '<div class="tw" style="margin-top:8px"><table><tbody>' +
      '<tr><td>Claim total</td><td class="num"><b>' + inr(s.t.grand) + '</b></td></tr>' +
      '<tr><td>Deduction</td><td class="num" id="tdh_ded" style="color:var(--bad)">− ' + inr(s.ded) + '</td></tr>' +
      '<tr class="tot"><td><b>Net payable</b></td><td class="num"><b id="tdh_net">' + inr(s.net) + '</b></td></tr>' +
      '</tbody></table></div>' +
      '<div class="hint" style="margin-top:6px">DA ' + inr(s.t.da) + ' · TA ' + inr(s.t.ta) +
        ' · Lodge ' + inr(s.t.lodge) + ' · Meeting ' + inr(s.t.meet) + '</div>' +
      '<div class="hint">Ex-HQ ' + s.t.byStation.ex + ' din · Outstation ' + s.t.byStation.out +
        ' din (' + s.t.nights + ' raat) · HQ ' + s.t.byStation.hq + ' din</div>' +
      (r.Remarks ? '<div class="hint" style="margin-top:6px">Rep ka remark: ' + esc(r.Remarks) + '</div>' : '') +
      '<div class="hint" id="tdh_miss" style="color:var(--bad);font-weight:700">' +
        (s.miss ? I18n.s('Reason likhna baaki hai') + ': ' + s.miss : '') + '</div></div>';

    var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    h += '<div class="card">';
    h += '<div class="hint" style="margin-bottom:8px">Har din ke saamne deduction daal sakte ho — jitna ' +
      'kaam nahi hua utna kaato aur reason likho. Reason ke bina deduction save nahi hoga.</div>';
    h += '<div class="pane" style="max-height:460px">';
    s.dates.forEach(function (d) {
      var row = s.cx.days[d], c = Tada.calc(d, s.cx), dd = s.m[d] || { amt:0, note:'' };
      var amt = Tada.dayTot(c);
      h += '<div class="drow' + (num(dd.amt) > 0 ? ' bad' : '') + '">' +
        '<div class="dr-h"><div class="m">' +
          '<div class="t">' + dmy(d) + ' <span class="hint">' +
            DAY[new Date(d + 'T00:00:00').getDay()] + '</span></div>' +
          '<div class="s">' + esc(Tada.stLbl(row.st)) + ' · ' + esc(row.city || '—') +
            (row.st === 'out' ? ' · ' + Math.max(1, num(row.night)) + ' raat' : '') + '</div></div>' +
        '<span class="pill p-grey">' + inr(amt) + '</span></div>';
      h += '<div class="dr-b">' +
        '<div class="hint">DA ' + inr(c.da) + ' · TA ' + inr(c.ta) +
          (c.lodge ? ' · Lodge ' + inr(c.lodge) : '') + '</div>' +
        (c.why.length ? '<div class="hint">' + esc(c.why.join(' · ')) + '</div>' : '') +
        (row.note ? '<div class="hint">Rep: ' + esc(row.note) + '</div>' : '') +
        c.warn.map(function (w) { return '<div class="hint" style="color:var(--bad);font-weight:700">! ' +
          esc(w) + '</div>'; }).join('') +
        '<div style="display:flex;gap:8px;align-items:flex-end;margin-top:6px">' +
          '<div style="flex:0 0 96px"><label class="f">Deduction ₹</label>' +
            '<input class="in" type="number" min="0" max="' + amt + '" value="' + num(dd.amt) +
            '" onclick="event.stopPropagation()" oninput="Tada.hodSet(\'' + Appr.q(id) + '\',\'' + d +
            '\',\'amt\',this.value)"></div>' +
          '<div style="flex:1 1 auto;min-width:0"><label class="f">Reason (zaroori)</label>' +
            '<input class="in" value="' + esc(dd.note) + '" placeholder="Kyun kaata" ' +
            'onclick="event.stopPropagation()" oninput="Tada.hodSet(\'' + Appr.q(id) + '\',\'' + d +
            '\',\'note\',this.value)"></div></div>' +
        '</div>';
      h += '</div>';
    });
    h += '</div><div class="hint" style="margin-top:8px">List scroll karo — ' + s.dates.length + ' din</div>';
    h += '</div>';

    var editing = Tada.hodEditKey === id, active = can || editing;
    if (!active) {
      h += '<div class="hint">Ye claim abhi decide karne layak nahi hai — rep ke paas hai ya decision ho chuka hai.</div>';
      /* Approved is the one state worth reopening — Returned is already with the rep to fix */
      if (/approved/i.test(r.Status || '')) h += '<div class="btns"><button class="btn ghost sm" ' +
        'onclick="Tada.hodEditStart(\'' + Appr.q(id) + '\')">Approved claim adjust karo</button></div>';
      return h;
    }
    h += (editing ? '<div class="banner b"><span></span><div><b>Adjust mode chalu hai</b><br>' +
      '<span style="font-weight:500">Deduction badlo, phir niche se dobara approve karo — rep ko ' +
      'notification mil jayega.</span></div><div class="btns"><button class="btn ghost sm" ' +
      'onclick="Tada.hodEditCancel()">Cancel</button></div></div>' : '');
    h += '<div class="card tada-bar"><label class="f">Message (rep ko dikhega)</label>' +
      '<input class="in" id="tdh_msg" onclick="event.stopPropagation()" value="' + esc(r.HodRemarks || '') + '">' +
      '<div class="btns"><button class="btn ok" onclick="Tada.hodDo(\'' + Appr.q(id) + '\',\'ok\',this)">Poora approve karo</button>' +
      '<button class="btn bad" onclick="Tada.hodDo(\'' + Appr.q(id) + '\',\'back\',this)">Deduction ke saath wapas bhejo</button></div>' +
      '<div class="hint" style="margin-top:6px">Approve karne par deduction ke baad ka net amount final ' +
      'ho jayega. Wapas bhejne par rep isse theek karke dobara bhej sakta hai.</div></div>';
    return h;
  },
  hodEditStart: function (id) { Tada.hodEditKey = id; render(); },
  hodEditCancel: function () { Tada.hodEditKey = ''; render(); },
  hodDo: function (id, what, el) {
    var r = DB.find('TaDa', id); if (!r) return;
    var s = Tada.hodSum(r);
    if (s.miss) return toast('Har deduction ke saath reason likhna zaroori hai — ' + s.miss + ' baaki hai', 4000);
    if (what === 'back' && !s.ded)
      return toast('Wapas bhejne ke liye kam se kam ek deduction ya message do');
    var m = {}, now = new Date().toISOString();
    Object.keys(s.m).forEach(function (k) {
      if (num(s.m[k].amt) > 0) m[k] = { amt:num(s.m[k].amt), note:s.m[k].note, by:DB.me.name, at:now };
    });
    var msg = val('tdh_msg') || '';
    var ok = what === 'ok';
    return UI.confirm({ icon:'', title:ok ? 'Poora claim approve karein?' : 'Deduction ke saath wapas bhejein?',
      msg:'<b>' + esc(r.EmpName || '') + '</b> — claim ' + inr(s.t.grand) +
        (s.ded ? ', deduction ' + inr(s.ded) + ', net <b>' + inr(s.net) + '</b>' : ', poora amount') + '.',
      ok:ok ? 'Haan, approve' : 'Haan, wapas bhejo', cancel:'Abhi nahi' }).then(function (go) {
      if (!go) return;
      return Busy.run('tadahod_' + id, el, ok ? 'Approve…' : 'Bhej raha hai…', function () {
        return DB.save('TaDa', Object.assign({}, r, Admin.stamp(), {
          Status:ok ? 'Approved' : 'Returned',
          DeductJson:JSON.stringify(m), DeductTotal:s.ded, NetTotal:s.net,
          ReturnedAt:ok ? (r.ReturnedAt || '') : now,
          HodRemarks:msg })).then(function () {
          Log.add('TaDa', ok ? 'Approved' : 'Returned', id, inr(s.net));
          Tada.hod = { id:'', d:{} };
          Tada.hodEditKey = '';
          Nav._c = null; Nav.build(); render();
          toast(ok ? 'TA/DA approved — net ' + inr(s.net) : 'Rep ko wapas bhej diya — ' + inr(s.ded) + ' deduction');
          /* every decision — first time or a later adjust — tells the rep, and ONLY the rep */
          return DB.save('Notify', { Id:uid('NT'), Ts:new Date().toISOString(),
            EmpCode:r.EmpCode, EmpName:r.EmpName, Kind:'TA/DA',
            Title:'TA/DA ' + (ok ? 'approved' : 'returned') + ' — ' + (monthName(r.Month) || r.Month),
            Detail:ok
              ? (s.ded ? 'Net ' + inr(s.net) + ' (' + inr(s.ded) + ' deduct hua)' : inr(s.t.grand) + ' poora approve hua')
              : (s.ded ? inr(s.ded) + ' deduct karke wapas bheja gaya' : 'Wapas bheja gaya'),
            Ref:id, Status:'Open', By:DB.me.name }, { quiet:true });
        });
      });
    });
  }
};


/* ═══════════════ MY DATA — the rep's own reports ═══════════════
   Everything the app has recorded about HIM, downloadable for any stretch of days. The console's Data
   tab is the same machinery (Rep.any) with an employee picker; here the employee is never a choice —
   it is whoever is logged in, checked again on the way out. */
var My = {
  kind:'SecOrders', kinds:['SecOrders'], from:'', to:'',
  /* only reports that belong to ONE employee. Nothing team-wide is offered, so nothing team-wide can
     be asked for. */
  /* [code, label, what it contains]. Only reports that belong to ONE employee — no master ever, and
     nothing team-wide, so nothing team-wide can even be asked for. */
  KINDS:[
    ['SecOrders', 'Order summary (lines ke saath)',
      'Aapke punch kiye har order — store, distributor, SKU, units, MRP value, NSV, billing status aur photo link. SKU lines alag tab me.'],
    ['Eod', 'Mera EOD',
      'Har band kiye din ka row — target vs done (SC / TC / PC, NSO, POSM), MSL aur Non-MSL lines, SKU, units, MRP value, NSV, day-end time aur us din ka photo folder.'],
    ['DayPlan', 'Mere day plans',
      'Roz ka subah ka plan — attendance, working-with, station, town/beat, focus, PJP kya kehta tha, off-PJP, target, aur us din kitna kaam hua. Login time aur day start ke saath.'],
    ['Attendance', 'Meri attendance (day-wise)',
      'Har din ka ek row — Present / Absent / Leave / Weekly off / Holiday / Meeting, time ke saath.'],
    ['Dfr', 'Mera DFR (daily field report)',
      'Har din ka roll-up — us din kitni activity hui aur kitne order bane.'],
    ['FailedVisits', 'Failed visits',
      'Wo saari visits jinme order nahi mila — reason, beat aur photo link ke saath. Failed visit par koi PO nahi banta.'],
    ['BeatCoverage', 'Beat coverage (din-wise)',
      'Har plan kiye din ka ek row — PJP ne kya kaha tha (working-with, state/town/beat, station, week, focus), aap actually kahan gaye, coverage ka verdict (Covered / Different beat / Not covered), aur us din kitna kaam hua.'],
    ['BeatSummary', 'Beat coverage (beat-wise total)',
      'Har beat ka ek row — kitne din plan the, kitne din actually kaam hua, coverage %, aur us beat se kitna business. Kaunsa beat chhoot raha hai, ye isme dikhta hai.'],
    ['PrimaryOrder', 'Primary order — distributor ko kya lena hai',
      'Jin SKU ka order mila hai par distributor ke paas order se kam stock hai — kitna order hua, distributor ke paas kitna hai, aur kitna primary order karna padega. Stock live padha jata hai, isliye download se pehle thoda time lagta hai.'],
    ['NewStores', 'Naye outlet',
      'Aapke khole hue shop — id, type, state/town/beat, distributor code aur naam, address, pincode, category, owner, day sale, monthly turnover, photo link aur tracker status.'],
    ['PosmAudit', 'POSM audit',
      'Store-wise POSM check — client id, store code, element, type, location, brand, asset type, install period, dominance, condition, visibility, action aur photo link.'],
    ['PosmRequirement', 'POSM requirement',
      'Kis store ko kaunsa POSM chahiye — element, type, brand, qty, needed-by, photo link aur status.'],
    ['TaDaDays', 'Mera TA / DA (day-wise)',
      'Har claim kiye din ka alag row — day type, city, DA, TA, lodging, nights, us din ka total, HOD deduction aur net.'],
    ['Deviation', 'Plan change requests',
      'Approved PJP se hatt kar kaam karne ki request — PJP kya kehta tha, aap ne kya maanga, aur HOD ka decision.'],
    ['StockRemark', 'Stock remarks',
      'Store ya distributor stock par aapke likhe note.'],
    ['Photos', 'Meri photos',
      'Aapki li hui har photo ka row — module, store, slot, filename, photo ka link aur uske shop folder ka link.']],
  lbl: function (k) {
    var x = My.KINDS.filter(function (y) { return y[0] === k; })[0];
    return x ? x[1] : k;
  },
  range: function () {
    var t = today();
    var f = My.from, o = My.to;
    if (!f && !o) { var d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 29); f = iso(d); o = t; }
    if (!f) f = o; if (!o) o = f;
    if (f > o) { var x = f; f = o; o = x; }
    if (o > t) o = t;
    return [f, o];
  },
  /* MY rows, and only mine: the code is not a parameter, and every row is re-checked here */
  rows: function (kind, r) {
    var me = String(DB.me.code || '').trim().toUpperCase();
    if (!me) return [];
    return Rep.anyRows(kind, me, r[0], r[1]).filter(function (x) {
      return String(x.EmpCode || '').trim().toUpperCase() === me; });
  },
  html: function () {
    var r = My.range(), kinds = My.kinds;
    var per = kinds.map(function (k) { return [k, My.rows(k, r).length]; });
    var rows = per.reduce(function (a, x) { return a + x[1]; }, 0);
    var h = UI.head('', 'Mera data',
      'Apni koi bhi report — ek ya kai — jitne din ki chahiye, Excel me. Sirf aapka data jata hai.');
    h += '<div class="card">' +
      UI.multi({ label:'Kaun kaun si report', sub:'Ek se zyada chuno — har ek apne tab me aayegi',
        items:My.KINDS.map(function (k) { return [k[0], k[1], k[2] || '']; }), sel:kinds,
        tgl:'My.tgl', all:'My.all', max:230 }) +
      '<div class="pair" style="margin-top:10px">' +
        '<div><label class="f">From</label><input class="in" type="date" max="' + today() +
          '" value="' + esc(r[0]) + '" onchange="My.set(\'from\',this.value)"></div>' +
        '<div><label class="f">To</label><input class="in" type="date" max="' + today() +
          '" value="' + esc(r[1]) + '" onchange="My.set(\'to\',this.value)"></div></div>' +
      /* From / To and one download button — nothing else. The "Last 30 din" / "Ye month" shortcuts are
         gone: they were a second way to set the same two dates, and a rep who wanted a fortnight or a
         single day had to undo one of them first. The dates default to the last 30 days anyway. */
      '<div class="hint" style="margin-top:8px">' + rows + ' row milenge — ' + kinds.length +
        ' report · ' + dmy(r[0]) + ' – ' + dmy(r[1]) + '</div>' +
      '<div class="btns"><button class="btn" onclick="My.dl(this)"' +
        (kinds.length && rows ? '' : ' disabled') + '>Excel download</button></div>' +
      '</div>';

    /* what is in there, before downloading it */
    h += '<div class="sec-title">Is period me kitna</div><div class="card"><div class="tw"><table><tbody>' +
      My.KINDS.map(function (k) {
        var n = My.rows(k[0], r).length;
        return '<tr' + (kinds.indexOf(k[0]) >= 0 ? ' class="me"' : '') + '><td>' + esc(k[1]) + '</td>' +
          '<td class="num">' + n + '</td></tr>'; }).join('') +
      '</tbody></table></div>' +
      '<div class="hint" style="margin-top:8px">Ye sirf aapke rows hain — team ka data kabhi nahi ' +
      'aata. Kisi aur ka data chahiye to HOD se maango.</div></div>';
    return h;
  },
  tgl: function (v) {
    var a = My.kinds.slice(), i = a.indexOf(v);
    if (i >= 0) a.splice(i, 1); else a.push(v);
    My.kinds = a; render();
  },
  all: function (on) { My.kinds = on ? My.KINDS.map(function (k) { return k[0]; }) : []; render(); },
  set: function (k, v) { My[k] = v; render(); },
  dl: function (el) {
    var r = My.range(), me = String(DB.me.code || '').trim().toUpperCase();
    if (!me) return toast('Login phir se karo');
    var kinds = My.kinds.slice();
    if (!kinds.length) return toast('Pehle report chuno');
    return Busy.run('mydl', el, 'Ban raha hai…', function () {
      /* the Primary Order report needs each distributor's live stock — fetch it before building */
      return Rep.primaryWarm(kinds, me, r[0], r[1]).then(function () {
        /* the code is STILL not a parameter he can choose — it is who is logged in, every time */
        var f = kinds.length === 1 ? Rep.any(kinds[0], me, r[0], r[1])
                                   : Rep.some(kinds, me, r[0], r[1]);
        Log.add('Data', 'Downloaded ' + kinds.join(','), me, r[0] + '..' + r[1]);
        toast('Download shuru — ' + kinds.length + ' report');
        return f;
      });
    });
  }
  /* My.dlAll is gone with the "Sab reports (ek file)" button: the report picker is multi-select, so
     "everything" is already Select-all + Excel download — one button, not two doing the same job. */
};

/* ═══════════════ APPROVALS — "meri requests" ═══════════════
   One place where a rep sees every approval they have ever asked for, and exactly when each step
   happened: request bheja at X, HOD decided at Y, and (for a PJP) published to Master_PJP at Z.
   Read-only: it is built purely from the rows the sheet already returns — PjpDraft, Deviation,
   NewStores and TaDa — so it can never disagree with what HOD sees in the Admin console.
   Older rows may have no SubmittedAt (it used to get blanked by a partial autosave); for those the
   last-updated stamp is shown with a ≈ so the time is never presented as more exact than it is. */
var Appr = {
  filter:'all', kindF:'all',
  open:{},
  /* Store openings and POSM requirements are NOT approvals any more — the rep opens the outlet, asks
     his ASM himself and records the stage in the Tracker tab. They deliberately do not appear here. */
  KINDS:[['PJP', 'PJP'], ['Plan change', 'Plan change'],
         ['Order', 'Orders'], ['TA/DA', 'TA/DA']],
  /* one flat pastel tag per TYPE — never red/green, those are reserved for pass/fail elsewhere */
  KCLS:{ 'PJP':'k-pjp', 'Plan change':'k-plan', 'Order':'k-ord', 'TA/DA':'k-tada' },
  kcls: function (k) { return Appr.KCLS[k] || 'k-pjp'; },

  ts: function (v) {
    if (v === undefined || v === null || v === '') return 0;
    if (typeof v === 'number') return v > 1e12 ? v : (v > 1e9 ? v * 1000 : 0);   // ms or seconds
    var s = String(v).trim();
    if (/^\d{10}$/.test(s) || /^\d{13}$/.test(s)) return Appr.ts(+s);
    var t = new Date(s).getTime();
    return isNaN(t) ? 0 : t;
  },
  when: function (v) {
    var t = Appr.ts(v); if (!t) return '';
    var d = new Date(t), p = function (n) { return ('0' + n).slice(-2); };
    var h = d.getHours(), ap = h >= 12 ? 'PM' : 'AM';
    return p(d.getDate()) + '-' + p(d.getMonth() + 1) + '-' + d.getFullYear() + ', ' +
           p(((h + 11) % 12) + 1) + ':' + p(d.getMinutes()) + ' ' + ap;
  },
  /* how long, in words a salesman reads at a glance */
  gap: function (ms) {
    ms = Math.max(0, ms);
    var mi = Math.round(ms / 6e4);
    if (mi < 1) return 'kuch second';
    if (mi < 60) return mi + ' minute';
    var hr = Math.floor(mi / 60), rm = mi % 60;
    if (hr < 24) return hr + ' ghante' + (rm ? ' ' + rm + ' min' : '');
    var dd = Math.floor(hr / 24), rh = hr % 24;
    return dd + ' din' + (rh ? ' ' + rh + ' ghante' : '');
  },
  norm: function (st) {
    var s = String(st || '').toLowerCase();
    /* "Partially Rejected" must not be read as either a clean approval or a full rejection: the rep
       has to fix only the ticked days, and the queue has to keep it visible as still-open work. */
    if (/partial/.test(s)) return 'partial';
    /* a TA/DA the HOD sent back with deductions is the same shape of work: it is the rep's move now,
       it must stay visible in his to-do, and no HOD may decide it again until he re-sends */
    if (/return/.test(s)) return 'partial';
    if (/approv/.test(s)) return 'approved';
    if (/reject|declin/.test(s)) return 'rejected';
    if (/draft/.test(s)) return 'draft';
    return 'pending';
  },
  LBL:{ approved:['Approved','p-ok'], rejected:['Rejected','p-bad'],
        pending:['HOD ke paas','p-warn'], draft:['Bheja nahi','p-grey'],
        partial:['Partly rejected','p-bad'], open:['Naya','p-open'], closed:['Dekh liya','p-closed'] },
  /* Coverage is "done/need"; guard against the old rows where Sheets read "9/9" as a date */
  cover: function (v) { var s = String(v || '').trim(); return /^\d+\s*\/\s*\d+$/.test(s) ? s : ''; },
  /* row keys go straight into an inline onclick — keep them attribute-safe */
  jid: function (v) { return String(v == null ? '' : v).replace(/[^\w.:-]/g, '_'); },
  /* the RAW key also goes into an onclick, so escape it for a JS single-quoted string */
  q: function (v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); },

  /* Admin/HOD can decide right here, through the SAME handlers the Admin console uses — so the two
     screens can never disagree. Without this an HOD saw "HOD ke paas hai" and had no way to act. */
  ACTABLE:['pjp','dev','tada'],
  /* A partially rejected request is WITH THE REP: he has days to fix and re-send. Until he does,
     there is nothing for an HOD to approve or reject — and a stray tap would decide a month whose
     rejected days have already been changed underneath it. */
  can: function (o) { return Auth.isAdmin() && o.status === 'pending' &&
    Appr.ACTABLE.indexOf(o.act) >= 0; },
  act: function (kind, key, ok) {
    if (kind === 'pjp')  return ok ? Admin.pjpOk(key) : Admin.pjpNo(key);
    if (kind === 'dev')  return Admin.devOk(key, ok ? 1 : 0);
    if (kind === 'tada') return Admin.tadaOk(key, ok);
  },
  btns: function (o, big) {
    if (!Appr.can(o)) return '';
    /* ── a PJP is a MONTH, not a yes/no ──
       Approve and Reject at the top open the plan instead of deciding it: the HOD reads the days, ticks
       the ones that are wrong, and commits at the bottom — where "reject only these days" lives. A
       month approved from a collapsed card is a month nobody read. */
    if (o.act === 'pjp' || o.act === 'tada') {
      var r = 'onclick="event.stopPropagation();Appr.review(\'' + o.id + '\',';
      if (o.act === 'tada') return big
        ? '<div class="btns"><button class="btn ok" ' + r + '\'ok\')">Poora claim dekho</button>' +
          '<button class="btn bad" ' + r + '\'no\')">Deduction lagao</button></div>'
        : '<div style="display:flex;gap:6px;flex:0 0 auto">' +
          '<button class="btn ok xs" ' + r + '\'ok\')">Dekho</button>' +
          '<button class="btn bad xs" ' + r + '\'no\')">Deduct</button></div>';
      return big
        ? '<div class="btns"><button class="btn ok" ' + r + '\'ok\')">Approve — plan dekho</button>' +
          '<button class="btn bad" ' + r + '\'no\')">Reject — plan dekho</button></div>'
        : '<div style="display:flex;gap:6px;flex:0 0 auto">' +
          '<button class="btn ok xs" ' + r + '\'ok\')">Approve</button>' +
          '<button class="btn bad xs" ' + r + '\'no\')">Reject</button></div>';
    }
    var c = 'onclick="event.stopPropagation();Appr.act(\'' + o.act + '\',\'' + Appr.q(o.key) + '\',';
    /* the compact pair used to be a bare ✓ / ✗ pill; with the glyphs gone they need words, or an HOD
       is choosing between two blank buttons */
    return big
      ? '<div class="btns"><button class="btn ok" ' + c + '1)">Approve karo</button>' +
        '<button class="btn bad" ' + c + '0)">Reject karo</button></div>'
      : '<div style="display:flex;gap:6px;flex:0 0 auto"><button class="btn ok xs" ' + c + '1)">Approve</button>' +
        '<button class="btn bad xs" ' + c + '0)">Reject</button></div>';
  },
  /* open the month and take the reader to the decision bar under it */
  review: function (id, want) {
    Appr.open[id] = true;
    render();
    setTimeout(function () {
      var b = document.querySelector('#view .pjp-bar') || document.querySelector('#view .tada-bar');
      if (b && b.scrollIntoView) b.scrollIntoView({ block:'center' });
    }, 60);
    var kind = (Appr.list().filter(function (x) { return x.id === id; })[0] || {}).act;
    if (kind === 'tada')
      toast(want === 'no' ? 'Poora claim dekho — jis din ka kaam nahi hua uspar deduction daalo'
                          : 'Poora claim dekho — niche se poora approve karo', 3800);
    else toast(want === 'no' ? 'Poora plan dekho — niche se poora month ya sirf kuch din reject karo'
                             : 'Poora plan dekho — niche se approve karo', 3800);
  },

  list: function () {
    var admin = Auth.isAdmin(), out = [];
    var pick = function (tab) { return admin ? DB.rows(tab) : DB.mine(tab); };

    pick('PjpDraft').forEach(function (d) {
      var st = Appr.norm(d.Status), cv = Appr.cover(d.Coverage);
      out.push({ id:'pjp_' + Appr.jid(d.Key), icon:'', kind:'PJP', go:'pjp', status:st,
        act:'pjp', key:d.Key,
        title:'PJP — ' + (monthName(d.Month) || d.Month || ''),
        emp:d.EmpName || '',
        sent:d.SubmittedAt || '', sentAlt:(st === 'draft' ? '' : d.UpdatedAt || d.LastSync || ''),
        done:d.HodAt || '', by:d.HodBy || '', role:d.HodRole || '',
        note:(st === 'rejected' || st === 'partial') ? (d.RejectReason || '') : '',
        rejDays:Admin.rejDays(d),
        rows:[['Month', monthName(d.Month) || d.Month || '—'],
              ['Field din bhare', cv || '—'],
              ['Publish', d.PublishedAt ? (Appr.when(d.PublishedAt) +
                (d.PublishedRows ? ' · ' + d.PublishedRows + ' din Master_PJP me' : '')) : '—']],
        sum:st === 'draft' ? 'HOD ko abhi bheja nahi gaya hai'
          : st === 'partial' ? (Admin.rejDays(d).length || 0) + ' din reject hue hain — theek karke dobara bhejo'
          : st === 'approved' ? (cv ? cv + ' din bhare · ' : '') + 'Approved — Master_PJP me chala gaya'
          : st === 'rejected' ? 'HOD ne reject kiya' + (d.RejectReason ? ': ' + d.RejectReason : '')
          : 'HOD ke approval ka wait hai',
        tip:st === 'draft' ? 'Ye abhi draft hai — PJP tab se HOD ko bhejo.'
          : st === 'partial' ? 'PJP tab me sirf reject wale din khule hain — theek karke dobara bhejo.'
          : st === 'approved' ? 'Approved plan Master_PJP me chala gaya — Plan tab me roz dikhega.' : '' });
    });

    pick('Deviation').forEach(function (d) {
      var st = Appr.norm(d.Status);
      out.push({ id:'dev_' + Appr.jid(d.Id), icon:'', kind:'Plan change', go:'plan', status:st,
        act:'dev', key:d.Id,
        title:'Plan change — ' + dmy(d.Date),
        emp:d.EmpName || '',
        sent:d.Ts || '', sentAlt:d.UpdatedAt || d.LastSync || '',
        done:d.HodAt || '', by:d.HodBy || '', role:d.HodRole || '',
        note:d.HodRemarks || '',
        rows:[['PJP me tha', (d.PlannedTown || '—') + ' / ' + (d.PlannedBeat || '—')],
              ['Aap ne maanga', (d.NewTown || '—') + ' / ' + (d.NewBeat || '—')],
              ['Station', Pjp.stn(d.NewStation)],
              ['Aapka reason', d.Reason || '—']],
        sum:'Chaha: ' + (d.NewTown || '—') + ' / ' + (d.NewBeat || '—') +
          (d.Reason ? ' — ' + d.Reason : ''),
        tip:st === 'rejected' ? 'Ye beat dobara request nahi kar sakte — koi dusra beat chuno.' : '' });
    });

    /* NewStores and PosmRequirement used to be listed here for HOD approval. They are now purely the
       employee's own follow-up — see the Tracker tab — so nothing about them belongs in a queue. */

    /* Orders are not approvals, but an HOD chasing billing needs the same one screen.
       Only shown to admin/HOD, and the action is a status change, not approve/reject. */
    if (admin) DB.rows('SecOrders').forEach(function (o) {
      var s2 = String(o.Status || ''), map = /Billing/.test(s2) ? 'approved'
        : /Cancel/.test(s2) ? 'rejected' : /No Order/.test(s2) ? 'rejected' : 'pending';
      out.push({ id:'so_' + Appr.jid(o.PoNumber), icon:'', kind:'Order', go:'trk',
        status:map, act:'so', key:o.PoNumber, statusText:s2,
        title:'Order — ' + (o.StoreName || ''),
        emp:o.EmpName || '',
        sent:o.Ts || '', sentAlt:o.Date || o.LastSync || '',
        done:o.HodAt || o.DeliveredAt || '', by:o.HodBy || '', role:o.HodRole || '', note:o.Remarks || '',
        rows:[['PO', o.PoNumber || '—'], ['Date', dmy(o.Date)],
              ['Status', s2 || '—'],
              ['SKU / Units', num(o.TotSku) + ' / ' + num(o.TotUnits)],
              ['MRP value', inr(o.TotValue)],
              ['NSV', lakh(o.TotNsvLakh) + ' L']],
        sum:(s2 || 'Pending') + ' · ' + num(o.TotSku) + ' SKU / ' + num(o.TotUnits) +
          ' units · ' + inr(o.TotValue),
        tip:'' });
    });

    pick('TaDa').forEach(function (r) {
      out.push({ id:'tada_' + Appr.jid(r.Id), icon:'', kind:'TA/DA', go:'home', status:Appr.norm(r.Status),
        title:'TA/DA — ' + (monthName(r.Month) || r.Month || dmy(r.Date)),
        emp:r.EmpName || '',
        sent:r.Date || '', sentAlt:r.UpdatedAt || r.LastSync || '',
        act:'tada', key:r.Id,
        done:r.HodAt || '', by:r.HodBy || '', role:r.HodRole || '', note:r.HodRemarks || '',
        rows:num(r.DeductTotal)
          ? [['Claim', inr(r.Total)], ['Deduction', '− ' + inr(r.DeductTotal)],
             ['Net payable', inr(r.NetTotal || (num(r.Total) - num(r.DeductTotal)))]]
          : [['Claim total', inr(r.Total)]].concat(num(r.Nights)
              ? [['Outstation nights', String(num(r.Nights))]] : []),
        sum:'Claim ' + inr(r.Total) + (num(r.DeductTotal) ? ' · deduction ' + inr(r.DeductTotal) : ''),
        tip:'' });
    });

    /* HOD-initiated changes with no decision of their own pending — an approved PJP day edited
       after the fact, for now. Same one feed, its own kind colour, Open until the rep dismisses it. */
    pick('Notify').forEach(function (n) {
      out.push({ id:'nt_' + Appr.jid(n.Id), icon:'', kind:n.Kind || 'PJP', go:'home',
        status:String(n.Status || 'Open').toLowerCase() === 'closed' ? 'closed' : 'open',
        act:'notify', key:n.Id,
        title:n.Title || 'Update',
        emp:n.EmpName || '',
        sent:n.Ts || '', sentAlt:n.LastSync || '',
        done:'', by:n.By || '', role:'', note:n.Detail || '',
        rows:[['Detail', n.Detail || '—'], ['By', n.By || '—']],
        sum:String(n.Detail || '').split('\n')[0] || '',
        tip:'' });
    });

    out.forEach(function (o) {
      o.sentT = Appr.ts(o.sent) || Appr.ts(o.sentAlt);
      o.approx = !Appr.ts(o.sent) && !!Appr.ts(o.sentAlt);
      o.doneT = Appr.ts(o.done);
      o.oc = Appr.openClosed(o);
    });
    return out.sort(function (a, b) { return (b.sentT || 0) - (a.sentT || 0); });
  },

  html: function () {
    var all = Appr.list();
    /* For a rep this screen is deliberately READ-ONLY for a request: it is the record of what he
       asked for and what came back. A notification is his to dismiss, nothing else here is. */
    var h = UI.head('', Auth.isAdmin() ? 'Notifications — poori team' : 'Meri notifications',
      Auth.isAdmin() ? 'Jo bhi aaya hai — request ho ya sirf ek update — sab ek jagah, type se colour hai. Kisi bhi card par tap karo.'
        : 'Jo bheja hai aur jo HOD ne update kiya, sab ek jagah. Kisi bhi card par tap karke detail dekho.');

    /* TYPE and STATUS — two plain dropdowns, not a row of chips. The count against an option is what
       still NEEDS THIS PERSON (open, undecided), never a total: a finished item is not a to-do. */
    var todo = all.filter(Appr.todo).length;
    var kinds = [['all', 'Sab', todo]];
    Appr.KINDS.forEach(function (k) {
      var g = all.filter(function (o) { return o.kind === k[0]; });
      if (!g.length) return;
      kinds.push([k[0], k[1], g.filter(Appr.todo).length]);
    });
    var byKind = all.filter(function (o) { return Appr.kindF === 'all' || o.kind === Appr.kindF; });
    var oc2 = { open:0, closed:0 };
    byKind.forEach(function (o) { oc2[o.oc]++; });
    var chips = [['all', 'Sab', 0], ['open', 'Open', oc2.open], ['closed', 'Closed', 0]];
    h += '<div class="card" style="padding:10px"><div class="row two">' +
      '<div><label class="f">Type</label><select class="in" onchange="Appr.setKind(this.value)">' +
        kinds.map(function (c) {
          return '<option value="' + esc(c[0]) + '"' + (Appr.kindF === c[0] ? ' selected' : '') + '>' +
            esc(c[1]) + (c[2] ? ' (' + (c[2] > 99 ? '99+' : c[2]) + ')' : '') + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label class="f">Status</label><select class="in" onchange="Appr.set(this.value)">' +
        chips.map(function (c) {
          return '<option value="' + esc(c[0]) + '"' + (Appr.filter === c[0] ? ' selected' : '') + '>' +
            esc(c[1]) + (c[2] ? ' (' + (c[2] > 99 ? '99+' : c[2]) + ')' : '') + '</option>'; }).join('') +
      '</select></div></div></div>';

    var show = byKind.filter(function (o) { return Appr.filter === 'all' || o.oc === Appr.filter; });
    if (!show.length) {
      h += UI.empty('', all.length ? 'Is filter me kuch nahi hai' :
        'Abhi tak koi request nahi bheji. PJP ya plan change bhejoge to yahan dikhega.');
      return h;
    }

    h += '<div class="sec-title">' + show.length + ' item' + (show.length > 1 ? 's' : '') + '</div>';
    h += show.map(Appr.card).join('');
    h += '<div class="card"><div class="btns"><button class="btn ghost" onclick="Sync.now(true)"> Refresh karo</button></div></div>';
    return h;
  },

  card: function (o) {
    var lbl = Appr.LBL[o.status] || Appr.LBL.pending, op = !!Appr.open[o.id];
    var sentTxt = o.sentT ? ((o.approx ? '≈ ' : '') + Appr.when(o.sentT)) : 'Time record nahi hua';
    var h = '<div class="card ap ' + Appr.kcls(o.kind) + (op ? ' op' : '') + '" onclick="Appr.toggle(\'' + o.id + '\')">' +
      '<div class="ap-h"><span class="ap-ic">' + o.icon + '</span>' +
        '<div class="m"><div class="t">' + esc(o.title) + '</div>' +
        '<div class="s"><span class="pill k-pill ' + Appr.kcls(o.kind) + '">' + esc(o.kind) + '</span> · bheja: ' + esc(sentTxt) +
          (Auth.isAdmin() && o.emp ? ' · ' + esc(o.emp) : '') + '</div>' +
          (o.sum ? '<div class="sum">' + esc(o.sum) + '</div>' : '') + '</div>' +
        '<span class="pill ' + lbl[1] + '">' + lbl[0] + '</span>' + Appr.btns(o, false) +
        '<span class="ap-x">' + (op ? '' : '') + '</span></div>';

    /* a notify item is not a request — nothing here was ever pending a decision, so it gets its own
       short branch instead of the approve/reject timeline below */
    if (o.act === 'notify') {
      if (op) {
        h += '<div class="tl"><div class="tl-i ' + (o.status === 'closed' ? 'ok' : 'wait') + '"><b>' +
          esc(o.by ? o.by + ' ne update kiya' : 'Update') + '</b><span>' +
          (o.sentT ? esc(Appr.when(o.sentT)) : 'Time record nahi hua') + '</span></div></div>';
        if (o.note) h += '<div class="banner b" style="margin-top:10px"><span></span><div><b>Kya badla</b><br>' +
          '<span style="font-weight:500;white-space:pre-line;display:block">' + esc(o.note) + '</span></div></div>';
        h += '<div class="btns"><button class="btn ' + (o.status === 'closed' ? 'ghost' : 'ok') + ' sm" ' +
          'onclick="event.stopPropagation();Appr.closeNotify(\'' + o.id + '\')">' +
          (o.status === 'closed' ? 'Dekh liya' : 'Dekh liya \u2014 band karo') + '</button></div>';
      }
      return h + '</div>';
    }

    if (op) {
      /* timeline — step 1 always, step 2 = the decision (or the wait), step 3 = publish/next action */
      h += '<div class="tl">';
      h += '<div class="tl-i ok"><b>Request bheja</b><span>' + esc(sentTxt) +
        (o.approx ? ' <i>(exact time purane row me save nahi hua tha)</i>' : '') + '</span></div>';

      if (o.status === 'partial') {
        h += '<div class="tl-i wait"><b>' + (Auth.isAdmin() ? 'Rep ke paas hai — wapas aane ka wait'
          : 'Theek karke dobara bhejna hai') + '</b><span>' +
          (Auth.isAdmin() ? 'Jab tak rep dobara nahi bhejta, isme kuch decide nahi karna hai.'
            : o.act === 'tada' ? 'TA/DA tab me deduction wale din laal me dikh rahe hain.'
            : 'PJP tab me sirf reject wale din khule hain.') + '</span></div>';
        h += '<div class="tl-i bad"><b>' + (o.act === 'tada' ? 'HOD ne kuch din par deduction lagaya'
          : 'HOD ne kuch din reject kiye') + '</b><span>' +
          (o.doneT ? esc(Appr.when(o.doneT)) + (o.by ? ' · ' + esc(o.by) : '') : 'Time record nahi hua') +
          (o.act === 'tada' ? '<br>Deduction dekho, theek karo ya samjha do, phir dobara bhejo.'
            : '<br>Sirf wo din theek karke dobara bhejo — baaki month waise hi hai.') + '</span></div>';
      } else if (o.status === 'draft') {
        h += '<div class="tl-i wait"><b>HOD ko bheja nahi</b><span>PJP tab se submit karo</span></div>';
      } else if (o.doneT) {
        var dec = o.status === 'approved' ? 'HOD ne approve kiya' : o.status === 'rejected' ? 'HOD ne reject kiya' : 'HOD ne dekha';
        h += '<div class="tl-i ' + (o.status === 'rejected' ? 'bad' : 'ok') + '"><b>' + dec + '</b><span>' +
          esc(Appr.when(o.doneT)) + (o.by ? ' · ' + esc(o.by) : '') +
          (o.sentT ? '<br>' + esc(Appr.gap(o.doneT - o.sentT)) + ' me decision aaya' : '') + '</span></div>';
      } else if (o.status === 'approved' || o.status === 'rejected') {
        h += '<div class="tl-i ' + (o.status === 'rejected' ? 'bad' : 'ok') + '"><b>' +
          (o.status === 'approved' ? 'HOD ne approve kiya' : 'HOD ne reject kiya') +
          '</b><span>Time record nahi hua' + (o.by ? ' · ' + esc(o.by) : '') + '</span></div>';
      } else {
        h += '<div class="tl-i wait"><b>HOD ke decision ka wait</b><span>' +
          (o.sentT ? esc(Appr.gap(Date.now() - o.sentT)) + ' se pending hai' : 'Pending hai') + '</span></div>';
      }
      h += '</div>';

      h += '<table class="ap-t">' + o.rows.map(function (r) {
        return '<tr><td>' + esc(r[0]) + '</td><td><b>' + esc(r[1]) + '</b></td></tr>'; }).join('') + '</table>';
      /* and then what it actually IS — the SKU lines of an order, the days of a claim */
      h += '<div onclick="event.stopPropagation()">' + Appr.detail(o) + '</div>';

      if (o.note) h += '<div class="banner ' + (o.status === 'rejected' ? 'r' : 'b') + '" style="margin-top:10px">' +
        '<span></span><div><b>HOD ka message</b><br><span style="font-weight:500">' + esc(o.note) + '</span></div></div>';
      if (o.tip) h += '<div class="hint" style="margin-top:8px">' + esc(o.tip) + '</div>';
      if (Auth.isAdmin() && o.act === 'so') {
        h += '<label class="f">Order status badlo</label>' +
          '<select class="in" onclick="event.stopPropagation()"' +
          ' onchange="event.stopPropagation();Admin.setOrder(&quot;' + Appr.q(o.key) + '&quot;,this.value)">' +
          ['Order in Process','Billing Done','Cancel Order'].map(function (x) {
            return '<option value="' + x + '"' + (x === o.statusText ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
          '</select>';
      }
      /* the big pair is the way IN to a PJP; with the month already open the decision bar under the
         day list is the only place a decision is made */
      if (o.act !== 'pjp' && o.act !== 'tada') h += Appr.btns(o, true);
      /* A PJP request IS its day list — telling an HOD to "go to that tab" was asking them to
         re-find the thing they had just tapped. Every other kind still gets a jump link. */
      if (o.act === 'pjp') h += '<div onclick="event.stopPropagation()">' + Admin.pjpDays(o.key, Auth.isAdmin()) + '</div>';
      /* a claim is a month of days too: the HOD reads each one and cuts what was not worked */
      else if (o.act === 'tada' && Auth.isAdmin()) h += '<div onclick="event.stopPropagation()">' +
        Tada.hodView(o.key, Appr.can(o)) + '</div>';
      else h += '<div class="btns"><button class="btn ghost sm" onclick="event.stopPropagation();Router.go(\'' +
        o.go + '\')">Open that tab</button></div>';
    }
    return h + '</div>';
  },


  /* ══ what is actually IN this request ══
     The timeline says when it moved; this says what it is. An order shows its SKU lines with MRP,
     units, value and NSV — the numbers an HOD is deciding on — and a claim shows the days it is made
     of. Nobody should have to leave the queue to find out what they are approving. */
  detail: function (o) {
    if (o.act === 'so') return Appr.orderDetail(o);
    /* an HOD gets Tada.hodView below — the same days, with a deduction box on each. Printing both
       would be the same table twice. */
    if (o.act === 'tada') return Auth.isAdmin() ? '' : Appr.tadaDetail(o);
    return '';
  },
  orderDetail: function (o) {
    var ord = DB.rows('SecOrders').filter(function (x) {
      return String(x.PoNumber) === String(o.key); })[0];
    if (!ord) return '';
    var lines = [];
    try { lines = JSON.parse(ord.LinesJson || '[]') || []; } catch (e) {}
    if (!lines.length) lines = DB.rows('SecOrderLines').filter(function (l) {
      return String(l.PoNumber) === String(o.key); });

    var h = '<div class="sec-title" style="margin-top:12px">Order detail</div>' +
      '<table class="ap-t">' +
      '<tr><td>Store</td><td><b>' + esc(ord.StoreName || '—') + '</b></td></tr>' +
      '<tr><td>Store code / city</td><td><b>' + esc(ord.CompanyCode || '—') + ' · ' +
        esc(ord.City || '—') + '</b></td></tr>' +
      '<tr><td>Distributor</td><td><b>' + esc(ord.DbName || '—') + '</b></td></tr>' +
      '<tr><td>Visit type</td><td><b>' + esc(ord.Source || '—') + '</b></td></tr>' +
      (ord.Reason ? '<tr><td>Reason</td><td><b>' + esc(ord.Reason) + '</b></td></tr>' : '') +
      (ord.Remarks ? '<tr><td>Remarks</td><td><b>' + esc(ord.Remarks) + '</b></td></tr>' : '') +
      '</table>';

    if (!lines.length) return h + '<div class="hint" style="margin-top:8px">Is order me koi SKU nahi — ' +
      'ye Cancel Order wala visit hai.</div>';

    var u = 0, v = 0, nsv = 0;
    lines.forEach(function (l) { u += num(l.Units); v += num(l.Value); nsv += num(l.NsvLakh); });
    h += '<div class="tw" style="margin-top:10px"><table><thead><tr><th>SKU</th>' +
      '<th class="num">MRP</th><th class="num">Qty</th><th class="num">MRP value</th>' +
      '<th class="num">NSV ₹L</th></tr></thead><tbody>' +
      lines.map(function (l) {
        return '<tr><td><b class="nm">' + esc(l.SkuName || l.Sku || '—') + '</b>' +
          '<div class="hint">' + esc(l.Brand || '') + (l.Category ? ' · ' + esc(l.Category) : '') +
          (l.MslStatus ? ' · ' + esc(l.MslStatus) : '') + ' · ' + esc(l.Sku || '') + '</div></td>' +
          '<td class="num">' + inr(l.Mrp) + '</td>' +
          '<td class="num">' + num(l.Units) + '</td>' +
          '<td class="num">' + inr(l.Value) + '</td>' +
          '<td class="num">' + lakh(l.NsvLakh) + '</td></tr>'; }).join('') +
      '<tr class="tot"><td><b>TOTAL — ' + lines.length + ' SKU</b></td><td></td>' +
      '<td class="num"><b>' + u + '</b></td><td class="num"><b>' + inr(v) + '</b></td>' +
      '<td class="num"><b>' + lakh(nsv) + '</b></td></tr></tbody></table></div>';
    return h;
  },
  /* the claim, day by day — the same table the rep filled, read-only, with deductions shown in red */
  tadaDetail: function (o) {
    var r = DB.rows('TaDa').filter(function (x) { return String(x.Id) === String(o.key); })[0];
    if (!r) return '';
    var days = {}, ded = {};
    try { days = JSON.parse(r.DaysJson || '{}') || {}; } catch (e) {}
    try { ded = JSON.parse(r.DeductJson || '{}') || {}; } catch (e) {}
    var keys = Object.keys(days).sort();
    var h = '<div class="sec-title" style="margin-top:12px">Claim detail</div>' +
      '<table class="ap-t">' +
      '<tr><td>Month</td><td><b>' + esc(monthName(r.Month) || r.Month || '—') + '</b></td></tr>' +
      '<tr><td>Travel</td><td><b>' + inr(r.TravelAmount) + '</b></td></tr>' +
      '<tr><td>DA / food</td><td><b>' + inr(num(r.DaAmount) + num(r.FoodAmount)) + '</b></td></tr>' +
      (num(r.LodgeAmount) ? '<tr><td>Lodging</td><td><b>' + inr(r.LodgeAmount) + '</b></td></tr>' : '') +
      (num(r.MeetAmount) ? '<tr><td>Meeting</td><td><b>' + inr(r.MeetAmount) + '</b></td></tr>' : '') +
      (num(r.OtherAmount) ? '<tr><td>Other</td><td><b>' + inr(r.OtherAmount) + '</b></td></tr>' : '') +
      '<tr><td>Claim total</td><td><b>' + inr(r.Total) + '</b></td></tr>' +
      (num(r.DeductTotal) ? '<tr><td>Deduction</td><td><b>− ' + inr(r.DeductTotal) + '</b></td></tr>' +
        '<tr><td>Net payable</td><td><b>' + inr(r.NetTotal || (num(r.Total) - num(r.DeductTotal))) +
        '</b></td></tr>' : '') +
      '</table>';
    if (!keys.length) return h;
    h += '<div class="tw" style="margin-top:10px"><table><thead><tr><th>Date</th><th>Station / city</th>' +
      '<th class="num">TA</th><th class="num">DA</th><th class="num">Lodge</th>' +
      '<th class="num">Cut</th></tr></thead><tbody>';
    var ta = 0, da = 0, lo = 0, cut = 0;
    keys.forEach(function (k) {
      var d = days[k] || {}, x = num((ded[k] || {}).amt || ded[k]);
      ta += num(d.ta); da += num(d.da) + num(d.food); lo += num(d.lodge); cut += x;
      h += '<tr' + (x ? ' class="bad"' : '') + '><td>' + dmy(k) + '</td>' +
        '<td>' + esc(Pjp.stn(d.st) || '—') +
        (d.city ? '<div class="hint">' + esc(d.city) + '</div>' : '') + '</td>' +
        '<td class="num">' + inr(d.ta) + '</td>' +
        '<td class="num">' + inr(num(d.da) + num(d.food)) + '</td>' +
        '<td class="num">' + (num(d.lodge) ? inr(d.lodge) : '—') + '</td>' +
        '<td class="num">' + (x ? '− ' + inr(x) : '—') + '</td></tr>';
    });
    h += '<tr class="tot"><td><b>TOTAL</b></td><td></td><td class="num"><b>' + inr(ta) + '</b></td>' +
      '<td class="num"><b>' + inr(da) + '</b></td><td class="num"><b>' + inr(lo) + '</b></td>' +
      '<td class="num"><b>' + (cut ? '− ' + inr(cut) : '—') + '</b></td></tr></tbody></table></div>';
    return h;
  },

  /* Does this row still need action FROM THE PERSON LOOKING?
       Admin/HOD → not yet decided (or, for an order, not yet moved out of "in process").
       Employee   → it came back REJECTED, so they have to redo something. Their own PENDING request
                    needs nothing from them, so it is not counted anywhere. */
  todo: function (o) {
    if (o.act === 'notify') return !Auth.isAdmin() && o.status === 'open';
    return Auth.isAdmin() ? o.status === 'pending' : (o.status === 'rejected' || o.status === 'partial');
  },
  /* the SECOND filter axis — "is this done or not", the same question for all 4 types. A request
     still in the rep's own court (pending / partial / not sent yet) and an unread notification both
     read as Open; everything decided (or dismissed) is Closed. */
  openClosed: function (o) {
    if (o.act === 'notify') return o.status === 'closed' ? 'closed' : 'open';
    return (o.status === 'pending' || o.status === 'partial' || o.status === 'draft') ? 'open' : 'closed';
  },
  /* dismissing a notification is the REP's own move, no HOD decision involved */
  closeNotify: function (id) {
    var it = Appr.list().filter(function (x) { return x.id === id; })[0]; if (!it) return;
    DB.save('Notify', { Id:it.key, Status:'Closed' }, { quiet:true }).then(function () { render(); });
  },

  /* "Approved by Admin" vs "Approved by HOD" — that trail has to be visible */
  who: function (o) { var r = String(o.role || '').trim(); return r ? ' — <i>' + esc(r) + '</i>' : ''; },
  roleTag: function (o) { var r = String(o.role || '').trim(); return r ? ' <b>(' + esc(r) + ')</b>' : ''; },
  bust: function () { Nav._c = null; },
  set: function (f) { Appr.filter = f; render(); },
  setKind: function (k) { Appr.kindF = k; Appr.filter = 'all'; render(); },
  toggle: function (id) { Appr.open[id] = !Appr.open[id]; render(); }
};

/* ═══════════════ ACTIVITY LOG ═══════════════ */
var Log = {
  add: function (kind, action, ref, detail) {
    DB.save('ActivityLog', { Id:uid('LG'), Ts:new Date().toISOString(), Role:(Auth.session() || {}).rights || '',
      Kind:kind, Action:action, Ref:String(ref || ''), Detail:String(detail || '') }, { quiet:true });
  }
};

/* ═══════════════ ADMIN CONSOLE ═══════════════ */
/* what this build of the app needs on the sheet side. Raise it in backend.gs at the same time. */
var NEED_VER = '2.2';
var Admin = {
  /* ══════════════════ THE CONSOLE ══════════════════
     Five tabs, and each one answers a different question:
        Summary    what happened — the total first, then the same numbers per person
        Approvals  what needs me — the one queue (the rep's Requests screen, with the buttons live)
        Users      who may do what — bypass, PJP lock, active, for one person or for everyone
        Data       give me / take out data — a formatted download, and a delete that shows its work
        Preview    what the rep sees
     It used to be eight, and the console duplicated the Approvals screen. Whatever an HOD opens, there
     is exactly one place it lives. */
  tab:'sum',
  /* route on the nav  →  screen in here.  Approvals is not in this map: it is the rep's own
     Requests screen with the buttons live, so the tab goes straight to Appr and there is exactly one
     copy of it in the app. */
  ROUTE:{ admin:'sum', ausers:'users', adata:'data', aprev:'prev' },
  TABS:[['sum', 'Summary', 'admin'], ['appr', 'Approvals', 'appr'], ['users', 'Users', 'ausers'],
        ['data', 'Data', 'adata'], ['prev', 'Preview', 'aprev']],
  HEAD:{ sum:['Summary', 'Aaj kya hua — pehle total, phir har aadmi. Compare bhi yahin se.'],
         users:['Users', 'Kaun kya kar sakta hai — bypass, PJP lock, active/inactive.'],
         data:['Data', 'Report download karo, ya galat data hatao.'],
         prev:['Preview', 'Employee ka aaj ka live screen, jaisa unhe dikh raha hai.'] },
  route: function (t) {
    var x = Admin.TABS.filter(function (y) { return y[0] === t; })[0];
    return x ? x[2] : 'admin';
  },
  html: function () {
    /* the tab is whatever the bar says, so a back/refresh lands on the same screen */
    Admin.tab = Admin.ROUTE[Router.cur] || 'sum';
    var s0 = Auth.session() || {}, hd = Admin.HEAD[Admin.tab] || ['Console', ''];
    var h = UI.head('', hd[0], hd[1] + ' <i>· ' + esc(s0.rights || 'Admin') + '</i>');
    return h + (Admin[Admin.tab] ? Admin[Admin.tab]() : '');
  },
  after: function () {
    /* the version question, once, and only where it matters */
    if (Admin.ROUTE[Router.cur] === 'data') Admin.verCheck();
  },
  /* an in-screen link to another console screen is a real tab change now */
  go: function (t) {
    Admin.emp = ''; Admin.cmpOn = false;
    if (Admin.route(t) === Router.cur) { Admin.tab = t; render(); return; }
    Router.go(Admin.route(t));
  },

  /* ── one period definition for the whole console ── */
  per:'D', from:'', to:'', mon:'',
  month: function () {
    var t = today().slice(0, 7);
    if (!Admin.mon || Admin.mon > t) Admin.mon = t;
    return Admin.mon;
  },
  range: function () {
    var t = today();
    if (Admin.per === 'D') return [t, t];
    if (Admin.per === 'W') {
      if (Admin.from && Admin.to) {
        var a = Admin.from < Admin.to ? Admin.from : Admin.to;
        var b = Admin.from < Admin.to ? Admin.to : Admin.from;
        return [a, b > t ? t : b];
      }
      var d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - 6);
      return [iso(d), t];
    }
    var m = Admin.month(), last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
    return [m + '-01', m === t.slice(0, 7) ? t : iso(last)];
  },
  rangeLbl: function (r) {
    r = r || Admin.range();
    return Admin.per === 'D' && r[0] === r[1] ? dmy(r[0])
      : r[0] === r[1] ? dmy(r[0]) : dmy(r[0]) + ' – ' + dmy(r[1]);
  },
  /* the Data screen's own range: a month is the whole month, future days included. A plan for the 20th
     is a row like any other, and a delete that stops at today could never cover a month — so the month
     draft would always survive the one action that is supposed to remove it. */
  dRange: function () {
    var r = Admin.range();
    if (Admin.per !== 'M') return r;
    var m = Admin.month(), last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
    return [m + '-01', iso(last)];
  },
  months: function () {
    var out = [], m = String(DB.cfg('Go_Live_Month', '2026-07')).slice(0, 7), t = today().slice(0, 7), g = 0;
    while (m <= t && g++ < 60) {
      out.push(m);
      var y = +m.slice(0, 4), n = +m.slice(5, 7) + 1;
      if (n > 12) { n = 1; y++; }
      m = y + '-' + p2(n);
    }
    return out.reverse();
  },
  monLbl: function (m) { return monthName(m).split(' ')[0].slice(0, 3) + ' ' + String(m).slice(2, 4); },
  setPer: function (p) { Admin.per = p; render(); },
  setRange: function (k, v) { Admin[k] = v; Admin.per = 'W'; render(); },
  setMon: function (m) { Admin.mon = m; Admin.per = 'M'; render(); },
  /* the period strip, shared by Summary and Data */
  periodCard: function () {
    return '<div class="card" style="padding:10px">' +
      '<div class="seg">' + [['D', 'Today'], ['W', 'Days'], ['M', 'Month']].map(function (p) {
        return '<button class="' + (Admin.per === p[0] ? 'on' : '') + '" onclick="Admin.setPer(\'' +
          p[0] + '\')">' + esc(p[1]) + '</button>'; }).join('') + '</div>' +
      (Admin.per === 'W' ? '<div class="pair" style="margin-top:8px">' +
        '<div><label class="f">From</label><input class="in" type="date" max="' + today() +
          '" value="' + esc(Admin.from || Admin.range()[0]) +
          '" onchange="Admin.setRange(\'from\',this.value)"></div>' +
        '<div><label class="f">To</label><input class="in" type="date" max="' + today() +
          '" value="' + esc(Admin.to || Admin.range()[1]) +
          '" onchange="Admin.setRange(\'to\',this.value)"></div></div>' : '') +
      (Admin.per === 'M' ? '<div style="margin-top:8px"><label class="f">Month</label>' +
        '<select class="in" onchange="Admin.setMon(this.value)">' + Admin.months().map(function (m) {
          return '<option value="' + m + '"' + (Admin.month() === m ? ' selected' : '') + '>' +
            esc(Admin.monLbl(m)) + '</option>'; }).join('') + '</select></div>' : '') +
      /* the Data screen widens a month to the whole month — the strip has to say the same range as the
         card under it, or one screen contradicts itself */
      '<div class="hint" style="margin-top:8px">' +
        esc(Admin.rangeLbl(Admin.tab === 'data' ? Admin.dRange() : Admin.range())) + '</div></div>';
  },

  /* ══ 1. SUMMARY — the total, then the same numbers per person ══ */
  emp:'',
  sum: function () {
    var r = Admin.range();
    if (Admin.cmpOn) return Admin.periodCard() + Admin.compare(r);
    if (Admin.emp) return Admin.periodCard() + Admin.one(Admin.emp, r);
    var rows = Team.local(r[0], r[1]);
    var plans = DB.rows('DayPlan').filter(function (p) { var d = toISO(p.Date); return d >= r[0] && d <= r[1]; });
    var eods = DB.rows('Eod').filter(function (e) { var d = toISO(e.Date); return d >= r[0] && d <= r[1]; });
    var t = { sc:0, tc:0, pc:0, nsv:0, mrp:0, nso:0 };
    rows.forEach(function (e) { ['sc', 'tc', 'pc', 'nsv', 'mrp', 'nso'].forEach(function (k) { t[k] += num(e[k]); }); });
    var working = rows.filter(function (e) { return e.fieldDays > 0; }).length;
    /* a day is STARTED when the plan went out on WhatsApp — a saved-but-unsent plan is not a start */
    var started = plans.filter(function (p) { return Plan.started(p); }).length;
    var unsent = plans.filter(function (p) { return p.PlanAt && !Plan.started(p); }).length;

    var h = Admin.periodCard();
    h += '<div class="kpis">' +
      UI.kpi(lakh(t.nsv), 'NSV ₹L', 'g') + UI.kpi(inr(t.mrp), 'MRP value', 'b') +
      UI.kpi(t.tc + ' / ' + t.sc, 'TC / SC', t.sc && t.tc >= t.sc ? 'g' : 'b') +
      UI.kpi(t.pc, 'PC (order mila)', 'b') +
      UI.kpi(t.nso, 'Naye outlet', '') + '</div>';
    h += '<div class="kpis k3">' +
      UI.kpi(started + ' / ' + plans.length, 'Din shuru', started ? 'g' : 'r') +
      UI.kpi(unsent, 'Plan bheja nahi', unsent ? 'r' : 'g') +
      UI.kpi(eods.length, 'EOD filed', eods.length ? 'g' : 'w') + '</div>' +
      '<div class="hint" style="margin-top:-4px;margin-bottom:12px">Din shuru = plan WhatsApp par ' +
      'chala gaya. Sirf save karna shuruaat nahi hai.</div>';

    /* the split — one row per person, tap to open them */
    var MK = { L:'Leave', O:'Weekly off', M:'Meeting', H:'Holiday' };
    rows.sort(function (a, b) { return num(b.nsv) - num(a.nsv) ||
      String(a.name || a.code).localeCompare(String(b.name || b.code)); });
    h += '<div class="sec-title">Employee-wise — ' + esc(Admin.rangeLbl()) + '</div><div class="card">' +
      Admin.cmpBar() +
      '<div class="tw"><table><thead><tr><th>✓</th><th>Employee</th><th class="num">SC</th><th class="num">TC</th>' +
      '<th class="num">PC</th><th class="num">NSV ₹L</th><th class="num">MRP value</th><th class="num">NSO</th></tr></thead><tbody>' +
      rows.map(function (e) {
        var mk = String(e.mark || '').toUpperCase().slice(0, 1);
        var away = mk && MK[mk] && !num(e.tc) && !num(e.nsv);
        var cell = function (k, money) {
          if (away) return '<td class="num"><span class="pill p-grey" title="' + MK[mk] + '">' + mk + '</span></td>';
          return '<td class="num">' + (money ? lakh(num(e[k])) : String(Math.round(num(e[k])))) + '</td>';
        };
        /* the tick is its own cell — tapping it must not open the employee behind it.
           No .ck class here: that is display:flex, which on a <td> breaks the column alignment. */
        return '<tr><td style="width:36px" onclick="event.stopPropagation()">' +
          '<input type="checkbox" style="width:28px;height:28px;accent-color:var(--ok)"' +
          (Admin.cmpHas(e.code) ? ' checked' : '') +
          ' aria-label="compare" onchange="Admin.cmpTick(\'' + Appr.q(e.code) + '\',this.checked)"></td>' +
          '<td style="cursor:pointer" onclick="Admin.open(\'' + Appr.q(e.code) + '\')">' +
          esc(e.name || e.code) + '<div class="hint">' + esc(e.code) +
          (e.hq ? ' · ' + esc(e.hq) : '') + ' ›</div></td>' +
          cell('sc') + cell('tc') + cell('pc') + cell('nsv', true) + cell('mrp', true) + cell('nso') + '</tr>';
      }).join('') +
      '<tr class="tot"><td></td><td><b>TOTAL</b></td><td class="num"><b>' + Math.round(t.sc) + '</b></td>' +
      '<td class="num"><b>' + Math.round(t.tc) + '</b></td><td class="num"><b>' + Math.round(t.pc) +
      '</b></td><td class="num"><b>' + lakh(t.nsv) + '</b></td><td class="num"><b>' + inr(t.mrp) +
      '</b></td><td class="num"><b>' + Math.round(t.nso) + '</b></td></tr></tbody></table></div>' +
      /* no markup INSIDE either sentence: a <b> splits the text run and half of it would stay
         Hinglish whatever the dictionary says */
      '<div class="hint" style="margin-top:8px">Naam par tap karo — us employee ka poora din, PJP aur photo dikhega.</div>' +
      '<div class="hint">Tick karke Compare dabao — do ya zyada log side by side.</div>' +
      '<div class="hint">L = leave, O = weekly off, M = meeting.</div>' +
      '<div class="btns"><button class="btn ghost sm" onclick="Admin.go(\'data\')">Excel chahiye? Data tab</button></div>' +
      '</div>';
    return h;
  },
  open: function (code) { Admin.emp = code; render(); window.scrollTo(0, 0); },
  /* one employee, everything about them for the chosen period */
  one: function (code, r) {
    var e = DB.emp(code) || { Code:code, Name:code };
    var rows = Team.local(r[0], r[1]).filter(function (x) { return String(x.code).toUpperCase() === String(code).toUpperCase(); });
    var me = rows[0] || { sc:0, tc:0, pc:0, nsv:0, nso:0, fieldDays:0, leave:0, off:0, meet:0 };
    var mine = function (tab) { return DB.rows(tab).filter(function (x) {
      var d = toISO(x.Date);
      return String(x.EmpCode || '').toUpperCase() === String(code).toUpperCase() && d >= r[0] && d <= r[1]; }); };
    var ord = mine('SecOrders');

    var h = '<div class="card"><div class="lrow" style="padding-top:0">' +
      '<button class="btn ghost sm" style="flex:0 0 auto" onclick="Admin.emp=\'\';render()">‹ Sab employee</button>' +
      '<div class="m" style="text-align:right"><div class="t">' + esc(e.Name || code) + '</div>' +
      '<div class="s">' + esc(code) + ' · ' + esc(e.Designation || '') + ' · ' + esc(e.HQ || '') + '</div></div></div>' +
      '<div class="hint">HOD ' + esc(e.HodName || '—') + ' · ASM ' + esc(e.AsmName || '—') +
      ' · joining ' + esc(dmy(DB.doj(code)) || '—') + '</div></div>';

    h += '<div class="kpis k3">' + UI.kpi(lakh(num(me.nsv)), 'NSV ₹L', 'g') +
      UI.kpi(num(me.tc) + ' / ' + num(me.sc), 'TC / SC', 'b') +
      UI.kpi(num(me.pc), 'PC', 'b') + UI.kpi(inr(num(me.mrp)), 'MRP value', 'b') + '</div>';
    var st = mine('DayPlan').filter(function (p) { return Plan.started(p); }).length;
    h += '<div class="kpis k3">' + UI.kpi(num(me.fieldDays), 'Field din', 'b') +
      UI.kpi(st + ' / ' + num(me.fieldDays), 'Din shuru', st ? 'g' : 'r') +
      UI.kpi(mine('Eod').length, 'EOD', mine('Eod').length ? 'g' : 'w') + '</div>';

    /* the day-by-day of the period */
    h += '<div class="sec-title">Din-wise</div><div class="card"><div class="pane" style="max-height:320px">' +
      '<table><thead><tr><th>Date</th><th>Plan</th><th>Beat</th><th class="num">Calls</th>' +
      '<th class="num">NSV L</th><th>EOD</th></tr></thead><tbody>';
    var d0 = new Date(r[0] + 'T00:00:00'), seen = 0;
    for (var g = 0; g < 62; g++) {
      var k = iso(d0); if (k > r[1]) break;
      d0.setDate(d0.getDate() + 1);
      var pl = DB.find('DayPlan', code + '_' + k) || DB.pjpFor(code, k) || null;
      var oo = ord.filter(function (x) { return toISO(x.Date) === k; });
      var ed = DB.rows('Eod').filter(function (x) { return toISO(x.Date) === k &&
        String(x.EmpCode || '').toUpperCase() === String(code).toUpperCase(); })[0];
      if (!pl && !oo.length && !ed) continue;
      seen++;
      var ww = (pl && (pl.WorkingWith || pl.Ww || pl.Week)) || '—';
      h += '<tr><td>' + dmy(k) + '</td><td>' + esc(String(ww).slice(0, 18)) + '</td>' +
        '<td>' + esc(((pl && (pl.Town || '')) + ' / ' + (pl && (pl.Beat || ''))).slice(0, 24)) + '</td>' +
        '<td class="num">' + oo.length + '</td>' +
        '<td class="num">' + lakh(oo.reduce(function (a, x) { return a + num(x.TotNsvLakh); }, 0)) + '</td>' +
        '<td>' + (ed ? '<span class="pill p-ok">yes</span>' : '<span class="pill p-grey">—</span>') + '</td></tr>';
    }
    h += '</tbody></table></div>' + (seen ? '' : UI.empty('', 'Is period me kuch record nahi')) + '</div>';

    /* their PJP month, with the adherence marking */
    h += Admin.pjpOne(code, Admin.per === 'M' ? Admin.month() : r[0].slice(0, 7));
    h += Admin.adh(code, Admin.per === 'M' ? Admin.month() : r[0].slice(0, 7));
    /* and their photos for the period */
    h += Admin.pics(code, r);
    return h;
  },

  /* ══ 2. APPROVALS — the same screen the rep sees, with the buttons live ══ */

  /* ══ COMPARE — one, two or six people side by side ══
     Tick people in the Employee-wise table (or add them here) and every metric lines up in one
     column each. The leader of a row is marked; with exactly two picked there is also a plain-words
     verdict, because "who is ahead, and by how much" is the actual question being asked. */
  cmp:[], cmpOn:false, CMPMAX:6,
  cmpHas: function (code) { return Admin.cmp.indexOf(String(code || '').toUpperCase()) >= 0; },
  cmpTick: function (code, on) {
    var c = String(code || '').toUpperCase(), i = Admin.cmp.indexOf(c);
    if (!c) return;
    if (on && i < 0) {
      if (Admin.cmp.length >= Admin.CMPMAX) {
        toast('Ek baar me ' + Admin.CMPMAX + ' log — pehle kisi ko hatao'); render(); return;
      }
      Admin.cmp.push(c);
    } else if (!on && i >= 0) Admin.cmp.splice(i, 1);
    render();
  },
  cmpAddSel: function (v) {
    var c = Admin.codeOf(v);
    if (c) Admin.cmpTick(c, true); else render();
  },
  cmpClear: function () { Admin.cmp = []; Admin.cmpOn = false; render(); },
  cmpShow: function () {
    if (!Admin.cmp.length) return toast('Pehle kisi ko tick karo');
    Admin.cmpOn = true; Admin.emp = ''; render(); window.scrollTo(0, 0);
  },
  cmpBack: function () { Admin.cmpOn = false; render(); window.scrollTo(0, 0); },
  /* the strip over the Employee-wise table: what is ticked, and the way in */
  cmpBar: function () {
    var n = Admin.cmp.length;
    return '<div class="lrow" style="padding-top:0"><div class="m">' +
      '<div class="t">Compare' + (n ? ' (' + n + ')' : '') + '</div>' +
      '<div class="s">' + (n ? Admin.cmp.map(function (c) {
          return esc(Admin.shortName(c)); }).join(', ')
        : 'Neeche kisi bhi 2–' + Admin.CMPMAX + ' logon ko tick karo — side by side dikhega') +
      '</div></div>' +
      (n ? '<button class="btn ghost sm" style="flex:0 0 auto" onclick="Admin.cmpClear()">Clear</button>' : '') +
      '<button class="btn sm" style="flex:0 0 auto" onclick="Admin.cmpShow()"' + (n ? '' : ' disabled') +
        '>Compare</button></div>';
  },
  shortName: function (code) {
    var e = DB.emp(code) || {};
    var nm = String(e.Name || code || '').trim();
    return nm.split(/\s+/)[0] || String(code || '');
  },
  /* every comparable number for ONE employee over the chosen range.
     `t` is that employee's row out of Team.local, so the totals here can never disagree with the
     table they were ticked in. */
  cmpM: function (code, r, t) {
    var C = String(code || '').trim().toUpperCase();
    var e = t || { sc:0, tc:0, pc:0, nsv:0, nso:0, fieldDays:0, leave:0, off:0, meet:0 };
    var mine = function (tab) { return DB.rows(tab).filter(function (x) {
      var d = toISO(x.Date);
      return String(x.EmpCode || '').trim().toUpperCase() === C && d >= r[0] && d <= r[1]; }); };
    var visit = 0, tel = 0, day = {};
    mine('SecOrders').forEach(function (o) {
      if (/telephonic|phone/i.test(String(o.Source || ''))) tel++; else visit++;
      var d = toISO(o.Date);
      if (!day[d]) day[d] = { tc:0, nsv:0 };
      day[d].tc++;
      if (!Home.cancelled(o.Status)) day[d].nsv += num(o.TotNsvLakh);
    });
    /* the day is "started" only once the WhatsApp plan actually went out */
    var start = mine('DayPlan').filter(function (p) { return !!(p.StartAt || p.NotifiedAt); }).length;
    var a = Admin.cmpAdh(C, r), em = DB.emp(C) || {};
    return { code:C, name:em.Name || e.name || C, hq:em.HQ || e.hq || '',
      sc:num(e.sc), tc:num(e.tc), pc:num(e.pc), nsv:num(e.nsv), nso:num(e.nso),
      field:num(e.fieldDays), leave:num(e.leave), off:num(e.off), meet:num(e.meet),
      start:start, visit:visit, tel:tel, posm:mine('PosmAudit').length, eod:mine('Eod').length,
      strike:num(e.tc) ? num(e.pc) / num(e.tc) * 100 : 0,
      perDay:num(e.fieldDays) ? num(e.nsv) / num(e.fieldDays) : 0,
      work:a.work, missed:a.missed, adh:a.work ? a.ok / a.work * 100 : 0, day:day };
  },
  /* PJP adherence over a RANGE, by the same rule the rep sees on his own Summary:
     an admin's mark wins; otherwise a planned field day with no work at all is a miss. */
  cmpAdh: function (code, r) {
    var C = String(code || '').trim().toUpperCase(), out = { work:0, ok:0, missed:0 };
    var worked = {};
    DB.rows('SecOrders').forEach(function (o) {
      if (String(o.EmpCode || '').trim().toUpperCase() !== C) return;
      var d = toISO(o.Date); if (d) worked[d] = 1;
    });
    var doj = DB.doj(C), t = today(), d0 = new Date(r[0] + 'T00:00:00');
    for (var g = 0; g < 400; g++) {
      var k = iso(d0); if (k > r[1] || k > t) break;
      d0.setDate(d0.getDate() + 1);
      if (doj && k < doj) continue;
      var pl = DB.find('DayPlan', C + '_' + k) || {}, pj = DB.pjpFor(C, k) || {};
      var ww = String(pl.WorkingWith || pj.Ww || pj.Week || '');
      if (!ww || !Home.FIELD.test(ww)) continue;
      out.work++;
      var mk = String(pl.PjpStatus || '').toLowerCase();
      if (mk) { if (/^miss/.test(mk)) out.missed++; else out.ok++; continue; }
      if (!worked[k]) { out.missed++; continue; }
      out.ok++;
    }
    return out;
  },
  /* label · value · how to print it · is bigger better (a leader is marked only then) */
  CMP:[
    ['NSV ₹L',          function (m) { return m.nsv; },    function (v) { return lakh(v); },      1],
    ['NSV / field din', function (m) { return m.perDay; }, function (v) { return lakh(v); },      1],
    ['TC (total calls)', function (m) { return m.tc; },    function (v) { return Math.round(v); }, 1],
    ['— store visit',   function (m) { return m.visit; },  function (v) { return Math.round(v); }, 1],
    ['— telephonic',    function (m) { return m.tel; },    function (v) { return Math.round(v); }, 0],
    ['SC (target calls)', function (m) { return m.sc; },   function (v) { return Math.round(v); }, 0],
    ['PC (order mila)',  function (m) { return m.pc; },    function (v) { return Math.round(v); }, 1],
    ['Strike rate',     function (m) { return m.strike; }, function (v) { return Math.round(v) + '%'; }, 1],
    ['Naye outlet',     function (m) { return m.nso; },    function (v) { return Math.round(v); }, 1],
    ['POSM audit',      function (m) { return m.posm; },   function (v) { return Math.round(v); }, 1],
    ['Field din',       function (m) { return m.field; },  function (v) { return Math.round(v); }, 0],
    ['Din shuru',       function (m) { return m.start; },  function (v) { return Math.round(v); }, 1],
    ['EOD file kiye',   function (m) { return m.eod; },    function (v) { return Math.round(v); }, 1],
    ['PJP adherence',   function (m) { return m.adh; },    function (v) { return Math.round(v) + '%'; }, 1],
    ['Missed din',      function (m) { return m.missed; }, function (v) { return Math.round(v); }, -1],
    ['Leave / off',     function (m) { return m.leave + m.off; }, function (v) { return Math.round(v); }, 0]
  ],
  compare: function (r) {
    var rows = Team.local(r[0], r[1]), map = {};
    rows.forEach(function (e) { map[String(e.code).toUpperCase()] = e; });
    var M = Admin.cmp.map(function (c) { return Admin.cmpM(c, r, map[c]); });

    /* who is in it, and who else could be */
    var left = Admin.emps().filter(function (x) { return !Admin.cmpHas(x.code); });
    var h = '<div class="card"><div class="lrow" style="padding-top:0">' +
      '<button class="btn ghost sm" style="flex:0 0 auto" onclick="Admin.cmpBack()">‹ Employee list</button>' +
      '<div class="m" style="text-align:right"><div class="t">Compare (' + M.length + ')</div>' +
      '<div class="s">' + esc(Admin.rangeLbl()) + '</div></div></div>' +
      '<div class="chips">' + M.map(function (m) {
        return '<button class="btn ghost sm" onclick="Admin.cmpTick(\'' + Appr.q(m.code) + '\',false)">' +
          esc(m.name || m.code) + ' ×</button>'; }).join('') + '</div>' +
      (left.length && M.length < Admin.CMPMAX
        ? '<div style="margin-top:8px">' + Admin.cmpPick(left) + '</div>'
        : '<div class="hint" style="margin-top:8px">' + (M.length >= Admin.CMPMAX
            ? 'Ek baar me ' + Admin.CMPMAX + ' se zyada nahi — table padhne layak rehna chahiye.'
            : 'Sab employee add ho gaye.') + '</div>') +
      '</div>';

    if (!M.length) return h + '<div class="card"><div class="sub">Kisi ko add karo.</div></div>';

    /* the table: metric per row, person per column */
    h += '<div class="sec-title">Number-wise</div><div class="card"><div class="tw"><table>' +
      '<thead><tr><th>Metric</th>' + M.map(function (m) {
        return '<th class="num">' + esc(Admin.shortName(m.code)) +
          '<div class="hint">' + esc(m.code) + '</div></th>'; }).join('') + '</tr></thead><tbody>' +
      Admin.CMP.map(function (d) {
        var vals = M.map(function (m) { return num(d[1](m)); });
        var txt = vals.map(function (v) { return d[2](v); });
        var lead = {};
        if (d[3]) {
          var lo = d[3] < 0;
          var pick = lo ? Math.min.apply(null, vals) : Math.max.apply(null, vals);
          var same = vals.every(function (v) { return v === vals[0]; });
          /* nothing to lead when everyone is level, or when nobody has any of it.
             The mark goes by the PRINTED value, so two people showing 100% both get it — and one
             showing 100% can never be marked ahead of another showing 100%. */
          if (!same && (lo || pick > 0)) {
            var top = d[2](pick);
            txt.forEach(function (x, i) { if (x === top) lead[i] = 1; });
          }
        }
        return '<tr><td>' + esc(d[0]) + '</td>' + txt.map(function (x, i) {
          return '<td class="num"' + (lead[i] ? ' style="color:var(--ok);font-weight:800"' : '') +
            '>' + x + (lead[i] ? ' ▲' : '') + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>' +
      '<div class="hint" style="margin-top:8px">▲ = us row ka leader. SC, field din, telephonic aur ' +
      'leave par koi leader nahi — wo zyada hone se behtar nahi hota.</div></div>';

    /* two people = a straight verdict, in words */
    if (M.length === 2) h += Admin.cmpVerdict(M);

    /* and the shape of the period, not just its total */
    if (r[0] !== r[1]) h += Admin.cmpDays(M, r);
    return h;
  },
  cmpPick: function (left) {
    if (left.length <= 10) {
      return '<label class="f">Aur kisi ko add karo</label>' +
        '<select class="in" onchange="Admin.cmpAddSel(this.value)"><option value="">Chuno…</option>' +
        left.map(function (x) { return '<option value="' + esc(x.code) + '">' + esc(x.name) +
          ' (' + esc(x.code) + ')</option>'; }).join('') + '</select>';
    }
    return '<label class="f">Aur kisi ko add karo</label>' +
      '<input class="in" list="ad_cmp_l" placeholder="Naam ya code likho" onchange="Admin.cmpAddSel(this.value)">' +
      '<datalist id="ad_cmp_l">' + left.map(function (x) {
        return '<option value="' + esc(x.name) + ' (' + esc(x.code) + ')"></option>'; }).join('') +
      '</datalist><div class="hint" style="margin-top:4px">' + left.length + ' aur employee</div>';
  },
  cmpVerdict: function (M) {
    var a = M[0], b = M[1], mine = [], theirs = [], tie = 0;
    Admin.CMP.forEach(function (d) {
      if (d[3] !== 1 && d[3] !== -1) return;
      var va = num(d[1](a)), vb = num(d[1](b)), lo = d[3] < 0;
      /* level on the screen = level here, whatever the third decimal says */
      if (va === vb || d[2](va) === d[2](vb)) { tie++; return; }
      var aWins = lo ? va < vb : va > vb;
      var gap = d[2](Math.abs(va - vb));
      (aWins ? mine : theirs).push(esc(d[0]) + ' <b>+' + gap + '</b>');
    });
    var line = function (m, list) {
      return '<div class="lrow"><span class="pill ' + (list.length ? 'p-ok' : 'p-grey') + '">' +
        list.length + '</span><div class="m"><div class="t">' + esc(m.name || m.code) + ' aage hai</div>' +
        '<div class="s">' + (list.length ? list.join(' · ') : 'kisi bhi metric par nahi') + '</div></div></div>';
    };
    return '<div class="sec-title">Aamne-saamne</div><div class="card">' +
      line(a, mine) + line(b, theirs) +
      '<div class="hint">' + tie + ' metric par barabar. Missed din me kam behtar hai.</div></div>';
  },
  cmpDays: function (M, r) {
    var days = [], d0 = new Date(r[0] + 'T00:00:00');
    for (var g = 0; g < 62; g++) {
      var k = iso(d0); if (k > r[1]) break;
      d0.setDate(d0.getDate() + 1);
      days.push(k);
    }
    var tot = M.map(function () { return 0; });
    var body = days.map(function (k) {
      var any = false;
      var tds = M.map(function (m, i) {
        var d = m.day[k];
        if (d) { any = true; tot[i] += d.nsv; }
        return '<td class="num">' + (d ? lakh(d.nsv) + '<div class="hint">' + d.tc + ' call</div>' : '—') + '</td>';
      }).join('');
      return any ? '<tr><td>' + dmy(k) + '</td>' + tds + '</tr>' : '';
    }).join('');
    return '<div class="sec-title">Din-wise NSV</div><div class="card">' +
      '<div class="pane" style="max-height:340px"><table><thead><tr><th>Date</th>' +
      M.map(function (m) { return '<th class="num">' + esc(Admin.shortName(m.code)) + '</th>'; }).join('') +
      '</tr></thead><tbody>' + (body ||
        '<tr><td colspan="' + (M.length + 1) + '">Is period me kisi ka order nahi hai.</td></tr>') +
      '<tr class="tot"><td><b>TOTAL</b></td>' + tot.map(function (v) {
        return '<td class="num"><b>' + lakh(v) + '</b></td>'; }).join('') + '</tr>' +
      '</tbody></table></div></div>';
  },

  appr: function () { return Appr.html(); },

  /* ══ 3. USERS — who may do what ══ */
  uq:'',
  users: function () {
    var u = (DB.m.LoginConfig || []).slice();
    var gB = /^(yes|true|1)$/i.test(String(DB.cfg('Global_Bypass', '') || ''));
    var gP = String(DB.cfg('Global_PjpOpen', '') || '');
    var on = u.filter(Admin.isBypass);

    /* everyone at once */
    var h = '<div class="sec-title">Sab ke liye</div><div class="card">' +
      '<div class="lrow" style="padding-top:0"><div class="m"><div class="t">Bypass — poori team</div>' +
      '<div class="s">Photo, sequence aur poora-month PJP ki majboori sab ke liye hat jayegi. ' +
      'Sirf tab jab kuch tut gaya ho.</div></div>' +
      '<button class="btn ' + (gB ? 'bad' : 'ghost') + ' sm" style="flex:0 0 auto" onclick="Admin.cfg(\'Global_Bypass\',\'' +
        (gB ? 'No' : 'Yes') + '\',this)">' + (gB ? 'OFF karo' : 'ON karo') + '</button></div>' +
      (gB ? '<div class="strip w" style="margin-bottom:0"><span class="g">!</span><div class="m">' +
        '<b>Poori team par bypass ON hai</b> <i>· kaam hote hi OFF karo</i></div></div>' : '') +
      '<div class="lrow"><div class="m"><div class="t">PJP tab — poori team</div>' +
      '<div class="s">Normal niyam: 27 se 1 tarikh tak khula, HOD approve karne ke baad band. ' +
      'Yahan se force kar sakte ho.</div></div>' +
      '<select class="in" style="width:auto;flex:0 0 auto" onchange="Admin.cfg(\'Global_PjpOpen\',this.value,this)">' +
        [['', 'Normal niyam'], ['Yes', 'Sab ke liye khula'], ['No', 'Sab ke liye band']].map(function (o) {
          return '<option value="' + o[0] + '"' + (gP === o[0] ? ' selected' : '') + '>' + o[1] + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="lrow"><div class="m"><div class="t">Password reset</div>' +
      '<div class="s">Sab logins Honasa@123 ho jayenge, aur pehli login par change maangega.</div></div>' +
      '<button class="btn ghost sm" style="flex:0 0 auto" onclick="Admin.resetPwd()">Reset all</button></div>' +
      '<div class="hint" style="margin-top:8px">Bypass me kya-kya hat jata hai: ' + Bypass.WAIVES.join(' · ') +
      '. Data phir bhi zaroori hai.</div></div>';

    /* one person at a time */
    var q = String(Admin.uq || '').toUpperCase();
    var show = q ? u.filter(function (x) {
      return (String(x.Name || '') + ' ' + x.Code + ' ' + (x.Email || '') + ' ' + (x.HQ || ''))
        .toUpperCase().indexOf(q) >= 0; }) : u;
    h += '<div class="sec-title">' + u.length + ' login' + (on.length ? ' · ' + on.length + ' par bypass ON' : '') +
      '</div><div class="card">' +
      (u.length > 10 ? '<input class="in" placeholder="Naam, code ya HQ se dhoondo" value="' + esc(Admin.uq || '') +
        '" oninput="Admin.uq=this.value;clearTimeout(Admin._u);Admin._u=setTimeout(render,350)">' +
        '<div class="hint" style="margin:6px 0 2px">' + show.length + ' / ' + u.length + '</div>' : '');
    if (!show.length) h += UI.empty('', 'Is search me koi user nahi');
    h += show.slice(0, 60).map(function (x) {
      var b = Admin.isBypass(x), pj = String(x.PjpOpen || '');
      var act = !/inactive/i.test(String(x.Status || 'Active'));
      var pst = Admin.pjpNow(x.Code, pj, b);
      return '<div class="drow' + (b ? ' bad inset' : '') + '">' +
        '<div class="dr-h"><div class="m"><div class="t">' + esc(x.Name || x.Code) +
          ' <span class="pill ' + (/admin|hod/i.test(x.Rights || '') ? 'p-blue' : 'p-grey') + '">' +
          esc(x.Rights || 'Employee') + '</span>' +
          (b ? ' <span class="pill p-warn">Bypass ON</span>' : '') +
          (pj === 'Yes' ? ' <span class="pill p-ok">PJP khula</span>' : '') +
          (pj === 'No' ? ' <span class="pill p-bad">PJP band</span>' : '') +
          (act ? '' : ' <span class="pill p-bad">Inactive</span>') + '</div>' +
        '<div class="s">' + esc(pst) + '</div>' +
        '<div class="s">' + esc(x.Code) + ' · ' + esc(x.Email || '') + ' · ' + esc(x.HQ || '') +
          ' · joining ' + esc(dmy(x.DateofJoining) || '—') +
          (b && x.BypassBy ? ' · bypass by ' + esc(x.BypassBy) : '') +
          (b && x.BypassNote ? ' — ' + esc(x.BypassNote) : '') + '</div></div></div>' +
        '<div class="dsave" style="border-top:0;flex-wrap:wrap;gap:6px">' +
          '<button class="btn ' + (b ? 'bad' : 'ghost') + ' sm" onclick="Admin.bypass(\'' +
            Appr.q(x.Code) + '\',' + (b ? 'false' : 'true') + ',this)">' +
            (b ? 'Bypass OFF' : 'Bypass ON') + '</button>' +
          '<select class="in" style="width:auto;flex:0 0 auto;font-size:12.5px;padding:7px 26px 7px 9px"' +
            ' onchange="Admin.flag(\'' + Appr.q(x.Code) + '\',\'PjpOpen\',this.value,this)">' +
            [['', 'PJP: normal'], ['Yes', 'PJP: khula rakho'], ['No', 'PJP: band rakho']].map(function (o) {
              return '<option value="' + o[0] + '"' + (pj === o[0] ? ' selected' : '') + '>' + o[1] +
                '</option>'; }).join('') + '</select>' +
          '<button class="btn ghost sm" onclick="Admin.flag(\'' + Appr.q(x.Code) + '\',\'Status\',\'' +
            (act ? 'Inactive' : 'Active') + '\',this)">' + (act ? 'Login band karo' : 'Login chalu karo') +
          '</button>' +
          '<button class="btn ghost sm" onclick="Admin.resetOne(\'' + Appr.q(x.Code) +
            '\',this)">Password reset</button>' +
        '</div></div>'; }).join('');
    if (show.length > 60) h += '<div class="hint">Sirf pehle 60 — search karo.</div>';
    return h + '</div>';
  },
  /* Can this person open the PJP tab right now, and why — the same rules Gate.allowed uses, said in
     words, next to the switch that changes them. An admin removing a plan needs to see the result. */
  pjpNow: function (code, pj, byp) {
    var wm = Pjp.winMonth(), C = String(code || '').toUpperCase();
    var dr = DB.rows('PjpDraft').filter(function (r) {
      return String(r.EmpCode || '').toUpperCase() === C && String(r.Month || '').slice(0, 7) === wm; })[0];
    var st = dr ? Appr.norm(dr.Status) : '';
    var days = (DB.m.Master_PJP || []).filter(function (r) {
      return DB.same(r.Code, C) && String(toISO(r.Date) || '').slice(0, 7) === wm; }).length;
    var head = 'PJP ' + monthName(wm) + ': ' + days + ' din master me' +
      (st ? ' · draft ' + st : ' · koi draft nahi');
    if (/^yes$/i.test(pj)) return head + ' → tab KHULA (admin ne khola)';
    if (/^no$/i.test(pj)) return head + ' → tab BAND (admin ne band kiya)';
    if (byp) return head + ' → tab KHULA (bypass)';
    if (st === 'approved') return head + ' → tab band (approve ho gaya)';
    if (Pjp.winOpen()) return head + ' → tab KHULA (window 27–1 chalu hai)';
    if (/pending|rejected|partial/.test(st)) return head + ' → tab KHULA (decision baaki hai)';
    return head + ' → tab BAND (window ' + dmy(Pjp.winShut()) + ' ko band ho gaya)';
  },
  flag: function (code, name, v, el) {
    return Busy.run('flag_' + code + name, el, '…', function () {
      return Api.post({ action:'admin', op:'setFlag', email:Auth.session().email,
        code:code, flag:name, value:v }).then(function (r) {
        if (!r || !r.ok) return toast('! ' + ((r && r.error) || 'Nahi hua'), 4000);
        /* keep the screen honest until the next pull brings the row back */
        (DB.m.LoginConfig || []).forEach(function (x) {
          if (String(x.Code).toUpperCase() === String(code).toUpperCase()) x[name] = v; });
        DB.cache(); Log.add('User', name + '=' + (v || 'normal'), code, Admin.role());
        render();
        toast(code + ' — ' + name + ' ' + (v || 'normal'));
      });
    });
  },
  /* a whole-team switch (Master_Config, allow-listed on the server) */
  cfg: function (key, v, el) {
    var lbl = key === 'Global_Bypass' ? 'Poori team ka bypass' : 'Poori team ka PJP tab';
    return UI.confirm({ icon:'', title:lbl + ' badalna hai?', danger:key === 'Global_Bypass' && v === 'Yes',
      msg:'<b>' + lbl + '</b> → <b>' + (v || 'normal niyam') + '</b>. Ye sab employee par lagu hoga.',
      ok:'Haan, badlo', cancel:'Abhi nahi' }).then(function (go) {
      if (!go) { render(); return; }
      return Busy.run('cfg_' + key, el, '…', function () {
        return Api.post({ action:'admin', op:'setCfg', email:Auth.session().email,
          key:key, value:v }).then(function (r) {
          if (!r || !r.ok) return toast('! ' + ((r && r.error) || 'Nahi hua'), 4000);
          var a = DB.m.Master_Config || (DB.m.Master_Config = []);
          var row = a.filter(function (x) { return String(x.Key) === key; })[0];
          if (row) row.Value = v; else a.push({ Key:key, Value:v });
          DB.cache(); Log.add('Config', key + '=' + (v || 'normal'), key, Admin.role());
          render(); toast(lbl + ' → ' + (v || 'normal niyam'));
        });
      });
    });
  },

  /* ══ 4. DATA — a formatted download, and a delete that shows its work ══ */
  dkind:'SecOrders', dcode:'', ddel:null,
  /* ══ the Data tab's own state ══
     Lists, not single values: "these reports, for these people, over these days". */
  dkinds:['SecOrders'], dwhats:[], dcodes:[], dq:'', dqe:'', dfrom:'', dto:'', mOpen:false,
  /* a plain from–to. The Summary's Today/Days/Month strip does not belong here: a month clamped to
     today can never cover a month, and "download August" is the whole of August. */
  dRange: function () {
    var t = today();
    var f = Admin.dfrom, o = Admin.dto;
    /* the WHOLE current month by default: a month-keyed row (the PJP draft, a TA/DA claim) only goes
       when the range covers the month end to end, and "1st to today" silently spared it */
    if (!f && !o) { f = t.slice(0, 8) + '01';
      o = iso(new Date(+t.slice(0, 4), +t.slice(5, 7), 0)); }
    if (!f) f = o; if (!o) o = f;
    if (f > o) { var x = f; f = o; o = x; }
    return [f, o];
  },
  setD: function (k, v) { Admin[k] = v; Admin.ddel = null; render(); },
  dQuick: function (days) {
    var t = today();
    if (days === 0) { Admin.dfrom = t.slice(0, 8) + '01'; Admin.dto = t; }
    else if (days === -1) { var m = t.slice(0, 7);
      var last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
      Admin.dfrom = m + '-01'; Admin.dto = iso(last); }
    else { var d = new Date(t + 'T00:00:00'); d.setDate(d.getDate() - (days - 1));
      Admin.dfrom = iso(d); Admin.dto = t; }
    Admin.ddel = null; render();
  },
  /* ── the three tick lists ── */
  tglKind: function (v) { Admin.dkinds = Admin.tgl(Admin.dkinds, v); render(); },
  allKinds: function (on) {
    Admin.dkinds = on ? Admin.KINDS.map(function (k) { return k[0]; }) : [];
    render();
  },
  tglWhat: function (v) { Admin.dwhats = Admin.tgl(Admin.dwhats, v); Admin.ddel = null; render(); },
  allWhats: function (on) {
    /* "all" here means every GROUP — ticking single tabs as well would count the same row twice */
    Admin.dwhats = on ? ['EVERYTHING'] : [];
    Admin.ddel = null; render();
  },
  tglEmp: function (v) { Admin.dcodes = Admin.tgl(Admin.dcodes, v); Admin.ddel = null; render(); },
  allEmps: function (on) {
    Admin.dcodes = on ? Admin.emps().map(function (e) { return e.code; }) : [];
    Admin.ddel = null; render();
  },
  tgl: function (arr, v) {
    var a = (arr || []).slice(), i = a.indexOf(v);
    if (i >= 0) a.splice(i, 1); else a.push(v);
    return a;
  },
  setQ: function (v) { Admin.dq = v; clearTimeout(Admin._dq); Admin._dq = setTimeout(render, 320); },
  setQe: function (v) { Admin.dqe = v; clearTimeout(Admin._dqe); Admin._dqe = setTimeout(render, 320); },
  /* "sab employee" or the names, for every line that has to say who this is about */
  whoText: function () {
    if (!Admin.dcodes.length) return 'sab employee';
    if (Admin.dcodes.length <= 2) return Admin.dcodes.map(function (c) {
      var e = DB.emp(c) || {}; return (e.Name || c); }).join(' + ');
    return Admin.dcodes.length + ' employee';
  },
  /* the employee list, as multi-select items */
  empItems: function () {
    return Admin.emps().map(function (e) { return [e.code, e.name, e.code + (e.hq ? ' · ' + e.hq : '')]; });
  },

  /* [code, label, what it actually contains] — the third slot is the line UI.multi shows under the
     name, so nobody has to download a file to find out what is in it. */
  KINDS:[
    ['SecOrders', 'Order summary (with lines)',
      'Every order punched in the range — store, distributor, SKU count, units, MRP value, NSV, billing status, beat and the shop\'s photo folder. Its SKU lines come as a second tab.'],
    ['Eod', 'EOD',
      'One row per closed day, in depth — target vs done for SC / TC / PC, NSO and POSM, no-order and telephonic visits, MSL and Non-MSL lines, SKU, units, MRP value, NSV, day-end time and the day\'s photo folder.'],
    ['DayPlan', 'Day plans',
      'The morning plan per day, in depth — attendance, working-with, station, town/beat, focus, what the approved PJP said for that same day, the off-PJP flag and adherence, targets, and what the day actually produced against them.'],
    ['Attendance', 'Attendance (day-wise)',
      'One row per employee per day — Present / Absent / Leave / Weekly off / Holiday / Meeting, with the times and what the day produced. A rostered field day that never started counts as Absent. Days with no saved plan come from the published PJP.'],
    ['FailedVisits', 'Failed visits',
      'Every shop visit that produced no order — zero units booked or cancelled outright — with the reason given and the beat it happened on.'],
    ['BeatCoverage', 'Beat coverage (day-wise)',
      'One row per PLANNED DAY — what the approved PJP asked for (working-with, state/town/beat, station, week, focus) against what actually happened (attendance, the beat really worked, station), a one-word coverage verdict, and what the day produced. Days that were missed appear as rows, not as a percentage.'],
    ['BeatSummary', 'Beat coverage (per beat)',
      'The same data rolled up per beat — days planned vs days actually worked, coverage %, stores visited, productive visits, units, MRP value and NSV. Answers which beats are being missed across the period.'],
    ['PrimaryOrder', 'Primary order — distributor shortfall',
      'The SKUs with a pending secondary order that the distributor cannot serve: order quantity per distributor × SKU against the stock they hold, and the primary order needed to close the gap. Distributor stock is read live, so this download takes a moment.'],
    ['NewStores', 'New outlets',
      'Shops opened in the range — id, type, town/beat, distributor, owner and mobile, day sale and monthly turnover, tracker status.'],
    ['PosmAudit', 'POSM audit',
      'Store-by-store POSM check — element, type, brand, install period, condition, visibility, action needed, who installed and verified.'],
    ['PosmRequirement', 'POSM requirement',
      'What POSM a store still needs — element, type, brand, quantity, needed-by date and the tracker status.'],
    /* day-wise only. The month-total sheet is gone: every one of its figures (gross claim, deduction,
       net payable, status, HOD message, approved-at) is carried on EVERY day row of this one, so the
       month is still readable here — and a claim can finally be totalled, filtered and pivoted by day,
       which a single row with the days packed into JSON never could be. */
    ['TaDaDays', 'TA / DA (day-wise)',
      'One row per CLAIMED DAY, unpacked out of the month\'s DaysJson — day type, city, working-with, beat, DA, TA, lodging, nights, the day\'s total, any per-day HOD deduction with its reason, and the day net. The month\'s claim total, net, status and approval travel on every row.'],
    ['Deviation', 'Plan changes',
      'Requests to work off the approved PJP — what the PJP said for that day against what was asked for, the reason, and the HOD decision.'],
    ['PjpDraft', 'PJP drafts',
      'Monthly PJP submissions — status, coverage, revision, when sent, when approved, and how many days reached Master_PJP.'],
    ['Dfr', 'Daily field report',
      'The per-day activity roll-up — how many activities and how many orders each day carried.'],
    ['StockRemark', 'Stock remarks',
      'Notes a rep left against a store or distributor stock line.'],
    ['Photos', 'Photos',
      'Every photo row — module, store, slot, filename and its Drive link. The Drive files themselves are not in the file.'],
    ['ActivityLog', 'Activity log',
      'Who did what and when — the audit trail. Never deleted automatically.'],
    /* two tables under one name, because "his PJP" is not one table */
    ['PJP', 'PJP — published days + month draft',
      'The published Master_PJP days AND the month draft behind them, as two tabs.'],
    /* masters — Admin/HOD only, enforced in Rep.mayHave, not just hidden here */
    ['Master_Employees', 'Master — Employees',
      'The employee master — code, designation, HQ, zone, contact and the full ASM / RSM / ZSM / HOD line. Admin/HOD only.'],
    ['Master_Stores', 'Master — Stores',
      'The store master — client id, store code, type, city/state, mapped distributor and who it is mapped to. Admin/HOD only.'],
    ['Master_Products', 'Master — Products',
      'The product master — SKU code, brand, category, MRP and whether it is an MSL SKU. Admin/HOD only.'],
    ['Master_PJP', 'Master — Published PJP',
      'Every published PJP day — working-with, week, town/beat, station, focus and who approved it. Admin/HOD only.'],
    ['Master_Distributors', 'Master — Distributors',
      'The distributor master, exactly as the sheet holds it. Admin/HOD only.'],
    ['Master_Config', 'Master — Config',
      'Every configuration key and value the app reads. Admin/HOD only.'],
    ['Master_Phasing', 'Master — Phasing',
      'The monthly target phasing rows. Admin/HOD only.']],
  /* which of the above are real, deletable TXN tabs — the delete picker must never offer a derived
     report (there is no such tab to empty) or a master (refused server-side anyway) */
  DELKINDS: function () {
    return Admin.KINDS.filter(function (k) {
      return k[0] !== 'PJP' && !/^Master_/.test(k[0]) &&
             ['Attendance', 'FailedVisits', 'BeatCoverage', 'BeatSummary', 'TaDaDays',
              'PrimaryOrder'].indexOf(k[0]) < 0;
    });
  },
  kindLbl: function (k) {
    var x = Admin.KINDS.filter(function (y) { return y[0] === k; })[0];
    return x ? x[1] : k;
  },

  /* ══ PJP as one thing ══
     Published days live in Master_PJP (keyed Code + Date), the month draft in PjpDraft (keyed
     EmpCode + Month). An admin means both. The DELETE is done by the server — it takes the days inside
     the range, and the draft only when the range covers that whole month, so "delete the 3rd" can never
     take the whole month with it. This is the same pair, read locally, for the count preview and the
     download. */
  PJPCOL:{ t:'Published PJP', cols:[
    ['Date', 'Date', 'd'], ['Code', 'Code'], ['Ww', 'Working with'], ['Week', 'Week / label'],
    ['State', 'State'], ['Town', 'Town'], ['Beat', 'Beat'], ['Station', 'Station'],
    ['Focus', 'Focus'], ['Remarks', 'Remarks'], ['Status', 'Status'], ['Approvals', 'Approved by'],
    ['LastUpdated', 'Written at']] },
  DRFCOL:{ t:'PJP drafts', cols:[
    ['Month', 'Month'], ['EmpCode', 'Code'], ['EmpName', 'Employee'], ['Status', 'Status'],
    ['SubmittedAt', 'Sent at'], ['HodAt', 'Approved at', 'dtm'],
    ['HodRemarks', 'Remarks'], ['RejectedDays', 'Days sent back'], ['UpdatedAt', 'Updated at']] },
  pjpRows: function (codes, from, to) {
    var want = Admin.codeSet(codes);
    var pub = (DB.m.Master_PJP || []).filter(function (r) {
      if (want && !want[String(r.Code || '').trim().toUpperCase()]) return false;
      var d = toISO(r.Date);
      return !!d && d >= from && d <= to;
    }).sort(function (a, b) { return String(toISO(a.Date)).localeCompare(String(toISO(b.Date))); });
    /* a month draft counts only when the range covers the WHOLE month — exactly the server's rule, so
       the number on the screen is the number that will go */
    var dr = DB.rows('PjpDraft').filter(function (r) {
      if (want && !want[String(r.EmpCode || '').trim().toUpperCase()]) return false;
      var m = String(r.Month || '').slice(0, 7);
      if (!/^\d{4}-\d{2}$/.test(m)) return false;
      var last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
      return from <= m + '-01' && to >= iso(last);
    });
    var whole = dr.map(function (r) { return String(r.Month).slice(0, 7); });
    return { pub:pub, dr:dr, whole:whole };
  },
  pjpXl: function (code, from, to) {
    var x = Admin.pjpRows(code, from, to);
    var ttl = Rep.ttl('GARUDA — PJP', Rep.who(code) + '  ·  ' + dmy(from) + ' – ' + dmy(to) + '  ·  ' +
      x.pub.length + ' published day, ' + x.dr.length + ' draft', 8);
    var sheets = [{ name:'About', cols:[24, 44, 14, 14, 14, 14, 14, 14], tab:'FF8890A6', portrait:1,
      rowH:ttl.rowH, rows:ttl.rows.concat([
      Rep.kv('Report', Xl.t(I18n.s('PJP — published days + month draft'), Xl.S.V)),
      Rep.kv('Employee', Xl.t(Rep.who(code), Xl.S.V)),
      Rep.kv('From', Xl.dt(from)), Rep.kv('To', Xl.dt(to)),
      Rep.kv('Published days', Xl.n(x.pub.length)), Rep.kv('Drafts', Xl.n(x.dr.length)),
      Rep.kv('Downloaded', Xl.t(dmy(today()) + ' ' + new Date().toLocaleTimeString('en-IN'), Xl.S.V)),
      Rep.kv('By', Xl.t(DB.me.name + ' (' + DB.me.code + ')', Xl.S.V))]), merges:ttl.merges },
      Rep.anySheet('Master_PJP', x.pub, Admin.PJPCOL, Rep.who(code) + '  ·  ' + dmy(from) +
        ' – ' + dmy(to) + '  ·  ' + x.pub.length + ' din'),
      Rep.anySheet('PjpDraft', x.dr, Admin.DRFCOL, Rep.who(code) + '  ·  ' + x.dr.length + ' draft')];
    return Xl.save('GARUDA_PJP_' + (code || 'ALL') + '_' + from + '_' + to, sheets);
  },
  /* what removing it will DO — the sentence an admin needs before pressing delete, not after */
  pjpWarn: function (codes, r) {
    r = r || Admin.dRange();
    var C = codes === undefined ? Admin.dcodes : codes;
    var x = Admin.pjpRows(C, r[0], r[1]);
    var open = Pjp.winOpen(), wm = Pjp.winMonth();
    var hits = x.whole.indexOf(wm) >= 0;
    return '<div class="banner ' + (open ? 'g' : 'w') + '"><span>i</span><div>' +
      '<b>Jayega: ' + x.pub.length + ' published din' + (x.whole.length ? ' + ' + x.whole.length +
        ' month ka draft' : '') + '</b><br><span style="font-weight:500">' +
      (open
        ? 'PJP window abhi khula hai (27–1) — hataane ke baad wo khud se dobara bana sakta hai.'
        : (hits ? 'PJP window ' + dmy(Pjp.winShut()) + ' ko band ho gaya — hataane ke baad wo khud ' +
            'dobara nahi bana payega. Users tab se uska PJP kholna padega.'
          : 'PJP window band hai, par is month ka draft nahi ja raha — uska current plan chalta rahega.')) +
      '</span></div></div>';
  },
  /* every employee, for the pickers — searchable once there are more than ten */
  emps: function () {
    var seen = {}, out = [];
    (DB.m.Master_Employees || []).forEach(function (e) {
      var c = String(e.Code || '').toUpperCase(); if (!c || seen[c]) return;
      seen[c] = 1; out.push({ code:c, name:e.Name || c, hq:e.HQ || '' });
    });
    (DB.m.LoginConfig || []).forEach(function (e) {
      var c = String(e.Code || '').toUpperCase();
      if (!c || seen[c] || /admin/i.test(String(e.Rights || ''))) return;
      seen[c] = 1; out.push({ code:c, name:e.Name || c, hq:e.HQ || '' });
    });
    return out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  },
  /* a picker that is a plain select when short, and a searchable one when it is not */
  empPick: function (id, cur, handler) {
    var e = Admin.emps();
    if (e.length <= 10) {
      return '<select class="in" id="' + id + '" onchange="' + handler + '">' +
        '<option value="">Sab employee</option>' +
        e.map(function (x) { return '<option value="' + esc(x.code) + '"' +
          (String(cur).toUpperCase() === x.code ? ' selected' : '') + '>' + esc(x.name) + ' (' +
          esc(x.code) + ')</option>'; }).join('') + '</select>';
    }
    /* a datalist gives the phone's own search over the same list */
    var pick = e.filter(function (x) { return x.code === String(cur).toUpperCase(); })[0];
    return '<input class="in" id="' + id + '" list="' + id + '_l" placeholder="Sab employee — ya naam / code likho"' +
      ' value="' + esc(pick ? pick.name + ' (' + pick.code + ')' : '') + '" onchange="' + handler + '">' +
      '<datalist id="' + id + '_l">' + e.map(function (x) {
        return '<option value="' + esc(x.name) + ' (' + esc(x.code) + ')"></option>'; }).join('') + '</datalist>' +
      '<div class="hint" style="margin-top:4px">' + e.length + ' employee · khali chhodo to sab</div>';
  },
  /* "NAME (CODE)" or a bare code back to a code */
  codeOf: function (v) {
    var s = String(v || '').trim();
    if (!s) return '';
    var m = /\(([^)]+)\)\s*$/.exec(s);
    if (m) return m[1].toUpperCase().trim();
    var up = s.toUpperCase();
    var hit = Admin.emps().filter(function (x) { return x.code === up || String(x.name).toUpperCase() === up; })[0];
    return hit ? hit.code : up;
  },
  /* kept: the console's other screens still hand a "NAME (CODE)" string back */
  setCode: function (v) {
    var c = Admin.codeOf(v);
    Admin.dcodes = c ? [c] : [];
    Admin.ddel = null; render();
  },

  data: function () {
    var r = Admin.dRange(), codes = Admin.dcodes, who = Admin.whoText();
    var kinds = Admin.dkinds, whats = Admin.dwhats;

    /* the one screen where a stale deployment is the likeliest explanation for "it did nothing" */
    var h = Admin.verStrip();

    /* ── the range, and nothing else ── */
    h += '<div class="card"><div class="pair">' +
      '<div><label class="f">From</label><input class="in" type="date" value="' + esc(r[0]) +
        '" onchange="Admin.setD(\'dfrom\',this.value)"></div>' +
      '<div><label class="f">To</label><input class="in" type="date" value="' + esc(r[1]) +
        '" onchange="Admin.setD(\'dto\',this.value)"></div></div>' +
      '<div class="hint" style="margin-top:8px">' + esc(dmy(r[0]) + ' – ' + dmy(r[1])) +
      ' · ' + esc(who) + '</div></div>';

    /* ── who ── */
    h += '<div class="sec-title">Employee</div><div class="card">' +
      UI.multi({ label:'Kiska data', sub:'Khali chhodo to sab employee', items:Admin.empItems(),
        sel:codes, tgl:'Admin.tglEmp', all:'Admin.allEmps', q:Admin.dqe, onQ:'Admin.setQe',
        qph:'Naam, code ya HQ se dhoondo', max:200 }) + '</div>';

    /* ── download ── */
    var rows = 0, per = [];
    kinds.forEach(function (k) {
      var n = Admin.pick(k, codes, r).length;
      rows += n; per.push([k, n]);
    });
    h += '<div class="sec-title">Report download</div><div class="card">' +
      UI.multi({ label:'Kaun kaun si report', sub:'Ek se zyada chuno — har ek apne tab me aayegi',
        items:Admin.KINDS.filter(function (k) { return Rep.mayHave(k[0]); })
          .map(function (k) { return [k[0], k[1], k[2] || '']; }), sel:kinds,
        tgl:'Admin.tglKind', all:'Admin.allKinds', q:Admin.dq, onQ:'Admin.setQ',
        qph:'Report dhoondo', max:230 }) +
      '<div class="hint" style="margin-top:8px">' + rows + ' row milenge — ' + kinds.length +
        ' report · ' + esc(who) + ' · ' + esc(dmy(r[0]) + ' – ' + dmy(r[1])) + '</div>' +
      (per.length && per.length <= 14 ? '<div class="hint">' + esc(per.map(function (x) {
        return Admin.kindLbl(x[0]) + ' ' + x[1]; }).join(' · ')) + '</div>' : '') +
      '<div class="btns"><button class="btn" onclick="Admin.dl(this)"' +
        (kinds.length && rows ? '' : ' disabled') + '>Excel download</button>' +
      '<button class="btn ghost" onclick="Admin.dlAll(this)">Sab reports (ek file)</button></div></div>';

    /* ── delete ── it asks its own question, so looking at a report can never change what goes ── */
    var d = Admin.ddel;
    var needEmp = whats.some(function (w) { return Admin.needEmp(w); }) && !codes.length;
    var stop = !whats.length || needEmp;
    var prev = Admin.delRowsAll(codes, r);
    h += '<div class="sec-title">Data delete</div><div class="card">' +
      '<div class="sub">Kya hatana hai, kiska, aur kis range ka — teen cheezein. Employee aur date ' +
      'range upar se aati hain.</div>' +
      UI.multi({ label:'Kya delete karna hai', sub:'Group, ya seedha ek tab — ek se zyada bhi',
        items:Admin.DEL.map(function (x) { return [x[0], x[1], x[3] || '']; })
          .concat(Admin.DELKINDS().map(function (k) {
            return [k[0], k[1], 'Sirf ye ek tab — ' + (k[2] || '')]; })),
        sel:whats, tgl:'Admin.tglWhat', all:'Admin.allWhats', max:230 }) +
      (whats.length && !needEmp ? '<div class="hint" style="margin-top:8px">' +
        esc(whats.map(Admin.delLbl).join(' + ')) + ' · ' + esc(who) + ' · ' +
        esc(dmy(r[0]) + ' – ' + dmy(r[1])) + ' — is device par <b>' + prev.n + ' row</b>' +
        (Object.keys(prev.tabs).length ? ' <i>(' + esc(Object.keys(prev.tabs).map(function (t) {
          return t + ' ' + prev.tabs[t]; }).join(', ')) + ')</i>' : '') + '</div>' : '') +
      whats.map(function (w) { return Admin.delWarn(w, codes, r); }).join('') +
      /* a month-keyed row needs the WHOLE month inside the range — offer that in one tap rather than
         leaving him to wonder why the draft survived */
      (Admin.sparedMonths(r).length
        ? '<div class="strip w"><span class="g">!</span><div class="m"><b>' +
          esc(Admin.sparedMonths(r).join(', ')) + '</b> ka month-wala row (PJP draft / TA-DA) ' +
          '<i>nahi jayega</i> — range poore month ka nahi hai.</div>' +
          '<button class="btn ghost sm" style="flex:0 0 auto" onclick="Admin.wholeMonths()">' +
          'Poora month karo</button></div>' : '') +
      '<div class="btns"><button class="btn ghost" onclick="Admin.count(this)"' +
        (stop ? ' disabled' : '') + '>Kitna delete hoga? (count)</button>' +
      /* live as soon as there is something to delete — it counts on its own before asking */
      '<button class="btn bad" onclick="Admin.purge(this)"' + (stop ? ' disabled' : '') +
      '>Delete karo' + (d && d.matched ? ' (' + d.matched + ')' : '') + '</button></div>' +
      (d ? '<div class="strip ' + (d.matched ? 'w' : 'b') + '" style="margin-bottom:0"><span class="g">' +
        (d.matched ? '!' : 'i') + '</span><div class="m"><b>' + d.matched + ' row delete honge</b> <i>· ' +
        esc(Object.keys(d.tabs || {}).filter(function (k) { return d.tabs[k]; })
          .map(function (k) { return k + ' ' + d.tabs[k]; }).join(', ') || 'kuch nahi') + '</i></div></div>' +
        ((d.sample || []).length ? '<div class="hint" style="margin-top:6px">' +
          esc(d.sample.join(' · ')) + (d.matched > d.sample.length ? ' …' : '') + '</div>' : '') : '') +
      '<div class="hint" style="margin-top:8px">Parent ke saath child row apne aap jaati hai — order ' +
      'ke saath uski lines aur photo, shop/POSM ke saath unki photo. Koi aadha record nahi bachta.</div>' +
      '<div class="hint">Month wali cheezein (PJP draft, TA/DA) tabhi jaati hain jab poora month range ' +
      'me ho — ek din delete karne se poora month nahi jata.</div>' +
      '<div class="hint">Activity log apne aap nahi jata, Drive ki photo file nahi jati, master tab ' +
      '(employee, store, product, config, phasing) kabhi nahi chhutte.</div>' +
      '<div class="hint">Delete Admin aur HOD dono kar sakte hain. Employee ke paas delete hai hi ' +
      'nahi — uske Data tab me sirf download hai.</div></div>';

    h += Admin.master();
    return h;
  },
  /* the rows a choice describes, on this device — the same filter the server will apply */
  pick: function (kind, codes, r) {
    var want = Admin.codeSet(codes);
    /* the PJP is two tables: published days, plus the drafts of the months the range touches */
    if (kind === 'PJP') {
      var x = Admin.pjpRows(codes, r ? r[0] : '0000-01-01', r ? r[1] : '9999-12-31');
      return x.pub.concat(x.dr);
    }
    return DB.rows(kind).filter(function (x) {
      if (want && !want[String(x.EmpCode || '').trim().toUpperCase()]) return false;
      var d = toISO(x.Date);
      if (!d) return !r;                                  /* undated rows only when no range is asked */
      return d >= r[0] && d <= r[1];
    });
  },
  /* '' / [] / 'ALL' → everybody (null); otherwise a lookup of the codes asked for */
  codeSet: function (codes) {
    var a = codes == null ? [] : (typeof codes === 'string' ? [codes] : codes);
    a = a.filter(function (c) { return c && String(c).toUpperCase() !== 'ALL'; });
    if (!a.length) return null;
    var out = {}; a.forEach(function (c) { out[String(c).trim().toUpperCase()] = 1; });
    return out;
  },

  /* ══ WHAT GOES ══
     The groups an admin thinks in. Each one is a set of tabs the server takes together, children
     included (an order's lines and photos, a shop's photos), so the sheet never keeps half a record.
     `emp` = an employee must be named. `warn` = the extra sentence this choice deserves. */
  dwhat:'',
  /* [code, label, needEmp, what exactly goes] — slot 2 is the needEmp FLAG (read by needEmp()), so
     the description has to live in slot 3. */
  DEL:[
    ['EVERYTHING', 'Sab kuch — poora data', 1,
      'Orders + lines, naye shop, POSM audit + requirement, day plan, plan change, PJP (published + draft), TA/DA, EOD, DFR, stock remark aur photo row. Activity log, Drive ki file aur master tab nahi jate.'],
    ['PJP',        'PJP — published din + month draft', 0,
      'Master_PJP ke published din AUR unke peeche ka month draft — dono. Range poore month ki honi chahiye warna draft bach jayega.'],
    ['ORDERS',     'Orders — lines aur photos ke saath', 0,
      'SecOrders ke saath uski SKU lines aur us visit par li gayi photo row — aadha order kabhi nahi bachta.'],
    ['SHOPS',      'Naye shop — photos ke saath', 0,
      'NewStores ke row aur unki photo row. Store master (Master_Stores) ko kuch nahi hota.'],
    ['POSM',       'POSM — audit aur requirement', 0,
      'PosmAudit aur PosmRequirement — dono tab, photo row ke saath.'],
    ['PLAN',       'Day plan aur plan change', 0,
      'DayPlan (roz ka plan, login aur day-start time) aur Deviation (plan change request + HOD decision).'],
    ['CLAIMS',     'TA / DA claim', 0,
      'TaDa ke month row — claim, deduction, net aur HOD ka decision. Range poore month ki honi chahiye.'],
    ['DAYEND',     'EOD aur DFR', 0,
      'Eod (din ka close, SC/TC/PC, MRP value, NSV) aur Dfr (din ka activity roll-up).'],
    ['STOCK',      'Stock remark', 0,
      'StockRemark ke row. Stock_Store / Stock_Distributor upload ko kuch nahi hota.'],
    ['PHOTOS',     'Photos (row — Drive file rehti hai)', 0,
      'Sirf Photos tab ke row. Drive me file jahan hai wahin rehti hai — link toot jayega, file nahi jayegi.'],
    ['LOG',        'Activity log', 0,
      'ActivityLog — kisne kya kiya ka record. Ye khud se kabhi nahi jata; hataane par history chali jayegi.']
  ],
  /* the same tabs the server groups them into, so the count on the screen is the count that goes */
  GRP:{ EVERYTHING:['Master_PJP','SecOrders','SecOrderLines','NewStores','PosmAudit','PosmRequirement',
                    'DayPlan','Deviation','PjpDraft','TaDa','Eod','Dfr','StockRemark','Photos'],
        PJP:['Master_PJP','PjpDraft'], ORDERS:['SecOrders','SecOrderLines'], SHOPS:['NewStores'],
        POSM:['PosmAudit','PosmRequirement'], PLAN:['DayPlan','Deviation'], CLAIMS:['TaDa'],
        DAYEND:['Eod','Dfr'], STOCK:['StockRemark'], PHOTOS:['Photos'], LOG:['ActivityLog'] },
  delLbl: function (w) {
    var x = Admin.DEL.filter(function (y) { return y[0] === w; })[0];
    if (x) return x[1];
    var k = Admin.KINDS.filter(function (y) { return y[0] === w; })[0];
    return k ? k[1] : (w || '—');
  },
  needEmp: function (w) {
    var x = Admin.DEL.filter(function (y) { return y[0] === w; })[0];
    return !!(x && x[2]);
  },
  tabsOf: function (w) { return Admin.GRP[w] ? Admin.GRP[w].slice() : (w ? [w] : []); },
  /* what that choice describes on this device — the server's dry run is still the authority, this is
     what the screen can say before he taps anything */
  /* every chosen thing, counted ONCE per tab — a tab in two groups is still one tab */
  delRowsAll: function (codes, r) {
    var out = { n:0, tabs:{} };
    Admin.tabList().forEach(function (t) {
      var rows = t === 'Master_PJP' ? Admin.pjpRows(codes, r[0], r[1]).pub
               : t === 'PjpDraft' ? Admin.pjpRows(codes, r[0], r[1]).dr
               : Admin.pick(t, codes, r);
      if (rows.length) out.tabs[t] = rows.length;
      out.n += rows.length;
    });
    return out;
  },
  delRows: function (w, codes, r) {
    var out = { n:0, tabs:{} };
    Admin.tabsOf(w).forEach(function (t) {
      var rows = t === 'Master_PJP' ? Admin.pjpRows(codes, r[0], r[1]).pub
               : t === 'PjpDraft' ? Admin.pjpRows(codes, r[0], r[1]).dr
               : Admin.pick(t, codes, r);
      if (rows.length) out.tabs[t] = rows.length;
      out.n += rows.length;
    });
    return out;
  },
  setDel: function (v) { Admin.dwhats = v ? [v] : []; Admin.ddel = null; render(); },
  /* ══ ask the server ══
     One call with every choice on it: the server resolves the groups and de-duplicates the tabs, so
     "PJP drafts" + "PJP (published + draft)" counts the draft once. If the answer says it did not
     understand the request — an Apps Script project that predates groups, comma lists or the PJP delete
     — the same work is retried one TAB at a time, so whatever that older script does understand still
     goes and the rest is reported by name. */
  tabList: function () {
    var out = [], seen = {};
    Admin.dwhats.forEach(function (w) {
      Admin.tabsOf(w).forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });
    });
    return out;
  },
  blank: function (dry) {
    return { ok:true, dry:!!dry, matched:0, deleted:0, tabs:{}, children:{}, months:[], sample:[],
             errors:[], calls:0 };
  },
  merge: function (agg, res) {
    agg.matched += num(res.matched); agg.deleted += num(res.deleted);
    Object.keys(res.tabs || {}).forEach(function (t) {
      if (num(res.tabs[t])) agg.tabs[t] = (agg.tabs[t] || 0) + num(res.tabs[t]); });
    Object.keys(res.children || {}).forEach(function (t) {
      agg.children[t] = (agg.children[t] || 0) + num(res.children[t]); });
    (res.months || []).forEach(function (m) { if (agg.months.indexOf(m) < 0) agg.months.push(m); });
    (res.sample || []).forEach(function (x) { if (agg.sample.length < 10) agg.sample.push(x); });
    return agg;
  },
  /* "the other end does not understand this request" — as opposed to a real refusal like "pick an
     employee", which must NOT be retried tab by tab */
  stale: function (err) { return /unknown sheet|refused: *master/i.test(String(err || '')); },
  call: function (sheet, r, dry) {
    var body = { action:'purge', email:Auth.session().email, sheet:sheet,
                 code:Admin.dcodes.join(',') || 'ALL', from:r[0], to:r[1] };
    if (dry) body.dry = '1';
    return Api.post(body).then(function (res) { return res || { ok:false, error:'server ne jawab nahi diya' }; },
      function (e) { return { ok:false, error:String((e && e.message) || e) }; });
  },
  ask: function (r, dry) {
    var agg = Admin.blank(dry);
    if (!Admin.dwhats.length) return Promise.resolve(agg);
    return Admin.call(Admin.dwhats.join(','), r, dry).then(function (res) {
      agg.calls = 1;
      if (res.ok) return Admin.merge(agg, res);
      if (!Admin.stale(res.error)) {
        agg.ok = false; agg.errors.push(String(res.error));
        return agg;
      }
      /* an older sheet script: one tab at a time, on the de-duplicated list */
      var tabs = Admin.tabList(), out = Admin.blank(dry);
      out.fallback = true;
      var step = function (k) {
        if (k >= tabs.length) return out;
        syncChip('Delete: ' + (k + 1) + ' / ' + tabs.length + ' …');
        return Admin.call(tabs[k], r, dry).then(function (one) {
          out.calls++;
          if (one.ok) Admin.merge(out, one);
          else { out.ok = false; out.errors.push(tabs[k] + ' — ' + String(one.error)); }
          return step(k + 1);
        });
      };
      return Promise.resolve(step(0));
    });
  },
  /* a failure is never a toast: it says what the server said, and what that usually means */
  oops: function (res) {
    var errs = (res.errors || []).join('<br>');
    var old = /unknown sheet|refused|admin only/i.test(errs);
    return UI.alert({ icon:'!', title:'Delete nahi hua', ok:'Theek hai',
      msg:'<b>Server ne ye kaha:</b><br>' + esc(errs || 'koi jawab nahi') +
        (old ? '<br><br><b>Aksar iska matlab:</b> Apps Script ka deployment purane version ka hai' +
               (Admin._ver && Admin._ver !== '?' ? ' (v' + esc(Admin._ver) + ', chahiye v' +
                 esc(NEED_VER) + ')' : '') + '. ' +
               'backend.gs dobara paste karke <b>New deployment</b> karo — ya agar "admin only" likha ' +
               'hai to wahi purana version hai.' : '') });
  },
  /* what happened, in full — so "kuch nahi hua" can never be a guess */
  told: function (res, r) {
    var lines = Object.keys(res.tabs).filter(function (t) { return num(res.tabs[t]); })
      .map(function (t) { return t + ' — ' + res.tabs[t]; });
    if (res.fallback) lines.push('(purane script ke liye tab-by-tab kiya gaya)');
    var spared = Admin.sparedMonths(r);
    return UI.alert({ icon:'', title:res.deleted + ' row delete ho gaye', ok:'Theek hai',
      msg:(lines.length ? '<b>Kahan se:</b><br>' + esc(lines.join('<br>')) : 'Kuch match nahi hua.') +
        (Object.keys(res.children).length ? '<br><br><i>Child rows (lines / photos) bhi isme hain.</i>' : '') +
        (spared.length ? '<br><br><b>Ye nahi gaya:</b> ' + esc(spared.join(', ')) +
          ' ka month-wala row (PJP draft / TA-DA) — poora month range me hona chahiye tha.' : '') });
  },
  /* the months this range touches but does NOT cover end to end — exactly what a month-keyed row needs */
  sparedMonths: function (r) {
    if (!Admin.dwhats.some(function (w) {
      return Admin.tabsOf(w).some(function (t) { return t === 'PjpDraft' || t === 'TaDa'; }); })) return [];
    var out = [], m = r[0].slice(0, 7), guard = 0;
    while (m <= r[1].slice(0, 7) && guard++ < 36) {
      var last = new Date(+m.slice(0, 4), +m.slice(5, 7), 0);
      if (r[0] > m + '-01' || r[1] < iso(last)) out.push(Admin.monLbl(m));
      var y = +m.slice(0, 4), n = +m.slice(5, 7) + 1;
      if (n > 12) { n = 1; y++; }
      m = y + '-' + p2(n);
    }
    return out;
  },
  /* one tap to widen the range to whole months, because that is what those rows need */
  wholeMonths: function () {
    var r = Admin.dRange();
    var m0 = r[0].slice(0, 7), m1 = r[1].slice(0, 7);
    var last = new Date(+m1.slice(0, 4), +m1.slice(5, 7), 0);
    Admin.dfrom = m0 + '-01'; Admin.dto = iso(last);
    Admin.ddel = null; render();
    toast('Range poore month ka kar diya — ' + dmy(Admin.dfrom) + ' se ' + dmy(Admin.dto));
  },

  /* the sentence this particular choice deserves — said BEFORE the button */
  delWarn: function (w, codes, r) {
    if (!w) return '';
    var code = Admin.codeSet(codes) ? codes : null;      /* [] is truthy — count it, do not test it */
    if (Admin.needEmp(w) && !code)
      return '<div class="banner w"><span>!</span><div><b>Ek employee chuno</b><br>' +
        '<span style="font-weight:500">"Sab kuch" ek aadmi ka hi hatta hai. Sab ke liye — ek-ek report ' +
        'chuno, ya Days range ke saath.</span></div></div>';
    var h = '';
    if (w === 'EVERYTHING')
      h += '<div class="banner w"><span>!</span><div><b>Poora data jayega</b><br>' +
        '<span style="font-weight:500">Orders (+lines), naye shop, POSM, day plan, plan change, PJP ' +
        '(published + draft), TA/DA, EOD, DFR, stock remark aur photo row — sab is range ke.<br>' +
        'Activity log nahi jata (wo record hai), Drive ki photo file nahi jati, master tab nahi jate.' +
        '</span></div></div>';
    if (w === 'EVERYTHING' || w === 'PJP') h += Admin.pjpWarn(code, r);
    if (w === 'ORDERS')
      h += '<div class="banner b"><span>i</span><div>' +
        'Order ke saath uski lines aur us par li gayi photo row bhi jayegi — aadha record nahi bachega.' +
        '</div></div>';
    if (w === 'SHOPS')
      h += '<div class="banner b"><span>i</span><div>' +
        'Naye shop ke saath uski photo row bhi jayegi. Store master (Master_Stores) chhuta nahi.' +
        '</div></div>';
    if (w === 'LOG')
      h += '<div class="banner w"><span>!</span><div>' +
        'Activity log record hai — kisne kya kiya. Isse hataane par wo history chali jayegi.' +
        '</div></div>';
    return h;
  },
  dl: function (el) {
    var r = Admin.dRange(), kinds = Admin.dkinds.slice(), codes = Admin.dcodes.slice();
    if (!kinds.length) return toast('Pehle report chuno');
    return Busy.run('dl', el, 'Ban raha hai…', function () {
      /* one report → that report's own file; several → one file, one tab each */
      var f = kinds.length === 1
        ? (kinds[0] === 'PJP' ? Admin.pjpXl(codes, r[0], r[1]) : Rep.any(kinds[0], codes, r[0], r[1]))
        : Rep.some(kinds, codes, r[0], r[1]);
      Log.add('Data', 'Downloaded ' + kinds.join(','), codes.join(',') || 'ALL', r[0] + '..' + r[1]);
      toast('Download shuru — ' + kinds.length + ' report');
      return Promise.resolve(f);
    });
  },
  dlAll: function (el) {
    var r = Admin.dRange(), codes = Admin.dcodes.slice();
    return Busy.run('dlall', el, 'Ban raha hai…', function () {
      var f = Rep.everything(codes, r[0], r[1]);
      toast('Download shuru — ' + f.sheets + ' tab');
      return Promise.resolve(f);
    });
  },
  count: function (el) {
    var r = Admin.dRange();
    if (!Admin.dwhats.length) return toast('Pehle chuno kya delete karna hai');
    return Busy.run('cnt', el, 'Gin raha hai…', function () {
      return Admin.ask(r, true).then(function (res) {
        Admin.ddel = res.ok || res.matched ? res : null;
        render();
        if (!res.ok) return Admin.oops(res);
        toast(res.matched + ' row delete honge');
      });
    });
  },
  /* No separate count needed: this asks the server how many there are, shows THAT number in the
     confirmation, and only then deletes. The Delete button used to be disabled until a count had been
     run, which made it look broken. */
  purge: function (el) {
    var r = Admin.dRange(), who = Admin.whoText();
    if (!Admin.dwhats.length) return toast('Pehle chuno kya delete karna hai');
    if (Admin.dwhats.some(Admin.needEmp) && !Admin.dcodes.length) return toast('Ek employee chuno');
    return Busy.run('purge', el, 'Gin raha hai…', function () {
      return Admin.ask(r, true).then(function (d) {
        Admin.ddel = d.ok || d.matched ? d : null;
        render();
        /* nothing to do at all → say why. Something to do, even with a part of it failing → offer the
           part that works, with the failures spelled out above the confirmation. */
        if (!d.matched) return d.ok
          ? UI.alert({ icon:'i', title:'Kuch match nahi hua', ok:'Theek hai',
              msg:'Is range me is employee ka koi row nahi mila. Date range ya employee badal ke dekho.' })
          : Admin.oops(d);
        return UI.prompt({ icon:'', title:d.matched + ' row delete karne hain?', danger:true,
          msg:'<b>' + esc(Admin.dwhats.map(Admin.delLbl).join(' + ')) + '</b> · ' + esc(who) + ' · ' +
            esc(dmy(r[0]) + ' – ' + dmy(r[1])) +
            (d.errors.length ? '<br><br><b>Ye check nahi ho paya:</b><br>' + esc(d.errors.join('<br>')) +
              '<br><i>Baaki ka delete ho jayega.</i>' : '') +
            '<br>Ye wapas nahi aayega. Confirm karne ke liye niche DELETE likho.',
          label:'DELETE likho', placeholder:'DELETE', required:true,
          requiredMsg:'DELETE likhna zaroori hai',
          ok:'Haan, delete karo', cancel:'Abhi nahi' }).then(function (v) {
          if (!v) return;
          if (String(v).trim().toUpperCase() !== 'DELETE') return toast('DELETE likhna zaroori hai');
          return Admin.ask(r, false).then(function (res) {
            Log.add('Data', 'Deleted ' + res.deleted + ' rows from ' + Admin.dwhats.join(',') +
              ((res.months || []).length ? ' (' + res.months.join(', ') + ')' : ''),
              Admin.dcodes.join(',') || 'ALL', r[0] + '..' + r[1]);
            Admin.ddel = null;
            if (!res.ok && !res.deleted) return Admin.oops(res);
            /* a FULL pull: the published PJP lives in a master, and a light sync does not fetch those */
            return DB.pull(true).then(function () {
              render();
              return Admin.told(res, r);
            }).then(function () {
              if (res.errors.length) return Admin.oops(res);
              if (Admin.dwhats.some(function (w) { return /^(PJP|EVERYTHING)$/.test(w); }) &&
                  !Pjp.winOpen())
                toast('PJP hat gaya aur window band hai — Users tab se uska PJP kholna padega', 7000);
            });
          });
        });
      });
    });
  },
  pjpState: function (d, pubDays) {
    var st = d ? Appr.norm(d.Status) : '';
    if (st === 'pending')  return { k:'pending',  lbl:['HOD ko bheja', 'p-warn'],
                                    note:'Approval ke liye bheja hua hai' };
    if (st === 'rejected') return { k:'rejected', lbl:['Rejected', 'p-bad'],
                                    note:'Reject hua — theek karke dobara bhejna hai' };
    if (pubDays)           return { k:'live',     lbl:['PJP defined', 'p-ok'],
                                    note:pubDays + ' din Master_PJP me live' };
    if (st === 'approved') return { k:'approved', lbl:['Approved', 'p-ok'],
                                    note:'Approve ho gaya — master me publish hona pending hai' };
    return { k:'none', lbl:['Bheja nahi', 'p-grey'], note:'Abhi HOD ko bheja hi nahi' };
  },

  /* one employee's month: the draft they built + what is live in Master_PJP, day by day */
  pjpOne: function (code, mon) {
    var e = DB.emp(code) || { Code:code, Name:code };
    var d = DB.find('PjpDraft', code + '__' + mon);
    var days = {}; try { days = JSON.parse((d && d.DaysJson) || '{}') || {}; } catch (x) {}
    var pub = {};
    DB.pjpMonth(code, mon).forEach(function (r) { pub[toISO(r.Date)] = r; });
    var st = d ? Appr.norm(d.Status) : '';
    var pst = Admin.pjpState(d, Object.keys(pub).length), lbl = pst.lbl;

    var h = '<div class="card"><div class="ap-h"><span class="ap-ic"></span>' +
      '<div class="m"><div class="t">' + esc(e.Name) + '</div><div class="s">' + esc(code) + ' \u00b7 ' +
        esc(e.HQ || '') + ' \u00b7 ' + (monthName(mon) || mon) + '</div></div>' +
      '<span class="pill ' + lbl[1] + '">' + lbl[0] + '</span></div>' +
      /* A re-submitted month still carries the LAST decision's HodBy/HodAt (the upsert merges), so
         once the status is pending again this has to read as history \u2014 it used to relabel an old
         REJECTION as " Approve kiya" purely because the new status was no longer 'rejected'. */
      (d && d.HodBy ? '<div class="hint" style="margin-top:6px">' +
        (st === 'pending' ? ' Pichhla decision: ' + (d.RejectReason ? ' Reject' : ' Approve') + ' \u2014 '
                          : (st === 'rejected' ? ' Reject' : ' Approve') + ' kiya: ') +
        '<b>' + esc(d.HodBy) + '</b>' +
        (d.HodRole ? ' <b>(' + esc(d.HodRole) + ')</b>' : '') +
        (d.HodAt ? ' \u00b7 ' + Appr.when(d.HodAt) : '') +
        (d.PublishedRows ? ' \u00b7 ' + d.PublishedRows + ' din Master_PJP me publish' : '') + '</div>' : '') +
      (d && st === 'rejected' && d.RejectReason ? '<div class="banner r" style="margin-top:8px"><span></span>' +
        '<div>' + esc(d.RejectReason) + '</div></div>' : '') +
      /* say WHY it reads "PJP defined" when there is no draft row to point at */
      (!d && pst.k === 'live' ? '<div class="hint" style="margin-top:6px"> <b>' + Object.keys(pub).length +
        ' din</b> Master_PJP me live hain \u2014 master me plan approval ke baad hi aata hai. Is month ka ' +
        'draft row app me nahi hai (sheet me seedha load hua tha).</div>' : '') +
      (d && pst.k === 'pending' && Object.keys(pub).length ? '<div class="hint" style="margin-top:6px">' +
        ' Naya submission HOD ke paas hai. Filhaal master me purane <b>' + Object.keys(pub).length +
        ' din</b> live hain \u2014 approve karne par overwrite ho jayenge.</div>' : '') +
      (d && Admin.rejDays(d).length ? '<div class="banner w" style="margin-top:8px"><span>!</span><div><b>' +
        Admin.rejDays(d).length + ' din reject kiye hue hain</b><br><span style="font-weight:500">' +
        Admin.rejDays(d).map(function (k) { return dmy(k); }).join(', ') +
        ' \u2014 rep sirf yeh din edit kar sakta hai.</span></div></div>' : '') +
      '<div class="btns"><button class="btn ghost sm" onclick="Admin.pjpEmp=&quot;&quot;;render()">\u2039 Sab employee</button>' +
      (d && st === 'pending' ?
        '<button class="btn ok sm" onclick="Admin.toBar()">Approve</button>' +
        '<button class="btn bad sm" onclick="Admin.toBar()">Reject</button>' : '') + '</div>' +
      (d && st === 'pending' ? '<div class="hint" style="margin-top:6px">Poora plan niche hai \u2014 ' +
        'padho, galat din tick karo, phir niche se decide karo.</div>' : '') +
      (d && st === 'partial' ? '<div class="banner b" style="margin-top:8px"><span></span><div>' +
        '<b>Rep ke paas hai</b><br><span style="font-weight:500">' + Admin.rejDays(d).length +
        ' din wapas bheje hue hain — rep theek karke dobara bhejega, tab approve kar sakte ho.' +
        '</span></div></div>' : '') +
      '</div>' +
      (d ? Admin.pjpDays(d.Key, true) : '');

    var keys = {};
    Object.keys(days).forEach(function (k) { keys[k] = 1; });
    Object.keys(pub).forEach(function (k) { keys[k] = 1; });
    var list = Object.keys(keys).sort();
    if (!list.length) return h + UI.empty('', 'Is month ka koi PJP nahi \u2014 na draft, na master me');

    /* When there IS a draft, the interactive day list above is the review \u2014 repeating it as a
       read-only table underneath was the same month printed twice. This flat table stays for the
       months that only exist in Master_PJP (July's plans were loaded straight into the sheet and
       have no draft row to tick). */
    if (d) return h;

    h += '<div class="sec-title">Master_PJP me ' + list.length + ' din</div><div class="card"><div class="tw"><table>' +
      '<thead><tr><th>Date</th><th>Din</th><th>Working with</th><th>Town</th><th>Beat</th><th>Master me</th></tr></thead><tbody>';
    var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    list.forEach(function (k) {
      var r = days[k] || {}, p = pub[k];
      var ww = r.ww || (p ? p.Ww : '') || '';
      h += '<tr><td>' + dmy(k) + '</td><td>' + DAY[new Date(k + 'T00:00:00').getDay()] + '</td>' +
        '<td>' + esc(Pjp.ww(ww)) + '</td><td>' + esc(r.city || (p ? p.Town : '') || '') + '</td>' +
        '<td>' + esc(r.beat || (p ? p.Beat : '') || '') + '</td>' +
        '<td>' + (p ? ' ' + esc(p.Week || '') : '\u2014') + '</td></tr>';
    });
    h += '</tbody></table></div></div>';
    return h;
  },

  /* the photos of one employee (or everybody) for the chosen period — it used to be its own tab */
  picsDay:'', picsEmp:'',
  pics: function (code, r) {
    var nm = String((DB.emp(code) || {}).Name || '').toUpperCase();
    var all = Pics.rows().filter(function (p) {
      if (code && String(p.EmpCode || '').toUpperCase() !== String(code).toUpperCase() &&
          String(p.Employee || '').toUpperCase() !== nm) return false;
      if (!r) return true;
      var d = toISO(p.Date);
      return !d || (d >= r[0] && d <= r[1]);
    });
    var h = '<div class="sec-title">Photos</div>';
    if (!all.length) return h + '<div class="card">' +
      UI.empty('', 'Is period me koi photo nahi') + '</div>';

    var days = [], emps = [], seenD = {}, seenE = {};
    all.forEach(function (p) {
      var d = toISO(p.Date), e = String(p.Employee || p.EmpCode || '');
      if (d && !seenD[d]) { seenD[d] = 1; days.push(d); }
      if (e && !seenE[e]) { seenE[e] = 1; emps.push(e); }
    });
    days.sort().reverse(); emps.sort();
    var day = Admin.picsDay || days[0], emp = Admin.picsEmp;

    h += '<div class="card" style="padding:10px"><div class="row two">' +
      '<div><label class="f">Date</label><select class="in" onchange="Admin.picsDay=this.value;render()">' +
        days.map(function (d) { return '<option value="' + d + '"' + (d === day ? ' selected' : '') + '>' + dmy(d) + '</option>'; }).join('') +
      '</select></div>' +
      '<div><label class="f">Employee</label><select class="in" onchange="Admin.picsEmp=this.value;render()">' +
        '<option value="">Sab employee</option>' +
        emps.map(function (e) { return '<option value="' + esc(e) + '"' + (e === emp ? ' selected' : '') + '>' + esc(e) + '</option>'; }).join('') +
      '</select></div></div></div>';

    var rows = all.filter(function (p) { return toISO(p.Date) === day && (!emp || String(p.Employee || '') === emp); });
    if (!rows.length) return h + UI.empty('', dmy(day) + ' ko koi photo nahi');

    var byEmp = {};
    rows.forEach(function (p) {
      var e = String(p.Employee || p.EmpCode || '—'), st = String(p.StoreName || '—');
      byEmp[e] = byEmp[e] || {};
      (byEmp[e][st] = byEmp[e][st] || []).push(p);
    });
    Object.keys(byEmp).sort().forEach(function (e) {
      var shops = byEmp[e], n = 0;
      Object.keys(shops).forEach(function (k) { n += shops[k].length; });
      h += '<div class="sec-title">' + esc(e) + ' · ' + dmy(day) + ' · ' + n + ' photo</div>';
      Object.keys(shops).sort().forEach(function (st) {
        var ps = shops[st], folder = '';
        for (var i = 0; i < ps.length && !folder; i++) folder = ps[i].FolderUrl || '';
        h += '<div class="card"><div class="ap-h"><span class="ap-ic"></span>' +
          '<div class="m"><div class="t">' + esc(st) + '</div><div class="s">' + ps.length + ' photo · ' +
            esc(ps.map(function (p) { return p.Slot; }).filter(Boolean).join(', ')) + '</div></div>' +
          (folder ? '<a class="pl" href="' + esc(folder) + '" target="_blank" rel="noopener">Drive folder </a>' : '') +
          '</div>' + Pics.strip(ps) + '</div>';
      });
    });
    return h;
  },

  /* ══ PJP adherence, day by day ══
     The app can infer whether a day was worked on plan, off plan or missed — but only the HOD knows
     that a rep sat at home on a day that has an order on it, or that a missed day was agreed. So every
     day of the month can be marked here, and a marking beats the inference on the rep's Summary.
     It is stored on the rep's own DayPlan row (PjpStatus), which the HOD may write because he is
     privileged; the row is created if the rep never saved one. */
  ADH:[['', '— auto —'], ['On PJP', 'On planned PJP'], ['Off PJP', 'Off PJP (approved)'],
       ['Missed', 'Missed']],
  adhDays: function (code, mon) {
    var out = [], t = today(), doj = DB.doj(code);
    var a = mon.split('-'), y = +a[0], m = +a[1], n = new Date(y, m, 0).getDate();
    for (var d = 1; d <= n; d++) {
      var k = y + '-' + p2(m) + '-' + p2(d);
      if (k > t) break;
      if (doj && k < doj) continue;
      var pjp = DB.pjpFor(code, k) || {};
      var pl = DB.find('DayPlan', code + '_' + k) || {};
      var ww = String(pl.WorkingWith || pjp.Ww || pjp.Week || '');
      out.push({ d:k, ww:ww, field:Home.FIELD.test(ww),
        town:pl.Town || pjp.Town || '', beat:pl.Beat || pjp.Beat || '',
        off:String(pl.OffPjp || '') === 'Yes', app:String(pl.Approval || ''),
        mark:String(pl.PjpStatus || ''), by:pl.PjpStatusBy || '' });
    }
    return out;
  },
  adh: function (code, mon) {
    var days = Admin.adhDays(code, mon);
    var work = days.filter(function (x) { return x.field; }).length;
    var mk = { 'On PJP':0, 'Off PJP':0, 'Missed':0 };
    days.forEach(function (x) { if (mk[x.mark] !== undefined) mk[x.mark]++; });
    var h = '<div class="sec-title">PJP adherence — ' + esc(monthName(mon) || mon) + '</div><div class="card">' +
      '<div class="hint">Working din <b>' + work + '</b> · marked: on-PJP ' + mk['On PJP'] +
      ' · off-PJP ' + mk['Off PJP'] + ' · missed ' + mk.Missed +
      '. Jo mark nahi kiya wo app khud nikalta hai (order hua = on-PJP, approved change = off-PJP, ' +
      'kuch nahi = missed).</div>';
    h += '<div class="pane" style="max-height:430px;margin-top:8px">';
    days.forEach(function (x) {
      h += '<div class="drow' + (x.mark === 'Missed' ? ' bad inset' : '') + '">' +
        '<div class="dr-h"><div class="m"><div class="t">' + dmy(x.d) +
          (x.field ? '' : ' <span class="pill p-grey">' + esc(x.ww || 'OFF') + '</span>') +
          (x.mark ? ' <span class="pill ' + (x.mark === 'Missed' ? 'p-bad' : 'p-ok') + '">' +
            esc(x.mark) + '</span>' : '') + '</div>' +
        '<div class="s">' + esc(x.town || '—') + (x.beat ? ' · ' + esc(x.beat) : '') +
          (x.off ? ' · change: ' + esc(x.app || 'Pending') : '') +
          (x.by ? ' · ' + esc(x.by) : '') + '</div></div>' +
        '<select class="in" style="width:auto;flex:0 0 auto;padding:7px 26px 7px 8px;font-size:12px"' +
          ' onchange="Admin.setAdh(\'' + esc(code) + '\',\'' + x.d + '\',this.value)">' +
          Admin.ADH.map(function (o) {
            return '<option value="' + o[0] + '"' + (o[0] === x.mark ? ' selected' : '') + '>' +
              o[1] + '</option>'; }).join('') + '</select>' +
        '</div></div>';
    });
    return h + '</div><div class="hint" style="margin-top:8px">List scroll karo — ' + days.length +
      ' din</div></div>';
  },
  setAdh: function (code, d, v) {
    var e = DB.emp(code) || {}, id = code + '_' + d;
    var row = DB.find('DayPlan', id) || { Id:id, Date:d, EmpCode:code, EmpName:e.Name || '' };
    return DB.save('DayPlan', Object.assign({}, row, { Id:id, Date:d, EmpCode:code,
      EmpName:row.EmpName || e.Name || '', PjpStatus:v,
      PjpStatusBy:v ? (DB.me.name + ' (' + Admin.role() + ')') : '',
      PjpStatusAt:v ? new Date().toISOString() : '' })).then(function () {
      Log.add('DayPlan', 'Adherence ' + (v || 'auto'), id, code);
      render();
      toast(dmy(d) + ' — ' + (v || 'auto') + ' mark ho gaya');
    });
  },

  /* who is deciding, and in what capacity — stamped on every decision so the sheet keeps the trail */
  role: function () { return String((Auth.session() || {}).rights || ''); },
  stamp: function () { return { HodBy:DB.me.name, HodRole:Admin.role(), HodAt:new Date().toISOString() }; },

  /* A new outlet and a POSM requirement are the employee's OWN records now — he opens the store,
     asks his ASM himself and marks the stage in the Tracker tab. There is deliberately no admin/HOD
     handler for either: two authorities writing one Status column is how a sheet starts lying. */

  /* TA/DA — decided in Tada.hodDo, day by day, because a month is not a yes/no. This shim keeps the
     generic Appr.act() contract: both buttons open the claim instead of deciding it unread. */
  tadaOk: function (id) { return Tada.jump(id); },

  /* ORDER STATUS — an HOD chasing billing should not have to open the sheet.
     Goes through Sec.commit so the line rows and totals stay in step. */
  setOrder: function (po, st) {
    var o = DB.find('SecOrders', po); if (!o) return;
    var lines = Sec.lines(o);          /* JSON, or rebuilt from the SecOrderLines rows */
    var nu = Object.assign({}, o, Admin.stamp(), { Status:st,
      DeliveredAt:st === 'Billing Done' ? new Date().toISOString() : (o.DeliveredAt || '') });
    Sec.commit(nu, lines, ' ' + o.StoreName + ' \u2192 ' + st).then(function () {
      Log.add('Order', 'Status ' + st + ' by ' + Admin.role(), po, o.StoreName);
    });
  },

  /* ══════════ PJP REVIEW — the day-by-day plan, for the person who has to decide ══════════
     ONE renderer, used by the Approvals card AND the Admin console's PJP tab, so the two can never
     show a different plan. An HOD does not want to be told to "go to that tab": the days are here.
       • every day is listed with its Working-With, State, Town and Beat;
       • any day can be TICKED for rejection — reject the three days that are wrong instead of
         throwing a whole month back;
       • an HOD or Admin can also just FIX a day themselves and approve.
     Selection lives per draft key so opening a second employee cannot inherit the first one's ticks. */
  pjpSel:{}, pjpOpen:'',
  /* post-approval edit mode — one key at a time; see Admin.pjpDays / pjpEditBar below */
  pjpEditKey:'', pjpEditSnap:null,
  sel: function (key) { return (Admin.pjpSel[key] = Admin.pjpSel[key] || {}); },
  selN: function (key) { var s = Admin.sel(key); return Object.keys(s).filter(function (k) { return s[k]; }).length; },
  tick: function (key, d, on) { Admin.sel(key)[d] = !!on; Admin.selCount(key); },
  /* update every copy of the button without a re-render — a re-render would collapse the day editor
     and lose the scroll position mid-selection */
  selLbl: function (n) {
    return !n ? 'Select kiye din reject karo'
      : n === 1 ? 'Sirf yeh ek din reject karo' : 'Sirf ye ' + n + ' din reject karo';
  },
  selCount: function (key) {
    var n = Admin.selN(key), jk = Appr.jid(key);
    var txt = I18n.s(Admin.selLbl(n));
    var all = document.querySelectorAll('.pjp-sel[data-k="' + jk + '"]');
    for (var i = 0; i < all.length; i++) { all[i].disabled = !n; all[i].innerHTML = txt; }
    var chips = document.querySelectorAll('.pjp-cnt[data-k="' + jk + '"]');
    for (var j = 0; j < chips.length; j++) {
      chips[j].className = 'pill ' + (n ? 'p-bad' : 'p-grey') + ' pjp-cnt';
      chips[j].innerHTML = I18n.s(n ? n + ' din select' : 'kuch select nahi');
    }
  },
  edit: function (key, d) { Admin.pjpOpen = Admin.pjpOpen === key + '|' + d ? '' : key + '|' + d; render(); },

  /* ══ editing a month that is ALREADY approved ══
     publishPjp_ has no status gate — it upserts on Code+Date whatever is in the draft — so the only
     thing standing between an HOD and fixing a mistake after the fact was the client hiding the Edit
     buttons. This opens them back up for one key at a time, snapshots the draft as it stood the
     moment editing started (so Publish can say exactly which days moved), and closes again either on
     Cancel or once the update is published. */
  pjpEditStart: function (key) {
    var d = DB.find('PjpDraft', key); if (!d) return;
    var days = {}; try { days = JSON.parse(d.DaysJson || '{}') || {}; } catch (e) {}
    Admin.pjpEditKey = key;
    Admin.pjpEditSnap = JSON.parse(JSON.stringify(days));
    render();
  },
  pjpEditCancel: function () { Admin.pjpEditKey = ''; Admin.pjpEditSnap = null; render(); },
  pjpEditBar: function (key) {
    return '<div class="card pjp-bar" onclick="event.stopPropagation()">' +
      '<div class="c-h"><h3>Update publish karo</h3></div>' +
      '<div class="hint" style="margin:-4px 0 8px">Jo din badle hain wahi Master_PJP me update honge, ' +
      'aur rep ko notification milega.</div>' +
      '<div class="btns">' +
        '<button class="btn ok" onclick="Admin.pjpRepublish(&quot;' + esc(key) + '&quot;)">' +
          'Publish update — rep ko bhejo</button>' +
        '<button class="btn ghost" onclick="Admin.pjpEditCancel()">Cancel</button>' +
      '</div></div>';
  },
  /* Republish an already-approved month after an HOD edit. publishPjp_ re-upserts every day in the
     draft (idempotent — Code+Date), so this is the exact same call pjpOk makes; the only new part is
     working out which days actually moved (against the snapshot taken when editing opened) and
     telling the rep about it. */
  /* ── field-level diff, in plain words ──
     "X din badle" said nothing about WHAT changed. Every field that moved, on every changed day, is
     spelled out as old value → new value, so the notification IS the record of the edit — not a
     hint that one happened. */
  FLD_LBL:{ ww:'Working with', state:'State', city:'Town', beat:'Beat', st:'Station', rmk:'Remarks' },
  PJP_FLD:['ww', 'state', 'city', 'beat', 'st', 'rmk'],
  pjpDiffText: function (before, days, changed) {
    return changed.map(function (k) {
      var a = before[k] || {}, b = days[k] || {}, diffs = [];
      Admin.PJP_FLD.forEach(function (f) {
        var av = a[f] || '', bv = b[f] || '';
        if (f === 'ww') { av = av ? Pjp.ww(av) : ''; bv = bv ? Pjp.ww(bv) : ''; }
        if (f === 'st') { av = av ? Pjp.stn(av) : ''; bv = bv ? Pjp.stn(bv) : ''; }
        if (av === bv) return;
        diffs.push(Admin.FLD_LBL[f] + ': ' + (av || '—') + ' → ' + (bv || '—'));
      });
      return dmy(k) + ' — ' + (diffs.length ? diffs.join(', ') : 'update');
    }).join('\n');
  },
  pjpRepublish: function (key) {
    var d = DB.find('PjpDraft', key); if (!d || Busy.busy('pjprep_' + key)) return;
    Busy.on['pjprep_' + key] = true; setTimeout(function () { delete Busy.on['pjprep_' + key]; }, 4000);
    var days = {}; try { days = JSON.parse(d.DaysJson || '{}') || {}; } catch (e) {}
    var before = Admin.pjpEditSnap || {};
    var changed = Object.keys(days).filter(function (k) {
      var a = before[k] || {}, b = days[k] || {};
      return Admin.PJP_FLD.some(function (f) { return (a[f] || '') !== (b[f] || ''); });
    }).sort();
    if (!changed.length) { toast('Kuch change nahi hua'); Admin.pjpEditCancel(); return; }
    var detail = Admin.pjpDiffText(before, days, changed);
    toast('Master_PJP me publish ho raha hai…');
    Api.post({ action:'publishPjp', email:Auth.session().email, key:key }).then(function (r) {
      if (!r || !r.ok) { toast('! Publish fail: ' + ((r && r.error) || 'unknown'), 5000); return; }
      Log.add('PJP', 'Republished after approval by ' + Admin.role(), key, detail);
      return DB.save('Notify', { Id:uid('NT'), Ts:new Date().toISOString(),
        EmpCode:d.EmpCode, EmpName:d.EmpName, Kind:'PJP',
        Title:'PJP update \u2014 ' + (monthName(d.Month) || d.Month || '') + ' \u00b7 ' +
          changed.length + ' din badle',
        Detail:detail,
        Ref:key, Status:'Open', By:DB.me.name }, { quiet:true }).then(function () {
        toast(changed.length + ' din update ho gaye \u2014 rep ko notification mil jayega');
        Admin.pjpEditCancel();
        return Sync.now(false);
      });
    }).catch(function () { toast('! Publish nahi hua \u2014 dobara try karo'); });
  },
  /* the top pair does not decide — it takes the reader to the bar under the day list */
  toBar: function () {
    var b = document.querySelector('#view .pjp-bar');
    if (b && b.scrollIntoView) b.scrollIntoView({ block:'center' });
    toast('Galat din tick karo, phir yahan se decide karo', 3200);
  },

  /* Approve / reject, as a row of buttons. Rendered ABOVE the day list and again BELOW it, because
     the decision is taken at the bottom of a 31-day list and nobody should have to scroll back up to
     act on it. `Reject only the selected days` appears the moment a day is ticked. */
  pjpBar: function (key, pos) {
    var d = DB.find('PjpDraft', key); if (!d) return '';
    /* only a PENDING month is the HOD's to decide. Approved is finished; partially rejected and fully
       rejected are both back with the rep. */
    if (Appr.norm(d.Status) !== 'pending') return '';
    var n = Admin.selN(key), q = esc(key), jk = Appr.jid(key) + '_' + pos;
    return '<div class="card pjp-bar" onclick="event.stopPropagation()">' +
      '<div class="c-h"><h3>Ab decide karo</h3><span class="pill ' + (n ? 'p-bad' : 'p-grey') +
        ' pjp-cnt" data-k="' + Appr.jid(key) + '">' +
        (n ? n + ' din select' : 'kuch select nahi') + '</span></div>' +
      (n ? '<div class="banner r" style="margin:8px 0 0"><span>' + n + '</span><div><b>' +
        (n === 1 ? 'Ek din select kiya hai' : n + ' din select kiye hain') +
        '</b><br><span style="font-weight:500">Sirf yehi din reject honge \u2014 ' +
        'baaki month approve rahega.</span></div></div>' : '') +
      '<div class="btns">' +
        '<button class="btn bad pjp-sel" data-k="' + Appr.jid(key) + '" id="pjp_part_' + jk + '"' +
          (n ? '' : ' disabled') + ' onclick="Admin.pjpPart(&quot;' + q + '&quot;)">' +
          Admin.selLbl(n) + '</button>' +
      '</div>' +
      '<div class="btns">' +
        '<button class="btn ok" onclick="Admin.pjpOk(&quot;' + q + '&quot;)">Approve all</button>' +
        '<button class="btn bad ghost" onclick="Admin.pjpNo(&quot;' + q + '&quot;)">Reject all</button>' +
      '</div>' +
      '<div class="hint" style="margin-top:6px">Ya kisi din par Edit dabakar khud theek kar do, phir Approve all.</div>' +
      '</div>';
  },

  /* an HOD editing a rep's plan must be offered the REP's towns, not their own */
  pjpDays: function (key, act) {
    var d = DB.find('PjpDraft', key); if (!d) return '';
    var draft = {}; try { draft = JSON.parse(d.DaysJson || '{}') || {}; } catch (e) {}
    /* ── "whole month" has to mean the whole month ──
       A draft only carries the days the rep actually touched, so listing DaysJson alone could show two
       days and call it a month. The month as it STANDS is: what is already approved in Master_PJP, with
       the draft's version winning wherever the draft has one. */
    var days = {}, fromMaster = {};
    DB.pjpMonth(d.EmpCode, d.Month).forEach(function (r) {
      var k = toISO(r.Date); if (!k) return;
      fromMaster[k] = 1;
      days[k] = { ww:Pjp.ww(r.Ww), state:r.State || Plan.stateOfFor(d.EmpCode, r.Town) || '',
                  city:r.Town || '', beat:r.Beat || '', st:'HQ' };
    });
    Object.keys(draft).forEach(function (k) { days[k] = draft[k]; delete fromMaster[k]; });
    var rej = Admin.rejDays(d), fix = Admin.fixDays(d);
    var st = Appr.norm(d.Status);
    /* an APPROVED month has already been decided — nothing left to tick-and-reject — but an HOD who
       spots a mistake later needs a way back in. pjpEditKey is that door: once opened for THIS key,
       the same per-day Edit buttons a pending review gets light up again, and a publish-update bar
       replaces the normal decide bar at the bottom. */
    var editing = Admin.pjpEditKey === key;
    var can = act && Auth.isAdmin() && (st === 'pending' || editing);
    var all = Object.keys(days).sort();
    if (!all.length) return '<div class="hint">Is draft me koi din nahi hai.</div>';

    /* ── a re-send is about the days that CHANGED ──
       The HOD asked for two days; making him re-read thirty-one is how a review stops happening. The
       changed days are marked wherever they appear, and the list opens on just them. */
    var vw = fix.length ? Admin.view(key, fix.length) : 'all';
    var list = vw === 'fix' ? all.filter(function (k) { return fix.indexOf(k) >= 0; }) : all;
    var DAY = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    var sel = Admin.sel(key);
    var h = '';
    if (fix.length) h += '<div class="banner g"><span></span><div><b>' + fix.length +
      ' din theek karke dobara bheje hain</b><br><span style="font-weight:500">' +
      fix.map(function (k) { return dmy(k); }).join(', ') +
      ' — baaki month pehle hi approve tha, wahi hai.</span>' +
      '<div class="btns"><button class="btn ' + (vw === 'fix' ? '' : 'ghost') + ' sm" ' +
        'onclick="event.stopPropagation();Admin.setView(\'' + Appr.q(key) + '\',\'fix\')">Sirf badle hue ' +
        fix.length + ' din</button>' +
      '<button class="btn ' + (vw === 'all' ? '' : 'ghost') + ' sm" ' +
        'onclick="event.stopPropagation();Admin.setView(\'' + Appr.q(key) + '\',\'all\')">Poora month (' +
        all.length + ' din)</button></div></div></div>';
    h += '<div class="sec-title">' + (vw === 'fix' ? 'Badle hue din \u2014 ' + list.length
          : 'Poora plan \u2014 ' + list.length + ' din') + '</div>' +
      /* no markup inside the sentence: a <b> in the middle splits the text run, and half a sentence
         is all the translator can then match */
      (can && st === 'pending' ? '<div class="hint" style="margin:-6px 0 8px">' +
        'Jo din galat hai unke box tick karo \u2014 niche reject selected days chalu ho jayega.</div>' : '') +
      (Auth.isAdmin() && act && st === 'approved' ? (editing
        ? '<div class="banner b" style="margin:-6px 0 8px"><span></span><div><b>Edit mode chalu hai</b>' +
          '<br><span style="font-weight:500">Kisi bhi din ka Edit dabakar badlo, phir niche Publish update ' +
          'dabao \u2014 rep ko notification bhi mil jayega.</span></div>' +
          '<div class="btns"><button class="btn ghost sm" onclick="event.stopPropagation();' +
          'Admin.pjpEditCancel()">Cancel</button></div></div>'
        : '<div class="btns" style="margin:-6px 0 10px"><button class="btn ghost sm" ' +
          'onclick="event.stopPropagation();Admin.pjpEditStart(\'' + Appr.q(key) + '\')">' +
          'Approved plan edit karo</button></div>') : '') +
      '<div class="card">';
    list.forEach(function (k) {
      var r = days[k] || {}, ww = Pjp.ww(r.ww), f = Pjp.isField(ww);
      var bad = rej.indexOf(k) >= 0, chg = fix.indexOf(k) >= 0, open = Admin.pjpOpen === key + '|' + k;
      h += '<div class="drow' + (bad ? ' bad' : (chg ? ' fix' : '')) + (open ? ' op' : '') + '">' +
        '<div class="dr-h">' +
          (can ? '<label class="ck"><input type="checkbox" ' + (sel[k] ? 'checked' : '') +
            ' onchange="Admin.tick(\'' + Appr.q(key) + '\',\'' + k + '\',this.checked)"></label>' : '') +
          '<div class="m"><div class="t">' + dmy(k) + ' <span class="hint">' +
            DAY[new Date(k + 'T00:00:00').getDay()] + '</span>' +
            (bad ? ' <span class="pill p-bad">Rejected</span>' : '') +
            (chg ? ' <span class="pill p-ok">Changed</span>' : '') +
            (fromMaster[k] ? ' <span class="pill p-grey">Approved</span>' : '') + '</div>' +
            '<div class="s">' + esc(ww) + (f ? ' · ' + esc(r.state || '—') + ' · ' + esc(r.city || '—') +
              ' / ' + esc(r.beat || '—') : (Pjp.isMeet(ww) ? ' · ' + esc(r.rmk || '—') : '')) + '</div></div>' +
          (can ? '<button class="btn ghost xs" onclick="Admin.edit(\'' + Appr.q(key) + '\',\'' + k + '\')">' +
            (open ? 'Close' : 'Edit') + '</button>' : '') +
        '</div>' +
        (open ? Admin.dayEdit(key, d.EmpCode, k, r) : '') +
        '</div>';
    });
    h += '</div>';
    /* the same choices again, right where the reader finishes the list — decide-bar for a pending
       month, publish-bar once an approved month is being edited */
    h += st === 'pending' && can ? Admin.pjpBar(key, 'bot')
      : (editing ? Admin.pjpEditBar(key) : '');
    return h;
  },
  /* the HOD's own editor for one day — the same three fields the rep fills, mapped to the REP */
  dayEdit: function (key, code, k, r) {
    var q = "'" + Appr.q(key) + "','" + k + "'";
    var states = Plan.statesOf(code), stt = r.state || Plan.stateOfFor(code, r.city) || states[0] || '';
    var f = Pjp.isField(Pjp.ww(r.ww));
    return '<div class="dr-b">' +
      '<label class="f">Working with</label>' +
      '<select class="in" onchange="Admin.setDay(' + q + ',\'ww\',this.value)">' +
        ['Self Working','ME Sales Team','BA Supervisor','Meeting / Activity','Weekly Off','Leave','Sick Leave','HO Holiday']
        .map(function (o) { return '<option value="' + o + '"' + (o === Pjp.ww(r.ww) ? ' selected' : '') +
          '>' + o + '</option>'; }).join('') + '</select>' +
      (f ? '<div class="row two" style="margin-top:6px">' +
        '<div><label class="f">State</label>' +
          '<select class="in" onchange="Admin.setDay(' + q + ',\'state\',this.value)">' +
          '<option value="">— select —</option>' +
          states.map(function (x) { return '<option value="' + esc(x) + '"' + (x === stt ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
          '</select></div>' +
        '<div><label class="f">Town / City</label>' +
          '<select class="in" onchange="Admin.setDay(' + q + ',\'city\',this.value)">' +
          '<option value="">— select —</option>' +
          Plan.townsOf(code, stt).map(function (x) {
            return '<option value="' + esc(x) + '"' + (x === r.city ? ' selected' : '') + '>' + esc(x) + '</option>'; }).join('') +
          (r.city && Plan.townsOf(code, stt).indexOf(r.city) < 0 ? '<option selected>' + esc(r.city) + '</option>' : '') +
          '</select></div></div>' +
        '<label class="f">Beat / Market</label>' +
        '<input class="in" value="' + esc(r.beat || '') + '" placeholder="Beat / market" ' +
          'onchange="Admin.setDay(' + q + ',\'beat\',this.value)">' : '') +
      '<div class="hint" style="margin-top:6px">Change turant draft me save ho jata hai — rep ko bhi dikhega.</div>' +
      '</div>';
  },
  /* HOD/Admin edit → straight into the draft's DaysJson. The rep sees it on their next sync, and
     approving publishes exactly what is on screen. */
  setDay: function (key, k, field, v) {
    var d = DB.find('PjpDraft', key); if (!d) return;
    var days = {}; try { days = JSON.parse(d.DaysJson || '{}') || {}; } catch (e) {}
    days[k] = days[k] || { ww:'Self Working', state:'', city:'', beat:'', st:'HQ' };
    days[k][field] = v;
    if (field === 'ww' && !Pjp.isField(Pjp.ww(v))) { days[k].city = ''; days[k].beat = ''; }
    if (field === 'state') days[k].city = '';
    DB.save('PjpDraft', Object.assign({}, d, { DaysJson:JSON.stringify(days), UpdatedAt:Date.now(),
      EditedBy:DB.me.name, EditedAt:new Date().toISOString() }), { quiet:true }).then(function () {
      Log.add('PJP', 'Day edited by ' + Admin.role(), key, k + ' ' + field + '=' + v);
      render();
    });
  },
  rejDays: function (d) {
    var a = []; try { a = JSON.parse((d && d.RejectedDaysJson) || '[]') || []; } catch (e) {}
    return a.map(function (x) { return toISO(x.date || x) || String(x); }).filter(Boolean);
  },
  /* the days the rep just fixed and re-sent — written by Pjp.submit on a partial re-send */
  fixDays: function (d) {
    var a = []; try { a = JSON.parse((d && d.FixedDaysJson) || '[]') || []; } catch (e) {}
    return a.map(function (x) { return toISO(x.date || x) || String(x); }).filter(Boolean);
  },
  /* 'fix' = only what changed, 'all' = the whole month. Per draft key, so opening a second employee
     does not inherit the first one's view. */
  pjpView:{},
  view: function (key, fixN) {
    if (Admin.pjpView[key]) return Admin.pjpView[key];
    return fixN ? 'fix' : 'all';                    /* a re-send opens on the changed days */
  },
  setView: function (key, v) { Admin.pjpView[key] = v; render(); },
  /* the days the rep just fixed and re-sent — written by Pjp.submit on a partial re-send */
  fixDays: function (d) {
    var a = []; try { a = JSON.parse((d && d.FixedDaysJson) || '[]') || []; } catch (e) {}
    return a.map(function (x) { return toISO(x.date || x) || String(x); }).filter(Boolean);
  },
  /* 'fix' = only what changed, 'all' = the whole month. Per draft key, so opening a second employee
     does not inherit the first one's view. */
  pjpView:{},
  view: function (key, fixN) {
    if (Admin.pjpView[key]) return Admin.pjpView[key];
    return fixN ? 'fix' : 'all';                    /* a re-send opens on the changed days */
  },
  setView: function (key, v) { Admin.pjpView[key] = v; render(); },
  /* the days the rep just fixed and re-sent — written by Pjp.submit on a partial re-send */
  fixDays: function (d) {
    var a = []; try { a = JSON.parse((d && d.FixedDaysJson) || '[]') || []; } catch (e) {}
    return a.map(function (x) { return toISO(x.date || x) || String(x); }).filter(Boolean);
  },
  /* 'fix' = only what changed, 'all' = the whole month. Per draft key, so opening a second employee
     does not inherit the first one's view. */
  pjpView:{},
  view: function (key, fixN) {
    if (Admin.pjpView[key]) return Admin.pjpView[key];
    return fixN ? 'fix' : 'all';                    /* a re-send opens on the changed days */
  },
  setView: function (key, v) { Admin.pjpView[key] = v; render(); },
  /* PARTIAL REJECT — only the ticked days come back to the rep. The rest of the month stands, so he
     edits three days instead of rebuilding a month. */
  pjpPart: function (key) {
    var d = DB.find('PjpDraft', key); if (!d) return;
    var s = Admin.sel(key), days = Object.keys(s).filter(function (k) { return s[k]; }).sort();
    if (!days.length) return toast('Pehle wo din tick karo jo reject karne hain');
    UI.prompt({ icon:'', title:days.length + ' din reject karne hain?', danger:true,
      msg:'<b>' + esc(d.EmpName || '') + '</b> — ' + esc(monthName(d.Month)) + '<br>' +
          days.map(function (k) { return dmy(k); }).join(', ') +
          '<br>Baaki din waise hi rahenge — rep sirf yeh din edit kar payega.',
      label:'Reason (rep ko dikhega)', placeholder:'e.g. ye beat pichhle hafte hi kiya tha',
      multiline:true, required:true, requiredMsg:'Reason likhna zaroori hai', ok:'Reject selected days'
    }).then(function (r) {
      if (!r) return;
      return DB.save('PjpDraft', Object.assign({}, d, Admin.stamp(),
        { Status:'Partially Rejected', RejectReason:r, RejectedDaysJson:JSON.stringify(days),
          UpdatedAt:Date.now() })).then(function () {
        Admin.pjpSel[key] = {};
        Log.add('PJP', 'Partially rejected (' + days.length + ' days)', key, r);
        render(); toast(days.length + ' din reject — rep ko sirf wahi edit karne milega', 4200);
      });
    });
  },

  pjpOk: function (key) {
    var d = DB.find('PjpDraft', key); if (!d || Busy.busy('pjpok_' + key)) return;
    Busy.on['pjpok_' + key] = true; setTimeout(function () { delete Busy.on['pjpok_' + key]; }, 4000);
    /* Approve → then PUBLISH: the draft's DaysJson is expanded into one Master_PJP row per day
       (ascending), upserted on Code+Date so re-publishing never duplicates. */
    DB.save('PjpDraft', Object.assign({}, d, Admin.stamp(),
      { Status:'Approved', UpdatedAt:Date.now() })).then(function () {
      toast('Master_PJP me publish ho raha hai…');
      return Api.post({ action:'publishPjp', email:Auth.session().email, key:key });
    }).then(function (r) {
      Log.add('PJP', 'Approved+Published', key, r && r.ok ? (r.written + ' rows') : 'publish failed');
      /* repaint NOW: the decision bar has to disappear the moment the month is approved, not when the
         sync round-trip returns */
      Admin.pjpSel[key] = {}; Nav._c = null; render();
      if (r && r.ok) {
        /* say how much of the month landed. A month that publishes two days out of thirty-one is the
           bug that sent us looking here — it must never be silent again. */
        var short = r.monthDays && r.written < r.monthDays;
        toast((short ? '! Sirf ' : 'Approve + publish — ') + r.written +
          (r.monthDays ? ' / ' + r.monthDays : '') + ' din Master_PJP me' +
          (r.from ? ' (' + dmy(r.from) + ' – ' + dmy(r.to) + ')' : '') +
          ((r.skippedBeforeJoining || []).length ?
            ' · ' + r.skippedBeforeJoining.length + ' din joining se pehle ke the' : ''),
          short ? 6000 : 4200);
        if (short) Log.add('PJP', 'Published SHORT', key, r.written + ' of ' + r.monthDays);
      } else toast('! Approve ho gaya par publish fail:' + ((r && r.error) || 'unknown'), 5000);
      return Sync.now(false);
    }).catch(function () { toast('! Publish nahi hua — dobara approve dabao'); });
  },
  pjpNo: function (key) {
    var d = DB.find('PjpDraft', key); if (!d) return;
    UI.prompt({ icon:'', title:'PJP reject karna hai?', danger:true,
      msg:'<b>' + esc(d.EmpName || '') + '</b> \u2014 ' + esc(monthName(d.Month)) + '. Reason rep ko dikhega.',
      label:'Reject reason', placeholder:'e.g. beats repeat ho rahe hain', multiline:true,
      required:true, requiredMsg:'Reason likhna zaroori hai', ok:'Reject karo'
    }).then(function (r) {
      if (!r) return;
      return DB.save('PjpDraft', Object.assign({}, d, Admin.stamp(),
        { Status:'Rejected', RejectReason:r, UpdatedAt:Date.now() })).then(function () {
        Log.add('PJP', 'Rejected', key, r); render(); toast(' Reject ho gaya \u2014 rep ko dikh jayega');
      });
    });
  },
  devOk: function (id, ok) {
    var d = DB.find('Deviation', id); if (!d) return;
    if (Busy.busy('dev_' + id)) return;
    var ask = ok ? Promise.resolve('') : UI.prompt({ icon:'', title:'Plan change reject karein?',
      danger:true, msg:'<b>' + esc(d.EmpName || '') + '</b> \u2014 ' + dmy(d.Date) + '<br>Maanga tha: <b>' +
        esc((d.NewTown || '') + ' / ' + (d.NewBeat || '')) + '</b><br>Reject ke baad rep yahi beat dobara nahi bhej payega.',
      label:'Reject reason', placeholder:'e.g. PJP wala beat hi karo', multiline:true,
      required:true, requiredMsg:'Reason likhna zaroori hai', ok:'Reject karo' });
    ask.then(function (rem) {
      if (!ok && !rem) return;
    /* On reject, remember the exact town/beat that was refused so the rep cannot send it again. */
    var rej = [];
    try { rej = JSON.parse(d.RejectedJson || '[]') || []; } catch (e) {}
    if (!ok) {
      var k = ((d.NewTown || '') + '|' + (d.NewBeat || '')).toUpperCase().trim();
      if (!rej.some(function (x) { return ((x.town || '') + '|' + (x.beat || '')).toUpperCase().trim() === k; }))
        rej.push({ town:d.NewTown || '', beat:d.NewBeat || '', at:new Date().toISOString(), by:DB.me.name });
    }
    Busy.run('dev_' + id, null, '', function () {
      /* Admin.stamp() rather than a hand-written HodBy/HodAt pair: this was the one decision path that
         did not go through it, so the sheet's own HodRole cell was never filled for a plan change. The
         reports only show "Approved at" now, but the who/in-what-capacity trail still belongs IN the
         sheet — and it should be written the same way by all five decision paths. */
      return DB.save('Deviation', Object.assign({}, d, Admin.stamp(),
        { Status:ok ? 'Approved' : 'Rejected', HodRemarks:rem || '',
          RejectedJson:JSON.stringify(rej), UpdatedAt:Date.now() }))
        .then(function () {
          Log.add('Deviation', ok ? 'Approved' : 'Rejected', id, (d.NewTown || '') + '/' + (d.NewBeat || '') + ' ' + rem);
          render(); toast(ok ? ' Approved' : ' Rejected \u2014 rep ko dusra beat chunna padega');
        });
    });
    });
  },

  isBypass: function (x) { return /^(yes|true|1)$/i.test(String((x && x.Bypass) || '')); },

  /* Turning it ON asks for a reason (it lands in the sheet next to who granted it, so a relaxed rule
     is never anonymous); turning it OFF just confirms. The row is updated locally so the switch
     flips immediately, then the sheet is the record. */
  bypass: function (code, on, el) {
    var row = (DB.m.LoginConfig || []).filter(function (x) { return String(x.Code) === String(code); })[0] || {};
    var who = esc(row.Name || code);
    var ask = on
      ? UI.prompt({ icon:'', title:'Bypass ON karein?',
          msg:'<b>' + who + '</b> ke liye ye restrictions hat jayengi:<br>• ' + Bypass.WAIVES.join('<br>• ') +
              '<br><br>Sirf inhi par lagu hoga, baaki team par nahi.',
          label:'Reason (sheet me save hoga)', placeholder:'e.g. camera kharab hai, mid-month joining',
          multiline:true, required:true, requiredMsg:'Reason likhna zaroori hai', ok:'Haan, ON karo' })
      : UI.confirm({ icon:'', title:'Bypass OFF karein?', danger:true,
          msg:'<b>' + who + '</b> par app ki poori restrictions wapas lag jayengi — photo compulsory, ' +
              'tab ka order, poora PJP.', ok:'Haan, OFF karo', cancel:'Nahi' });
    return ask.then(function (r) {
      if (!r) return;
      return Busy.run('bypass_' + code, el, on ? 'ON kar rahe hain…' : 'OFF kar rahe hain…', function () {
        return Api.post({ action:'admin', email:Auth.session().email, op:'setBypass',
                          code:code, on:!!on, note:(on ? String(r) : '') }).then(function (res) {
          if (!res || !res.ok) return UI.alert({ icon:'!', title:'Nahi ho paya',
            msg:esc((res && res.error) || 'Server se jawab nahi aaya') + '<br><br>Backend purana ho to ' +
                '<b>backend.gs</b> dobara paste karke deploy karo.' });
          /* keep the on-screen list in step with what the sheet now holds */
          row.Bypass = on ? 'Yes' : 'No';
          row.BypassBy = res.by || ''; row.BypassAt = res.at || ''; row.BypassNote = on ? String(r) : '';
          DB.cache();
          Log.add('Bypass', on ? 'ON' : 'OFF', code, on ? String(r) : '');
          render(); toast(on ? 'Bypass ON —' + (row.Name || code) : 'Bypass OFF —' + (row.Name || code), 3200);
        });
      });
    });
  },
  /* one employee's password, from the row that names them — the bulk "Reset all" stays where it is
     for the rare case where everyone has to be pushed over at once. */
  resetOne: function (code, el) {
    var row = (DB.m.LoginConfig || []).filter(function (x) { return String(x.Code) === String(code); })[0] || {};
    var who = esc(row.Name || code);
    return UI.confirm({ icon:'', title:'Iska password reset karein?', danger:true,
      msg:'<b>' + who + '</b> (' + esc(code) + ') ka password <b>Honasa@123</b> ho jayega, aur agli ' +
          'login par unhe naya password banana padega.<br><br>Baaki kisi par asar nahi hoga.',
      ok:'Haan, reset karo', cancel:'Nahi' }).then(function (go) {
      if (!go) return;
      return Busy.run('rst_' + code, el, 'Reset…', function () {
        return Api.post({ action:'admin', email:Auth.session().email, op:'resetOne', code:code })
          .then(function (r) {
            if (!r || !r.ok) return UI.alert({ icon:'!', title:'Reset nahi hua',
              msg:esc((r && r.error) || 'Server se jawab nahi aaya') + '<br><br>Backend purana ho to ' +
                  '<b>backend.gs</b> dobara paste karke deploy karo.' });
            /* keep the screen honest until the next pull brings the row back */
            (DB.m.LoginConfig || []).forEach(function (x) {
              if (String(x.Code).toUpperCase() === String(code).toUpperCase()) x.PwdChanged = false; });
            DB.cache(); Log.add('User', 'Password reset', code, Admin.role());
            render();
            UI.alert({ icon:'', title:'Reset ho gaya',
              msg:'<b>' + who + '</b> ka password ab <b>Honasa@123</b> hai. Agli login par change maanga jayega.' });
          });
      });
    });
  },
  resetPwd: function () {
    UI.confirm({ icon:'', title:'Sab passwords reset karein?', danger:true,
      msg:'Har login ka password <b>Honasa@123</b> ho jayega aur pehli login par change maanga jayega.<br>Ye sabhi users par lagu hoga.',
      ok:'Haan, reset karo', cancel:'Nahi' }).then(function (go) {
      if (!go) return;
      return Api.post({ action:'admin', email:Auth.session().email, op:'resetPasswords' }).then(function (r) {
        if (r && r.ok) UI.alert({ icon:'', title:'Reset ho gaya', msg:'<b>' + r.n + '</b> users ka password <b>Honasa@123</b> hai.' });
        else UI.alert({ icon:'!', title:'Reset fail', msg:esc((r && r.error) || 'Server se jawab nahi aaya') });
      });
    });
  },

  master: function () {
    var s = [['Master_Employees','Employees'],['Master_Stores','Stores'],['Master_Distributors','Distributors'],
      ['Master_Products','Products'],['Master_PJP','PJP rows'],['Master_Config','Config'],['Master_Phasing','Phasing'],
      ['Stock_Distributor','DB stock'],['Stock_Store','Store stock']];
    /* folded by default: it is reference, not work. The refresh stays at the bottom of the card. */
    var open = !!Admin.mOpen;
    var tot = s.reduce(function (a, x) {
      return a + (DB.counts[x[0]] != null && !(DB.m[x[0]] || []).length ? DB.counts[x[0]]
        : (DB.m[x[0]] || []).length); }, 0);
    var head = '<div class="sec-title">Master tabs</div><div class="card">' +
      '<div class="lrow" style="padding:0;cursor:pointer" onclick="Admin.mFold()">' +
      '<div class="m"><div class="t">Master tabs — ' + s.length + ' tab</div>' +
      '<div class="s">' + tot + ' row · read-only · ' +
      (open ? 'band karne ke liye tap karo' : 'kholne ke liye tap karo') + '</div></div>' +
      '<span class="pill p-grey" style="flex:0 0 auto">' + (open ? '–' : '+') + '</span></div>';
    if (!open) return head + '</div>';
    return head + '<div class="banner b" style="margin-top:10px"><span></span><div>Master tabs ' +
      '<b>read-only</b> hain — app kabhi inme likhta nahi. Sheet me change karo, app <b>Sync</b> par ' +
      'utha lega.</div></div>' +
      '<div>' + s.map(function (x) {
        /* Stock_* is no longer downloaded (95k rows) — the backend sends its row count instead */
        var n = DB.counts[x[0]] != null && !(DB.m[x[0]] || []).length ? DB.counts[x[0]] : (DB.m[x[0]] || []).length;
        return '<div class="lrow"><div class="m"><div class="t">' + x[1] + '</div><div class="s">' + x[0] +
          (/^Stock_/.test(x[0]) ? ' · sheet me hi rehta hai' : '') +
          (x[0] === 'Master_PJP' ? ' · app sirf approve par likhta hai — aur upar se ek employee ka delete' : '') +
          '</div></div>' +
          '<span class="pill ' + (n ? 'p-ok' : 'p-bad') + '">' + n + ' rows</span></div>'; }).join('') +
      '<div class="hint" style="margin-top:8px">Last sync: ' + (DB.pulledAt ? new Date(DB.pulledAt).toLocaleString('en-IN') : '—') + '</div>' +
      (DB.pjpDupes ? '<div class="banner w" style="margin-top:10px"><span>!</span><div>Master_PJP me <b>' + DB.pjpDupes +
        ' duplicate row</b> hain (same employee + same date). App pehli row use karta hai — extra rows sheet se delete kar do.</div></div>' : '') +
      '<div class="btns"><button class="btn" onclick="Sync.now(true)"> Master refresh karo</button></div>' +
      '</div></div>';
  },
  mFold: function () { Admin.mOpen = !Admin.mOpen; render(); },

  /* ══ is the sheet script the one this app expects? ══
     `ping` reads no sheet and needs no token — the cheapest question in the API. Asked once per
     session, the moment the Data screen opens, because that is where a stale deployment bites. */
  _ver:undefined,
  verCheck: function (again) {
    if (Admin._ver !== undefined && !again) return;
    Admin._ver = '';                                    /* asked — do not ask again this render */
    Api.get({ action:'ping' }).then(function (r) {
      Admin._ver = (r && r.ver) || '?';
      render();
    }, function () { Admin._ver = '?'; render(); });
  },
  verOld: function () {
    var v = Admin._ver;
    if (!v || v === '?') return false;
    return String(v) !== String(NEED_VER);
  },
  verStrip: function () {
    if (!Admin.verOld()) return '';
    return '<div class="banner r"><span>!</span><div><b>Sheet ka script purana hai — v' +
      esc(Admin._ver) + ', chahiye v' + esc(NEED_VER) + '</b><br><span style="font-weight:500">' +
      'Delete, PJP delete aur kuch naye column tab tak kaam nahi karenge. Apps Script me backend.gs ' +
      'dobara paste karo, phir Deploy → New deployment.</span></div></div>';
  },

  /* a live "kaha tak pahucha hai" line per employee, so an HOD can see progress at a glance
     and jump into the exact screen the rep is looking at */
  progress: function (code) {
    var t = today();
    var f = function (tab) { return DB.rows(tab).filter(function (r) {
      return String(r.EmpCode) === String(code) && toISO(r.Date) === t; }); };
    var ord = f('SecOrders'), plan = DB.find('DayPlan', code + '_' + t), eod = f('Eod');
    var out = [];
    out.push(plan && plan.PlanAt ? (plan.NotifiedAt ? 'Plan notified ' + esc(plan.NotifiedAt) : 'Plan saved, notify pending')
                                 : 'Plan nahi bana');
    if (ord.length) out.push(ord.length + ' store \u00b7 ' + ord.filter(function (o) { return num(o.TotUnits) > 0; }).length +
      ' order \u00b7 ' + inr(ord.reduce(function (a, o) { return a + num(o.TotValue); }, 0)));
    var pa = f('PosmAudit').length + f('PosmRequirement').length;
    if (pa) out.push(pa + ' POSM');
    out.push(eod.length ? ' EOD ho gaya' : (ord.length ? 'EOD pending' : 'abhi shuru nahi kiya'));
    return out.join(' \u00b7 ');
  },

  prev: function () {
    var emps = DB.m.Master_Employees || [];
    return '<div class="banner w"><span></span><div><b>Preview mode</b> \u2014 employee ka aaj ka <b>live</b> ' +
      'screen dekho, jaisa unhe abhi dikh raha hai (beech din ka status bhi). Preview me kuch bhi sheet me save nahi hota.' +
      '</div></div>' +
      '<div class="card">' + emps.map(function (e) {
        return '<div class="lrow"><div class="m"><div class="t">' + esc(e.Name) + '</div>' +
          '<div class="s">' + esc(e.Code) + ' \u00b7 ' + esc(e.HQ || '') + '</div>' +
          '<div class="s"><b>Aaj:</b> ' + Admin.progress(e.Code) + '</div></div>' +
          '<button class="btn sm" style="flex:0 0 auto" onclick="Preview.start(&quot;' + esc(e.Code) + '&quot;)"> Preview</button></div>'; }).join('') + '</div>' +
      (Preview.on ? '<div class="card"><button class="btn bad" onclick="Preview.stop()">Preview band karo</button></div>' : '');
  }
};

/* preview exit button lives in the topbar while previewing */
(function () {
  var old = Nav.build;
  Nav.build = function () {
    old();
    if (Preview.on) {
      var b = document.createElement('button');
      b.className = 'chip'; b.textContent = 'Exit preview';
      b.onclick = Preview.stop;
      var r = document.querySelector('.topbar .right');
      if (r && !r.querySelector('.exitprev')) { b.classList.add('exitprev'); r.insertBefore(b, r.firstChild); }
    } else {
      var e = document.querySelector('.exitprev'); if (e) e.remove();
    }
  };
})();

/* ═══════════════ BOOT ═══════════════ */
(function () {
  I18n.boot();                     /* before the first paint, or the first screen renders Hinglish */
  DB.boot();
  Sync.init();
  var s = Auth.session();
  if (s) { DB.me = DB.me || { code:s.code, name:s.name, rights:s.rights, hq:s.hq, zone:s.zone, desig:s.desig, doj:s.doj }; Auth.start(); }
  else Auth.showGate();
  if (API_URL.indexOf('PASTE_') === 0)
    setTimeout(function () { toast('! API_URL set karo (index.html me) — backend se connect nahi hoga', 6000); }, 800);
  var gp = $('gate_pwd'); if (gp) gp.addEventListener('keydown', function (e) { if (e.key === 'Enter') Auth.login(); });
})();