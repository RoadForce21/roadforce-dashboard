/* Road Force – Underleverandørportal (kun læseadgang). Data hentes kun via portal_-funktioner i databasen. */
(() => {
const CFG = window.RF_CONFIG;
// Invitationslink: ?invitation=<kode> (fra Road Forces mail) + #…type=invite|magiclink (fra Supabase). Koden flyttes straks ud af adresselinjen.
const INV_KEY = 'rf-portal-invitation';
const IS_NEW_INVITE = /type=invite/.test(location.hash);
(() => { const u = new URL(location.href); const t = u.searchParams.get('invitation');
  if (t) { try { sessionStorage.setItem(INV_KEY, t); } catch (e) { window.__inv = t; } u.searchParams.delete('invitation'); history.replaceState(null, '', u.pathname + u.search + u.hash); } })();
const pendingInvite = () => { try { return sessionStorage.getItem(INV_KEY) || window.__inv || null; } catch (e) { return window.__inv || null; } };
const clearInvite = () => { try { sessionStorage.removeItem(INV_KEY); } catch (e) { /* ignorer */ } window.__inv = null; };
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'rf-web-subportal-' + new URL(CFG.SUPABASE_URL).host.split('.')[0] } });
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kr = (ore) => ore == null ? '–' : (ore / 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' kr.';
const num = (ore) => ore == null ? '' : (ore / 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dt = (i) => i ? new Date(i).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
const dk = (i) => i ? new Date(i).toLocaleDateString('da-DK') : '–';
const iso = (d) => d.toLocaleDateString('sv-SE');
const ST = { assigned: ['Tildelt', ''], loaded: ['Afhentet', ''], in_transit: ['Undervejs', ''], delivered: ['Leveret', 'good'], cancelled: ['Annulleret', 'low'] };
const SETT = { draft: ['Afventer godkendelse', 'warn'], approved: ['Godkendt', ''], paid: ['Udbetalt', 'good'] };
const EST = { expected: ['Forventet', 'warn'], pending: ['Optjent, afventer afregning', ''], paid: ['Udbetalt', 'good'] };
const SUBST = { pending: 'Afventer', active: 'Aktiv', paused: 'Sat på pause', ended: 'Ophørt' };
const pill = (m, k) => { const [t, c] = m[k] || [k, '']; return `<span class="pill ${c}">${esc(t)}</span>`; };
const table = (head, rows, rcols = [], empty = 'Ingen data i perioden.') => `<div class="tw"><table><thead><tr>${head.map((h, i) => `<th class="${rcols.includes(i) ? 'r' : ''}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => { let i = 0; return r.replace(/<td(?=[\s>])/g, () => `<td data-label="${esc(head[i++] || '')}"`); }).join('') : `<tr><td colspan="${head.length}" class="muted">${esc(empty)}</td></tr>`}</tbody></table></div>`;
const errMsg = (e) => /Ingen adgang/.test(e?.message || '') ? 'Din bruger har ikke adgang til underleverandørportalen. Kontakt Road Force.' : 'Data kunne ikke hentes. Prøv igen om lidt.';
function csv(name, head, rows) {
  // Neutralisér regnearksformler (=, +, -, @, tab, CR) – men ikke almindelige tal som -80,00.
  const q = (v) => { v = v == null ? '' : String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ''); if (/^[=+\-@\t\r]/.test(v) && !/^-?[\d.,]+$/.test(v)) v = "'" + v; return /[;"\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  const url = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map((r) => r.map(q).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
}
const now = new Date(); const P = { from: iso(new Date(now.getFullYear(), now.getMonth(), 1)), to: iso(now) };
const period = () => `<div class="filters"><label>Fra<input type="date" id="pf" value="${P.from}"></label><label>Til<input type="date" id="pt" value="${P.to}"></label><button class="ghost" id="pa">Vis</button></div>`;
function wirePeriod(fn) { $('#pa').onclick = () => { const f = $('#pf').value, t = $('#pt').value; if (!f || !t || t < f) return alert('Vælg en gyldig periode.'); P.from = f; P.to = t; fn(); }; }
let ME = null, VIEW = 'overview';
async function rpc(name, args) { const { data, error } = await sb.rpc(name, args); if (error) throw error; return data; }

// ───── Login ─────
function login(msg = '') {
  $('#out').hidden = true; $('#nav').hidden = true; $('#firm').textContent = 'Underleverandørportal';
  app.innerHTML = `<form id="lf" class="card login"><h2>Log ind</h2><p class="muted">For underleverandører, der kører for Road Force. Adgang gives af Road Force.</p><label>E-mail<input name="e" type="email" required autocomplete="email"></label><label>Adgangskode<input name="p" type="password" required autocomplete="current-password"></label><button>Log ind</button><a href="#" id="fp" style="color:#9db6ff;font-size:14px">Glemt eller ny adgangskode?</a><div class="err" id="le" role="alert">${esc(msg)}</div></form>`;
  $('#fp').onclick = async (ev) => { ev.preventDefault(); const e = $('#lf').e.value.trim(); if (!e) return ($('#le').textContent = 'Skriv din e-mail ovenfor.'); await sb.auth.resetPasswordForEmail(e, { redirectTo: 'https://roadforce21.github.io/roadforce-dashboard/nyt-kodeord.html' }); $('#le').textContent = 'Hvis e-mailen findes hos os, har vi sendt et link, hvor du kan vælge adgangskode.'; };
  $('#lf').onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; const { error } = await sb.auth.signInWithPassword({ email: f.e.value.trim(), password: f.p.value }); if (error) return ($('#le').textContent = 'Forkert e-mail eller adgangskode.'); boot(); };
}

// ───── Visninger ─────
// Beløb er ALTID underleverandørens egen andel (fx 80 %) ekskl. moms. Kundens pris og Road Forces andel sendes ikke fra serveren.
const F = { driver: '', status: '' };
const ACTIVE = ['assigned', 'loaded', 'in_transit'];
const DOCK = { permit: 'Tilladelse', insurance: 'Forsikring', agreement: 'Aftale', other: 'Andet' };
const VKIND = { van: 'Kassebil (Vito)', van_large: 'Stor kassebil (Sprinter L2H2)', lift: 'Liftbil', other: 'Andet' };
const amount = (o) => o.status === 'cancelled' || o.amount == null ? '–' : kr(o.amount) + (o.estimate ? '<small>forventet</small>' : '');
const daysTo = (d) => d ? Math.round((new Date(d + 'T12:00:00') - new Date(iso(new Date()) + 'T12:00:00')) / 864e5) : null;
const expiry = (d) => { const n = daysTo(d); if (n == null) return '<span class="muted">–</span>'; if (n < 0) return `<span class="pill low">Udløbet ${dk(d)}</span>`; if (n <= 30) return `<span class="pill warn">Udløber ${dk(d)}</span>`; return `<span class="pill good">Gyldig til ${dk(d)}</span>`; };
let DRV = null; const drvList = async () => (DRV = DRV || await rpc('portal_drivers'));
const driverFilter = (list) => `<label>Chauffør<select id="fd"><option value="">Alle chauffører</option>${list.map((d) => `<option value="${esc(d.id)}" ${d.id === F.driver ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>`;
function wireDriver(fn) { const el = $('#fd'); if (el) el.onchange = () => { F.driver = el.value; fn(); }; }
const tripRow = (o, withDriver = true) => `<tr><td><b>${esc(o.ref)}</b>${o.is_test ? ' <span class="pill warn">TEST</span>' : ''}</td><td>${dt(o.pickup_at)}</td><td>${esc(o.from_address)}<small>→ ${esc(o.to_address || 'Timebooking')}</small></td>${withDriver ? `<td>${o.driver_id ? `<a href="#" data-drv="${esc(o.driver_id)}">${esc(o.driver_name || '–')}</a>` : '–'}</td>` : ''}<td>${pill(ST, o.status)}${o.delivered_at ? `<small>Leveret ${dt(o.delivered_at)}</small>` : ''}</td><td class="r"><b>${amount(o)}</b></td></tr>`;
function wireDriverLinks() { $$('[data-drv]').forEach((a) => a.onclick = (ev) => { ev.preventDefault(); driverDetail(a.dataset.drv); }); }

async function overview() {
  // Enkel forside: én boks med tre tal + stort live-kort. Alt andet ligger under de øvrige menupunkter.
  const [e, t] = await Promise.all([rpc('portal_earnings', { p_from: null, p_to: null }), rpc('portal_trips', { p_from: null, p_to: null })]);
  const active = t.filter((x) => ACTIVE.includes(x.status)).length;
  app.innerHTML = `<div class="card kpis" role="group" aria-label="Nøgletal">
      <div class="kpi"><span class="muted">Dagens indtjening</span><b>${kr(e.today.earned ?? 0)}</b></div>
      <div class="kpi"><span class="muted">Aktive ture</span><b>${active}</b></div>
      <div class="kpi"><span class="muted">Månedens indtjening</span><b>${kr(e.month.earned ?? 0)}</b></div></div>
    <div class="card"><div class="row"><h3>Live-kort</h3><span class="muted" id="lm-upd"></span></div>
      <div id="lm" class="lm lm-big" role="region" aria-label="Kort over jeres varevogne"></div></div>`;
  mountMap();
}
async function drivers() {
  const d = await drvList();
  app.innerHTML = `<div class="card"><h3>Chauffører</h3><p class="muted">Klik på en chauffør for at se vedkommendes ture og indtjening. Chauffører tilknyttes af Road Force.</p>
    <div class="dcards">${d.map((x) => `<button class="dcard" data-drv="${esc(x.id)}"><b>${esc(x.name)}</b>${x.active ? '' : ' <span class="pill low">Spærret</span>'}<span class="muted">${esc(x.phone || 'Intet telefonnr.')}</span><span class="muted">${x.active_trips} aktive ture · ${x.delivered_month} leveret denne måned</span><span>I dag <b>${kr(x.earned_today)}</b> · Måned <b>${kr(x.earned_month)}</b></span></button>`).join('') || '<p class="muted">Ingen chauffører tilknyttet endnu.</p>'}</div></div>`;
  wireDriverLinks();
}
async function driverDetail(id) {
  VIEW = 'drivers'; $$('#nav button').forEach((b) => b.toggleAttribute('aria-current', b.dataset.v === 'drivers'));
  app.innerHTML = '<p class="muted">Henter…</p>';
  try {
    const [d, t] = await Promise.all([drvList(), rpc('portal_trips', { p_from: P.from, p_to: P.to })]);
    const x = d.find((y) => y.id === id); if (!x) { app.innerHTML = '<div class="card"><p class="err">Chaufføren findes ikke i jeres firma.</p></div>'; return; }
    const mine = t.filter((o) => o.driver_id === id); const act = mine.filter((o) => ACTIVE.includes(o.status)), done = mine.filter((o) => !ACTIVE.includes(o.status));
    const sum = done.filter((o) => o.status === 'delivered').reduce((a, o) => a + (o.amount || 0), 0);
    app.innerHTML = `<div class="card"><div class="row"><button class="ghost" id="back">← Alle chauffører</button></div><h2>${esc(x.name)}</h2><p class="muted">${esc(x.phone || '')} ${x.active ? '<span class="pill good">Aktiv</span>' : '<span class="pill low">Spærret</span>'}</p>
      <div class="tiles"><div class="tile"><span class="muted">Aktive ture</span><b>${act.length}</b></div><div class="tile"><span class="muted">I dag</span><b>${kr(x.earned_today)}</b></div><div class="tile"><span class="muted">Denne måned</span><b>${kr(x.earned_month)}</b></div><div class="tile"><span class="muted">Leveret i perioden</span><b>${kr(sum)}</b></div></div></div>
      <div class="card"><h3>Igangværende ture</h3>${table(['Tur', 'Afhentning', 'Rute', 'Status', 'Jeres beløb'], act.map((o) => tripRow(o, false)), [4], 'Ingen igangværende ture.')}</div>
      <div class="card"><h3>Afsluttede ture</h3>${period()}${table(['Tur', 'Afhentning', 'Rute', 'Status', 'Jeres beløb'], done.map((o) => tripRow(o, false)), [4])}</div>`;
    $('#back').onclick = () => show('drivers'); wirePeriod(() => driverDetail(id));
  } catch (e) { app.innerHTML = `<div class="card"><p class="err">${esc(errMsg(e))}</p></div>`; }
}
async function trips() {
  const [t, d] = await Promise.all([rpc('portal_trips', { p_from: P.from, p_to: P.to }), drvList()]);
  const rows = t.filter((o) => (!F.driver || o.driver_id === F.driver) && (!F.status || (F.status === 'active' ? ACTIVE.includes(o.status) : o.status === F.status)));
  const sum = rows.filter((o) => o.status === 'delivered').reduce((a, o) => a + (o.amount || 0), 0);
  app.innerHTML = `<div class="card"><div class="row"><h3>Ture</h3><button class="ghost" id="cx">⬇ CSV</button></div><p class="muted">Aktive ture vises altid. Afsluttede ture vises for den valgte periode. Beløbet er jeres andel ekskl. moms.</p>
    <div class="filters">${driverFilter(d)}<label>Status<select id="fs"><option value="">Alle</option><option value="active" ${F.status === 'active' ? 'selected' : ''}>Aktive</option><option value="delivered" ${F.status === 'delivered' ? 'selected' : ''}>Leveret</option><option value="cancelled" ${F.status === 'cancelled' ? 'selected' : ''}>Annulleret</option></select></label></div>${period()}
    <p class="muted">${rows.length} ture · leveret i alt <b>${kr(sum)}</b></p>
    ${table(['Tur', 'Afhentning', 'Rute', 'Chauffør', 'Status', 'Jeres beløb'], rows.map((o) => tripRow(o)), [5])}</div>`;
  wirePeriod(trips); wireDriver(trips); $('#fs').onchange = (ev) => { F.status = ev.target.value; trips(); }; wireDriverLinks();
  $('#cx').onclick = () => csv(`ture_${P.from}_${P.to}.csv`, ['Tur', 'Afhentning', 'Fra', 'Til', 'Chauffør', 'Status', 'Leveret', 'Jeres beløb ekskl. moms', 'Forventet', 'Test'], rows.map((o) => [o.ref, dt(o.pickup_at), o.from_address, o.to_address || '', o.driver_name || '', (ST[o.status] || [o.status])[0], o.delivered_at ? dt(o.delivered_at) : '', o.status === 'cancelled' ? '' : num(o.amount), o.estimate ? 'ja' : '', o.is_test ? 'ja' : '']));
}
async function earnings() {
  const [e, d] = await Promise.all([rpc('portal_earnings', { p_from: P.from, p_to: P.to }), drvList()]);
  const tr = (e.trips || []).filter((x) => !F.driver || x.driver_id === F.driver);
  const s = (st) => tr.filter((x) => st.includes(x.st) && (x.st === 'expected' || (x.d >= P.from && x.d <= P.to))).reduce((a, x) => a + (x.amt || 0), 0);
  const p = F.driver ? { earned: s(['pending', 'paid']), paid: s(['paid']), pending: s(['pending']), expected: s(['expected']) } : e.period || {};
  app.innerHTML = `<div class="card"><div class="row"><h3>Indtjening</h3><button class="ghost" id="cx">⬇ CSV</button></div><div class="filters">${driverFilter(d)}</div>${period()}
    <div class="tiles"><div class="tile"><span class="muted">Optjent i perioden</span><b>${kr(p.earned ?? 0)}</b></div><div class="tile"><span class="muted">Heraf udbetalt</span><b>${kr(p.paid ?? 0)}</b></div><div class="tile"><span class="muted">Afventer afregning</span><b>${kr(p.pending ?? 0)}</b></div><div class="tile"><span class="muted">Forventet (aktive ture)</span><b>${kr(p.expected ?? 0)}</b></div></div>
    <p class="notice">Jeres andel ekskl. moms. Udlæg (fx bro og parkering betalt af jer) afregnes separat.</p></div>
    ${F.driver ? '' : `<div class="card"><h3>Pr. chauffør</h3>${table(['Chauffør', 'Leverede ture', 'Jeres indtjening'], (e.by_driver || []).map((x) => `<tr><td>${x.driver_id ? `<a href="#" data-drv="${esc(x.driver_id)}">${esc(x.driver_name || '–')}</a>` : '–'}</td><td class="r">${x.trips_done}</td><td class="r">${kr(x.company_share)}</td></tr>`), [1, 2])}</div>`}
    <div class="card"><h3>Ture</h3>${table(['Tur', 'Dato', 'Chauffør', 'Jeres beløb', 'Status'], tr.map((x) => `<tr><td><b>${esc(x.ref)}</b></td><td>${dk(x.trip_date)}</td><td>${esc(x.driver_name || '–')}</td><td class="r">${kr(x.amt)}${x.estimate ? '<small>forventet</small>' : ''}</td><td>${pill(EST, x.st)}</td></tr>`), [3])}</div>`;
  wirePeriod(earnings); wireDriver(earnings); wireDriverLinks();
  $('#cx').onclick = () => csv(`indtjening_${P.from}_${P.to}.csv`, ['Tur', 'Dato', 'Chauffør', 'Jeres beløb ekskl. moms', 'Status', 'Forventet'], tr.map((x) => [x.ref, dk(x.trip_date), x.driver_name || '', num(x.amt), (EST[x.st] || [x.st])[0], x.estimate ? 'ja' : '']));
}
async function settlements() {
  const [all, d] = await Promise.all([rpc('portal_settlements', { p_from: P.from, p_to: P.to }), drvList()]);
  const s = all.filter((x) => !F.driver || x.driver_id === F.driver);
  const sum = (st) => s.filter((x) => !st || x.status === st).reduce((a, x) => a + x.total, 0);
  app.innerHTML = `<div class="card"><div class="row"><h3>Afregninger</h3><button class="ghost" id="cx">⬇ CSV</button></div><p class="muted">Afregninger oprettes, når en tur er leveret. Road Force godkender og betaler via bank. Godkendte afregninger er låst; rettelser vises som reguleringer med begrundelse.</p>
    <div class="filters">${driverFilter(d)}</div>${period()}
    <div class="tiles"><div class="tile"><span class="muted">Afventer godkendelse</span><b>${kr(sum('draft'))}</b></div><div class="tile"><span class="muted">Godkendt, ikke udbetalt</span><b>${kr(sum('approved'))}</b></div><div class="tile"><span class="muted">Udbetalt</span><b>${kr(sum('paid'))}</b></div></div>
    ${table(['Tur', 'Dato', 'Chauffør', 'Jeres andel', 'Reguleringer', 'I alt', 'Udlæg', 'Status', 'Betalt'], s.map((x) => `<tr><td><b>${esc(x.ref)}</b></td><td>${dk(x.trip_date)}</td><td>${esc(x.driver_name || '–')}</td><td class="r">${kr(x.share)}<small>${x.percent} %</small></td><td class="r">${x.adjustments ? kr(x.adjustments) + x.adjustment_list.map((a) => `<small>${esc(a.reason)}</small>`).join('') : '–'}</td><td class="r"><b>${kr(x.total)}</b></td><td class="r">${kr(x.expenses_sub)}</td><td>${pill(SETT, x.status)}</td><td>${x.paid_at ? dk(x.paid_at) + `<small>${esc(x.payment_reference || '')}</small>` : '–'}</td></tr>`), [3, 4, 5, 6])}</div>`;
  wirePeriod(settlements); wireDriver(settlements);
  $('#cx').onclick = () => csv(`afregninger_${P.from}_${P.to}.csv`, ['Tur', 'Dato', 'Chauffør', 'Andel %', 'Jeres andel', 'Reguleringer', 'I alt', 'Udlæg', 'Status', 'Betalt dato', 'Reference'], s.map((x) => [x.ref, dk(x.trip_date), x.driver_name || '', x.percent, num(x.share), num(x.adjustments), num(x.total), num(x.expenses_sub), (SETT[x.status] || [x.status])[0], x.paid_at || '', x.payment_reference || '']));
}
function routes() {
  app.innerHTML = `<div class="card"><div class="row"><h3>Ruter</h3><span class="pill warn">Kommer snart</span></div><p class="muted">Denne funktion er ikke tilgængelig endnu. Ruter med flere pakker kommer, når Road Force Parcel (pakkelevering) lanceres. Der vises ingen rutedata her. Jeres nuværende opgaver findes under <b>Ture</b>.</p></div>`;
}
async function firm() {
  const [docs, v] = await Promise.all([rpc('portal_documents'), rpc('portal_vehicles')]); const c = ME.company, rf = ME.roadforce;
  const line = (k, val) => `<div class="kv"><span class="muted">${esc(k)}</span><b>${val}</b></div>`;
  app.innerHTML = `<div class="card"><h3>${esc(c.name)}</h3>
    <div class="kvs">${line('CVR', esc(c.cvr || '–'))}${line('Vognmand', esc(c.owner_name || '–'))}${line('Kontaktperson', esc(c.contact_name || '–'))}${line('Telefon', esc(c.phone || '–'))}${line('E-mail', esc(c.email || '–'))}${line('Adresse', esc(c.address || '–'))}${line('Status hos Road Force', esc(SUBST[c.status] || c.status))}</div></div>
    <div class="card"><h3>Afregning</h3><div class="kvs">${line('Afregningsmodel', `${c.percent} % til jer / ${100 - c.percent} % til Road Force${c.rates_confirmed ? '' : ' <span class="pill warn">ikke bekræftet</span>'}`)}${line('Betalingsbetingelser', esc(c.payment_terms || 'Ikke angivet'))}${line('Udbetales til konto', esc(c.bank_masked || 'Ikke registreret'))}</div></div>
    <div class="card"><h3>Forsikring og tilladelser</h3><div class="kvs">${line('Forsikringsselskab', esc(c.insurance_company || '–'))}${line('Policenummer', esc(c.insurance_policy_no || '–'))}${line('Forsikring gyldig', expiry(c.insurance_expires_on))}</div>
      ${table(['Type', 'Dokument', 'Reference', 'Udløb'], docs.map((d) => `<tr><td>${esc(DOCK[d.kind] || d.kind || 'Andet')}</td><td>${esc(d.title)}</td><td>${esc(d.reference || '–')}</td><td>${expiry(d.expires_on)}</td></tr>`), [], 'Ingen dokumenter registreret.')}</div>
    <div class="card"><h3>Køretøjer</h3>${table(['Reg.nr.', 'Type', 'Note', 'Status'], v.map((x) => `<tr><td><b>${esc(x.reg_no || '–')}</b></td><td>${esc(VKIND[x.kind] || x.kind || '–')}</td><td>${esc(x.note || '')}</td><td>${x.active ? '<span class="pill good">Aktiv</span>' : '<span class="pill low">Inaktiv</span>'}</td></tr>`), [], 'Ingen køretøjer registreret.')}</div>
    <p class="notice">Er noget forkert eller udløbet? Kontakt ${esc(rf.name || 'Road Force')}: ${esc(rf.email || 'kontakt@roadforce.dk')}${rf.phone ? ' · ' + esc(rf.phone) : ''}. Oplysningerne vedligeholdes af Road Force.</p>`;
}

// ───── Live-kort (Leaflet + OpenStreetMap; indlæses først, når fanen åbnes, med integritetstjek) ─────
const LEAFLET = { js: ['https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js', 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='], css: ['https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css', 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='] };
let leafletP = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  return leafletP = leafletP || new Promise((res, rej) => {
    const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LEAFLET.css[0]; l.integrity = LEAFLET.css[1]; l.crossOrigin = 'anonymous'; document.head.appendChild(l);
    const s = document.createElement('script'); s.src = LEAFLET.js[0]; s.integrity = LEAFLET.js[1]; s.crossOrigin = 'anonymous';
    s.onload = () => res(window.L); s.onerror = () => { leafletP = null; rej(new Error('leaflet')); }; document.head.appendChild(s);
  });
}
const ago = (t) => { const m = Math.max(0, Math.round((Date.now() - new Date(t)) / 60000)); return m < 1 ? 'lige nu' : m === 1 ? 'for 1 min. siden' : `for ${m} min. siden`; };
let MAP = null, MARK = {}, MAPT = null;
async function mountMap() {
  MAP = null; MARK = {};
  try { await loadLeaflet(); } catch (e) { const el = $('#lm'); if (el) el.outerHTML = '<p class="err">Kortet kunne ikke indlæses lige nu. Prøv at genindlæse siden.</p>'; }
  if (window.L && $('#lm')) {
    MAP = L.map('lm', { zoomControl: true, attributionControl: true }).setView([55.68, 12.57], 10);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, referrerPolicy: 'strict-origin-when-cross-origin', attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(MAP);
  }
  await refreshMap(true);
  clearInterval(MAPT); MAPT = setInterval(() => { if (VIEW === 'overview' && !document.hidden) refreshMap(false); else if (VIEW !== 'overview') clearInterval(MAPT); }, 30000);
}
async function refreshMap(fit) {
  let pos; try { pos = await rpc('portal_positions'); } catch (e) { const u = $('#lm-upd'); if (u) u.textContent = 'Positioner kunne ikke hentes'; return; }
  if (VIEW !== 'overview' || !$('#lm-upd')) return;
  const live = pos.filter((p) => p.lat != null && p.lon != null);
  if (MAP) {
    const seen = new Set();
    for (const p of live) {
      seen.add(p.driver_id);
      const tip = `<b>${esc(p.name)}</b><br>${esc(p.trip_ref || '')} · ${esc((ST[p.trip_status] || [p.trip_status])[0] || '')}${p.to_city ? '<br>→ ' + esc(p.to_city) : ''}<br><small>${esc(ago(p.updated_at))}</small>`;
      if (MARK[p.driver_id]) MARK[p.driver_id].setLatLng([p.lat, p.lon]).setTooltipContent(tip);
      else MARK[p.driver_id] = L.circleMarker([p.lat, p.lon], { radius: 9, weight: 3, color: '#ffffff', fillColor: '#255cff', fillOpacity: 1 }).bindTooltip(tip, { permanent: live.length <= 6, direction: 'top', offset: [0, -8] }).addTo(MAP);
    }
    for (const id of Object.keys(MARK)) if (!seen.has(id)) { MAP.removeLayer(MARK[id]); delete MARK[id]; }
    if (fit && live.length) MAP.fitBounds(L.latLngBounds(live.map((p) => [p.lat, p.lon])).pad(0.3), { maxZoom: 13 });
  }
  $('#lm-upd').textContent = `${live.length} på kortet · opdateret ${new Date().toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  const off = pos.filter((p) => p.lat == null).map((p) => p.name);
  if (!live.length) $('#lm-upd').textContent = 'Ingen chauffører på aktiv tur med position lige nu';
  else if (off.length) $('#lm-upd').textContent += ` · uden position: ${off.join(', ')}`;
}
const VIEWS = { overview, drivers, trips, earnings, settlements, firm, routes };
async function show(v) {
  VIEW = v; DRV = null;
  $$('#nav button').forEach((b) => { if (b.dataset.v === v) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  app.innerHTML = '<p class="muted">Henter…</p>';
  try { await VIEWS[v](); } catch (e) { app.innerHTML = `<div class="card"><p class="err">${esc(errMsg(e))}</p></div>`; }
}
// ───── Totrinslogin (TOTP) – kræves af databasen, når portal_settings.require_mfa er slået til ─────
async function mfa() {
  $('#out').hidden = false; $('#nav').hidden = true;
  const { data: lf, error: le } = await sb.auth.mfa.listFactors(); if (le) return login('Totrinslogin kunne ikke startes. Prøv igen.');
  const verified = (lf.totp || []).find((f) => f.status === 'verified');
  let factorId = verified && verified.id, setup = '';
  if (!verified) {
    for (const f of (lf.all || []).filter((x) => x.status === 'unverified')) await sb.auth.mfa.unenroll({ factorId: f.id });
    const { data: en, error: ee } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Road Force portal' });
    if (ee) return login('Totrinslogin kunne ikke oprettes. Kontakt Road Force.');
    factorId = en.id;
    setup = `<p class="muted">Første gang: Scan koden med en godkendelsesapp (fx Microsoft Authenticator eller Google Authenticator). Kan du ikke scanne, så indtast nøglen manuelt.</p>
      <img src="${esc(en.totp.qr_code)}" alt="QR-kode til godkendelsesapp" width="200" height="200" style="background:#fff;border-radius:12px;padding:8px;justify-self:start">
      <p class="muted">Nøgle: <code>${esc(en.totp.secret)}</code></p>`;
  }
  app.innerHTML = `<form id="mf" class="card login"><h2>Totrinslogin</h2>${setup}<label>6-cifret kode fra godkendelsesappen<input name="c" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label><button>Bekræft</button><div class="err" id="me" role="alert"></div></form>`;
  $('#mf').c.focus();
  $('#mf').onsubmit = async (ev) => { ev.preventDefault(); const b = ev.target.querySelector('button'); b.disabled = true; $('#me').textContent = '';
    const { data: ch, error: ce } = await sb.auth.mfa.challenge({ factorId });
    const { error: ve } = ce ? { error: ce } : await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code: ev.target.c.value.trim() });
    if (ve) { b.disabled = false; return ($('#me').textContent = 'Koden blev ikke godkendt. Tjek uret på telefonen, og prøv igen.'); }
    boot(); };
}
// ───── Accept af invitation (ny bruger vælger først adgangskode) ─────
function invitePassword() {
  $('#out').hidden = false; $('#nav').hidden = true;
  app.innerHTML = `<form id="pwf" class="card login"><h2>Velkommen</h2><p class="muted">Din e-mail er bekræftet. Vælg en adgangskode til underleverandørportalen.</p>
    <label>Adgangskode (mindst 10 tegn)<input name="p1" type="password" minlength="10" required autocomplete="new-password"></label>
    <label>Gentag adgangskode<input name="p2" type="password" minlength="10" required autocomplete="new-password"></label><button>Gem og fortsæt</button><div class="err" id="pe" role="alert"></div></form>`;
  $('#pwf').onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target; $('#pe').textContent = '';
    if (f.p1.value !== f.p2.value) return ($('#pe').textContent = 'De to adgangskoder er ikke ens.');
    f.querySelector('button').disabled = true; const { error } = await sb.auth.updateUser({ password: f.p1.value });
    if (error) { f.querySelector('button').disabled = false; return ($('#pe').textContent = /weak|short|least/i.test(error.message) ? 'Adgangskoden er for svag.' : 'Adgangskoden kunne ikke gemmes. Prøv igen.'); }
    acceptInvite(); };
}
async function acceptInvite() {
  const t = pendingInvite(); if (!t) return boot();
  const { error } = await sb.rpc('portal_accept_invitation', { p_token: t });
  clearInvite();
  if (error) { const m = /ugyldig|udløbet|brugt/i.test(error.message) ? 'Invitationen er ugyldig, udløbet eller allerede brugt. Bed Road Force om en ny invitation.'
      : /anden e-mailadresse/.test(error.message) ? 'Invitationen er sendt til en anden e-mailadresse end den, du er logget ind med.' : 'Invitationen kunne ikke accepteres. Kontakt Road Force.';
    await sb.auth.signOut({ scope: 'local' }); return login(m); }
  boot();
}
async function boot() {
  const { data: { session } } = await sb.auth.getSession(); if (!session) return login(pendingInvite() ? 'Log ind for at acceptere invitationen. Er linket udløbet, så bed Road Force om en ny invitation.' : '');
  if (pendingInvite()) return IS_NEW_INVITE && !boot.pwDone ? (boot.pwDone = true, invitePassword()) : acceptInvite();
  let st; try { st = await rpc('portal_status'); } catch (e) { return login(errMsg(e)); }
  if (!st.member) { await sb.auth.signOut({ scope: 'local' }); return login('Din bruger har ikke adgang til underleverandørportalen. Kontakt Road Force.'); }
  if (st.mfa_required && st.aal !== 'aal2') return mfa();
  try { ME = await rpc('portal_me'); } catch (e) { await sb.auth.signOut({ scope: 'local' }); return login(errMsg(e)); }
  $('#firm').textContent = `Underleverandørportal · ${ME.company.name}`; $('#out').hidden = false; $('#nav').hidden = false;
  show(VIEW);
}
$$('#nav button').forEach((b) => b.onclick = () => show(b.dataset.v));
$('#out').onclick = async () => { await sb.auth.signOut(); login(); };
boot(); setInterval(() => { if (ME && !document.hidden && ['overview', 'trips'].includes(VIEW)) show(VIEW); }, 300000);
})();
