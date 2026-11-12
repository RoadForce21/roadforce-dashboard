/* RoadForce driftscenter – ren browser-JS, ingen byggetrin. */
(() => {
  const CFG = window.RF_CONFIG || {};
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  // Al brugerindtastet tekst skal igennem esc() før den sættes ind som HTML (XSS-beskyttelse).
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kr = (ore) => `${(ore / 100).toLocaleString('da-DK', { minimumFractionDigits: ore % 100 ? 2 : 0, maximumFractionDigits: 2 })} kr`;
  const dt = (iso) => new Date(iso).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const ago = (iso) => { const m = Math.round((Date.now() - new Date(iso)) / 60000); return m < 1 ? 'lige nu' : m < 60 ? `${m} min siden` : `${Math.round(m / 60)} t siden`; };
  const pal = (n) => `${n} ${Number(n) === 1 ? 'palle' : 'paller'}`;
  const VEH_NAME = { van: 'Mercedes-Benz Vito – kassebil', van_large: 'Mercedes-Benz Sprinter L2H2 – stor kassebil', lift: 'Mercedes-Benz Sprinter – liftbil', lorry18: 'Mercedes-Benz – lastbil (18 pallepladser)', lorry24: 'Mercedes-Benz – lastbil (24 pallepladser)' };
  const vehLabel = (o) => `${VEH_NAME[o.vehicle] || o.vehicle}${o.service === 'hourly' ? ` · timebooking ${o.hours} t` : ''}${Number(o.extra_man_hours) ? ` · +mand ${o.extra_man_hours} t` : ''}`;
  const distLabel = (o) => o.service === 'hourly' ? 'timebooking' : `${o.distance_km} km`;
  const city = (a) => String(a || '').split(',').slice(-2, -1)[0]?.trim().replace(/^\d{4}\s*/, '') || a;

  const STATUS = { awaiting_payment: 'Afventer betaling', new: 'Ny – skal tildeles', assigned: 'Tildelt', loaded: 'Afhentet', in_transit: 'Undervejs', delivered: 'Leveret', cancelled: 'Annulleret' };
  const PAY = { unpaid: 'Ubetalt', paid: 'Betalt', refunded: 'Refunderet', partially_refunded: 'Delvist refunderet (gebyr)', failed: 'Betaling fejlede' };
  const EXTRA_KIND = { waiting: 'Ventetid', extra_km: 'Ekstra km', toll: 'Bro/færge', parking: 'Parkering', other: 'Andet' };
  const ACTIVE = ['assigned', 'loaded', 'in_transit'];

  // [kolonne, tekst, enhed, erBeløb(øre→kr)]; grupperet efter prislistens afsnit
  const PRICING_GROUPS = [
    ['Kassebil – A–B', [['van_min_ore', 'Minimumspris pr. tur', 'kr', true], ['van_km_ore', 'Pris pr. km', 'kr', true], ['van_stop_ore', 'Ekstra stop', 'kr', true], ['van_wait_ore', 'Ekstra tid pr. påbegyndt kvarter', 'kr', true]]],
    ['Sprinter L2H2 – A–B (foreslåede satser 12/11; fast pris først når kapacitet er udfyldt)', [['van_large_min_ore', 'Minimumspris pr. tur', 'kr', true], ['van_large_km_ore', 'Pris pr. km', 'kr', true], ['van_large_stop_ore', 'Ekstra stop', 'kr', true], ['van_large_wait_ore', 'Ekstra tid pr. påbegyndt kvarter', 'kr', true], ['van_large_hour_ore', 'Timepris', 'kr', true], ['van_large_extra_km_ore', 'Ekstra km (timebooking)', 'kr', true], ['van_large_max_pallets', 'Dokumenteret maks. pallepladser (tom = kun tilbud)', 'stk', false], ['van_large_max_weight_kg', 'Dokumenteret maks. vægt (tom = kun tilbud)', 'kg', false]]],
    ['Mindre liftbil – A–B', [['lift_min_ore', 'Minimumspris pr. tur', 'kr', true], ['lift_km_ore', 'Pris pr. km', 'kr', true], ['lift_stop_ore', 'Ekstra stop', 'kr', true], ['lift_wait_ore', 'Ekstra tid pr. påbegyndt kvarter', 'kr', true]]],
    ['Timebooking', [['van_hour_ore', 'Kassebil – timepris', 'kr', true], ['lift_hour_ore', 'Liftbil – timepris', 'kr', true], ['hourly_min_hours', 'Minimumsbooking', 'timer', false], ['km_per_hour', 'Inkluderede km pr. time', 'km', false], ['van_extra_km_ore', 'Kassebil – ekstra km', 'kr', true], ['lift_extra_km_ore', 'Liftbil – ekstra km', 'kr', true]]],
    ['Tillæg', [['acute_percent', 'Akut', '%', false], ['acute_min_ore', 'Akut – mindstebeløb', 'kr', true], ['evening_percent', 'Hverdage 17–22', '%', false], ['night_percent', 'Nat 22–07', '%', false], ['weekend_percent', 'Weekend og helligdage', '%', false]]],
    ['Ekstra mand', [['extra_man_day_ore', 'Hverdage 07–17 (pr. time)', 'kr', true], ['extra_man_evening_ore', 'Hverdage 17–22 (pr. time)', 'kr', true], ['extra_man_night_ore', 'Nat, weekend, helligdage (pr. time)', 'kr', true], ['extra_man_min_hours', 'Minimumsbooking', 'timer', false]]],
    ['Grænser og moms', [['max_route_km', 'A–B maks. (derover: tilbud)', 'km', false], ['max_stops', 'Maks. ekstra stop', 'stk', false], ['max_weight_kg', 'Maks. vægt', 'kg', false], ['max_pallets', 'Maks. pallepladser', 'stk', false], ['vat_percent', 'Moms', '%', false]]],
  ];
  const PRICING_FIELDS = PRICING_GROUPS.flatMap(([, f]) => f);

  const S = { sb: null, me: null, orders: [], drivers: [], positions: new Map(), pricing: null, company: null, inquiries: [], selected: null,
              map: null, traffic: null, dMarkers: new Map(), oMarkers: [], route: null, info: null, realtimeOk: false };

  // ───────────── Start ─────────────
  if (!CFG.SUPABASE_URL || !CFG.SUPABASE_ANON_KEY) {
    $('#login-error').textContent = 'config.js mangler. Kopiér config.example.js til config.js og udfyld den.';
    return;
  }
  const IS_RECOVERY = /type=recovery/.test(location.hash);
  S.sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-form button'); btn.disabled = true; $('#login-error').textContent = '';
    const { error } = await S.sb.auth.signInWithPassword({ email: $('#login-email').value.trim(), password: $('#login-password').value });
    btn.disabled = false;
    if (error) { $('#login-error').textContent = 'Forkert e-mail eller adgangskode.'; return; }
    boot();
  });
  $('#chpw').addEventListener('click', () => showRecovery());
  $('#logout').addEventListener('click', async () => { await S.sb.auth.signOut(); location.reload(); });
  S.sb.auth.getSession().then(({ data }) => { if (IS_RECOVERY) { showRecovery(); return; } if (data.session) boot(); });

  // Nulstil adgangskode: Supabase sender brugeren hertil med et recovery-link.
  S.sb.auth.onAuthStateChange((event) => { if (event === 'PASSWORD_RECOVERY') showRecovery(); });
  function showRecovery() {
    $('#shell').hidden = true; $('#login').hidden = false; $('#login-form').hidden = true;
    let f = document.getElementById('recovery-form');
    if (f) return;
    f = document.createElement('form');
    f.id = 'recovery-form'; f.className = 'login-card';
    f.innerHTML = '<h1>Ny adgangskode</h1><p class="muted">Vælg en ny adgangskode (mindst 10 tegn).</p>' +
      '<label>Ny adgangskode<input id="rec-pw" type="password" minlength="10" required autocomplete="new-password"></label>' +
      '<button class="btn" type="submit">Gem adgangskode</button><p id="rec-msg" class="error" role="alert"></p>';
    $('#login').appendChild(f);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      const { error } = await S.sb.auth.updateUser({ password: $('#rec-pw').value });
      if (error) { $('#rec-msg').textContent = 'Kunne ikke gemme: ' + error.message; return; }
      location.hash = ''; location.reload();
    });
  }

  async function boot() {
    const { data: { user } } = await S.sb.auth.getUser();
    if (!user) return;
    const { data: me } = await S.sb.from('profiles').select('id, role, full_name, active').eq('id', user.id).single();
    if (!me || me.role !== 'admin' || !me.active) {
      await S.sb.auth.signOut();
      $('#login-error').textContent = 'Denne bruger har ikke adgang til driftscenteret.';
      return;
    }
    S.me = me;
    $('#login').hidden = true; $('#shell').hidden = false;
    $('#who').textContent = me.full_name || user.email;
    fillStatusFilter(); wireUI();
    await Promise.all([loadDrivers(), loadOrders(), loadPositions(), loadPricing(), loadCompany(), loadInquiries(), loadVehicles()]);
    renderAll();
    subscribe();
    setInterval(() => { loadOrders().then(renderAll); }, 30000); // sikkerhedsnet hvis realtime falder ud
    try { await initMap(); renderMap(); } catch (e) { $('#map').innerHTML = `<p class="muted" style="padding:20px">${esc(e.message)}</p>`; }
  }

  // ───────────── Data ─────────────
  async function loadOrders() {
    const { data, error } = await S.sb.from('orders').select('*, customer:profiles!orders_customer_id_fkey(full_name, company, kind, phone)').order('created_at', { ascending: false }).limit(500);
    if (!error) S.orders = data;
  }
  async function loadDrivers() {
    const { data } = await S.sb.from('profiles').select('id, full_name, phone, active').eq('role', 'driver').order('full_name');
    S.drivers = data || [];
  }
  async function loadPositions() {
    const { data } = await S.sb.from('driver_positions').select('*');
    S.positions = new Map((data || []).map((p) => [p.driver_id, p]));
  }
  async function loadPricing() {
    const { data } = await S.sb.from('pricing_settings').select('*').eq('id', 1).single();
    S.pricing = data;
  }

  async function loadCompany() {
    const { data } = await S.sb.from('company_settings').select('*').eq('id', 1).single(); S.company = data;
  }
  async function loadVehicles() {
    const { data } = await S.sb.from('vehicle_types').select('*').order('sort'); S.vehicles = data || [];
  }
  async function loadInquiries() {
    const { data } = await S.sb.from('quote_inquiries').select('*, customer:profiles!quote_inquiries_customer_id_fkey(full_name, company, phone)').order('created_at', { ascending: false }).limit(200);
    S.inquiries = data || [];
  }

  let refreshTimer;
  function subscribe() {
    S.sb.channel('rf-admin')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(async () => { await loadOrders(); renderAll(); }, 300);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'quote_inquiries' }, async () => { await loadInquiries(); renderInquiries(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'driver_positions' }, (p) => {
        if (p.eventType === 'DELETE') S.positions.delete(p.old.driver_id); else S.positions.set(p.new.driver_id, p.new);
        renderDriverMarkers(); renderDriversList();
      })
      .subscribe((st) => { S.realtimeOk = st === 'SUBSCRIBED'; const c = $('#conn'); c.textContent = S.realtimeOk ? '● Live' : '● Forbinder…'; c.classList.toggle('ok', S.realtimeOk); });
  }

  // ───────────── UI ─────────────
  function fillStatusFilter() {
    $('#filter-status').insertAdjacentHTML('beforeend', Object.entries(STATUS).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join(''));
  }

  function wireUI() {
    $$('#nav button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
    $('#filter-status').addEventListener('change', renderOrdersTable);
    $('#filter-q').addEventListener('input', renderOrdersTable);
    $('#drawer-close').addEventListener('click', closeDrawer);
    $('#t-traffic').addEventListener('change', (e) => S.traffic?.setMap(e.target.checked ? S.map : null));
    $('#t-dark').addEventListener('change', (e) => S.map?.setOptions({ styles: e.target.checked ? DARK : [] }));
    $('#t-drivers').addEventListener('change', renderDriverMarkers);
    $('#t-orders').addEventListener('change', renderOrderMarkers);
    $('#driver-form').addEventListener('submit', createDriver);
    $('#pricing-form').addEventListener('submit', savePricing);
    $('#company-form').addEventListener('submit', saveCompany);
    $('#pricing-form').addEventListener('input', renderPricingExample);
    window.addEventListener('rf-pricing', renderPricingExample);
  }

  function showView(v) {
    $$('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    $$('.view').forEach((x) => (x.hidden = x.id !== `view-${v}`));
    if (v === 'map' && S.map) google.maps.event.trigger(S.map, 'resize');
  }

  function renderAll() {
    const fresh = S.orders.filter((o) => o.status === 'new');
    const b = $('#badge-new'); b.hidden = !fresh.length; b.textContent = fresh.length;
    renderPanel(); renderOrdersTable(); renderDriversList(); renderPricingForm(); renderCompanyForm(); renderInquiries(); renderVehicles();
    renderMap();
    if (S.selected) { const o = S.orders.find((x) => x.id === S.selected); if (o && !$('#drawer').hidden) openDrawer(o.id, true); }
  }

  const driverName = (id) => S.drivers.find((d) => d.id === id)?.full_name || '–';
  const custName = (o) => o.customer?.company || o.customer?.full_name || '–';
  const driverOptions = (sel) => `<option value="">Vælg chauffør…</option>` + S.drivers.filter((d) => d.active).map((d) => `<option value="${esc(d.id)}" ${d.id === sel ? 'selected' : ''}>${esc(d.full_name)}</option>`).join('');

  function renderPanel() {
    const fresh = S.orders.filter((o) => o.status === 'new');
    $('#count-new').textContent = fresh.length;
    $('#panel-new').innerHTML = fresh.length ? fresh.map((o) => `
      <div class="item" data-open="${esc(o.id)}">
        <b>${esc(o.ref)} · ${esc(custName(o))}</b>
        <small>${esc(city(o.from_address))} → ${esc(city(o.to_address))} · ${esc(dt(o.pickup_at))}</small>
        <small>${esc(vehLabel(o))} · ${esc(pal(o.pallets))} · ${esc(o.weight_kg)} kg · ${kr(o.price_ex_vat)} ekskl. moms</small>
        <select data-assign="${esc(o.id)}">${driverOptions('')}</select>
      </div>`).join('') : '<p class="muted">Ingen nye betalte ordrer.</p>';
    const act = S.orders.filter((o) => ACTIVE.includes(o.status));
    $('#panel-active').innerHTML = act.length ? act.map((o) => `
      <div class="item" data-open="${esc(o.id)}">
        <b>${esc(o.ref)} <span class="pill ${esc(o.status)}">${esc(STATUS[o.status])}</span></b>
        <small>${esc(driverName(o.driver_id))} · ${esc(city(o.from_address))} → ${esc(city(o.to_address))}</small>
      </div>`).join('') : '<p class="muted">Ingen aktive ture.</p>';
    $$('#panel-new select[data-assign]').forEach((sel) => {
      sel.addEventListener('click', (e) => e.stopPropagation());
      sel.addEventListener('change', () => sel.value && assign(sel.dataset.assign, sel.value));
    });
    $$('#view-map [data-open]').forEach((el) => el.addEventListener('click', () => { openDrawer(el.dataset.open); focusOrder(el.dataset.open); }));
  }

  function renderOrdersTable() {
    const st = $('#filter-status').value; const q = $('#filter-q').value.trim().toLowerCase();
    const rows = S.orders.filter((o) => (!st || o.status === st) &&
      (!q || `${o.ref} ${o.from_address} ${o.to_address} ${custName(o)} ${o.goods}`.toLowerCase().includes(q)));
    $('#orders-table tbody').innerHTML = rows.map((o) => `
      <tr data-open="${esc(o.id)}">
        <td><b>${esc(o.ref)}</b></td><td>${esc(custName(o))}<br><small class="muted">${o.customer_kind === 'business' ? 'Erhverv' : 'Privat'}</small></td>
        <td>${esc(city(o.from_address))} → ${esc(city(o.to_address))}<br><small class="muted">${esc(distLabel(o))}</small></td>
        <td>${esc(dt(o.pickup_at))}</td><td>${kr(o.price_total)}<br><small class="muted">${esc((PAY[o.payment_status] || o.payment_status).toLowerCase())}</small></td>
        <td><span class="pill ${esc(o.status)}">${esc(STATUS[o.status])}</span></td><td>${esc(driverName(o.driver_id))}</td>
      </tr>`).join('') || '<tr><td colspan="7" class="muted">Ingen ordrer.</td></tr>';
    $$('#orders-table [data-open]').forEach((tr) => tr.addEventListener('click', () => openDrawer(tr.dataset.open)));
  }

  function renderDriversList() {
    $('#drivers-list').innerHTML = S.drivers.map((d) => {
      const trips = S.orders.filter((o) => o.driver_id === d.id && ACTIVE.includes(o.status)).length;
      const pos = S.positions.get(d.id);
      return `<div class="item"><b>${esc(d.full_name)} ${d.active ? '' : '(inaktiv)'}</b><small>${esc(d.phone || 'ingen telefon')} · ${trips} aktive ture · ${pos ? 'position ' + esc(ago(pos.updated_at)) : 'ingen position'}</small></div>`;
    }).join('') || '<p class="muted">Ingen chauffører endnu.</p>';
  }

  // ───────────── Handlinger ─────────────
  async function fnError(error) {
    try { const j = await error.context.json(); return j.error || 'Fejl'; } catch { return error.message || 'Fejl'; }
  }

  async function assign(orderId, driverId) {
    const { error } = await S.sb.rpc('admin_assign_driver', { p_order: orderId, p_driver: driverId });
    if (error) { alert(error.message); return; }
    await loadOrders(); renderAll();
  }

  function cancelPanelHtml(o) {
    const paid = o.payment_status === 'paid';
    return `<div class="card" id="cancel-panel" style="margin-top:12px">
      <b>Annullér ${esc(o.ref)}</b>
      ${paid ? `<p class="muted" style="margin-top:8px">Standard: intet gebyr – hele ${kr(o.price_total)} refunderes på kortet. Krav om dokumenteret, rimeligt tab behandles manuelt uden for systemet og trækkes aldrig automatisk.</p>`
      : '<p class="muted">Ordren er ikke betalt, så der opkræves intet gebyr.</p>'}
      <div style="display:flex;gap:8px;margin-top:8px"><button id="c-yes" class="btn danger">Ja, annullér</button><button id="c-no" class="btn ghost">Fortryd</button></div></div>`;
  }
  function cancelPreview(o) {
    const P = window.RFPricing; const el = $('#cancel-preview'); if (!P || !el) return;
    const fee = document.querySelector('#cancel-panel [name=fee]:checked')?.value || 'none';
    const r = P.cancellationOutcome(S.pricing, { service: o.service, vehicle: o.vehicle, pickupAt: o.pickup_at, dispatched: $('#c-disp')?.checked || ['loaded', 'in_transit'].includes(o.status), paidTotal: o.price_total, confirmedExVat: o.price_ex_vat, vatPercent: o.vat_percent, feeMode: fee });
    el.textContent = `Gebyr inkl. moms: ${kr(r.feeTotal)} · Refunderes til kunden: ${kr(r.refund)}`;
  }
  async function cancelOrder(id) {
    const o = S.orders.find((x) => x.id === id); if (!o) return;
    $('#d-cancel').outerHTML = cancelPanelHtml(o);
    $('#c-no').addEventListener('click', () => openDrawer(id, true));
    $('#c-yes').addEventListener('click', async () => {
      const fee_mode = 'none';
      const { error } = await S.sb.functions.invoke('admin-cancel-order', { body: { order_id: id, fee_mode, dispatched: false } });
      if (error) { alert(await fnError(error)); return; }
      await loadOrders(); renderAll();
    });
  }

  // ───────────── Tillæg og faktura ─────────────
  async function addExtra(id, e) {
    e.preventDefault(); const f = e.target; const v = Object.fromEntries(new FormData(f));
    const ore = Math.round(Number(v.amount) * 100);
    if (!(ore > 0)) return;
    const { error } = await S.sb.from('order_extras').insert({ order_id: id, kind: v.kind, description: String(v.description).trim(), amount_ex_vat: ore, vat_applies: !!v.vat, created_by: S.me?.id });
    if (error) { alert(error.message); return; }
    openDrawer(id, true);
  }
  async function issueInvoice(id) {
    const { data, error } = await S.sb.rpc('admin_issue_invoice', { p_order: id });
    if (error) { alert(error.message); return; }
    openDrawer(id, true); showInvoice(data);
  }
  function showInvoice(inv) {
    if (!window.RFInvoice) return;
    const w = window.open('', '_blank'); if (!w) { alert('Tillad pop-ups for at se fakturaen.'); return; }
    w.document.open(); w.document.write(window.RFInvoice.renderInvoiceHtml(inv)); w.document.close();
  }

  // ───────────── Tilbud ─────────────
  function renderInquiries() {
    const open = S.inquiries.filter((q) => q.status === 'open').length;
    const b = $('#badge-inq'); if (b) { b.hidden = !open; b.textContent = open; }
    $('#inq-list').innerHTML = S.inquiries.map((q) => `<div class="card" style="margin-bottom:12px" data-inq="${esc(q.id)}">
      <b>${esc(q.ref)} · ${esc(q.customer?.company || q.customer?.full_name || '')}</b> <span class="muted">${esc(dt(q.created_at))} · ${esc(q.customer?.phone || q.phone || '')}</span>
      <p style="margin:6px 0">${esc(q.from_address)}${q.to_address ? ' → ' + esc(q.to_address) : ''}${q.vehicle ? ' · ' + esc(VEH_NAME[q.vehicle] || q.vehicle) : ''}<br>${esc(q.details)}</p>
      <label>Status<select class="inq-status"><option value="open"${q.status === 'open' ? ' selected' : ''}>Åben</option><option value="answered"${q.status === 'answered' ? ' selected' : ''}>Besvaret</option><option value="offered"${q.status === 'offered' ? ' selected' : ''} disabled>Tilbud sendt</option><option value="accepted"${q.status === 'accepted' ? ' selected' : ''} disabled>Accepteret</option><option value="closed"${q.status === 'closed' ? ' selected' : ''}>Lukket</option></select></label>
      <label>Intern note / tilbudt pris<input class="inq-note" maxlength="1000" value="${esc(q.admin_note || '')}"></label>
      <button class="btn small inq-save">Gem</button>
      ${q.order_id ? '<p class="muted">Tilbuddet er brugt til en ordre.</p>' : `<details style="margin-top:8px"><summary>${q.status === 'offered' ? 'Tilbud sendt – ret/send igen' : q.status === 'accepted' ? 'Accepteret ' + esc(dt(q.accepted_at)) + ' (vilkår ' + esc(q.accepted_terms_version || '?') + ')' : 'Lav tilbud til kunden'}</summary>
        <label>Pris ekskl. moms (kr)<input class="of-price" type="number" min="1" step="1" value="${q.offer_ex_vat ? q.offer_ex_vat / 100 : ''}"></label>
        <label>Afhentning<input class="of-pickup" type="datetime-local" value="${q.offer_pickup_at ? new Date(new Date(q.offer_pickup_at).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}"></label>
        <label>Pallepladser<input class="of-pal" type="number" min="1" value="${q.offer_pallets || ''}"></label>
        <label>Vægt (kg)<input class="of-kg" type="number" min="1" value="${q.offer_weight_kg || ''}"></label>
        <label>Gyldigt til<input class="of-valid" type="datetime-local"></label>
        <label>Besked til kunden<input class="of-note" maxlength="1000" value="${esc(q.offer_note || '')}"></label>
        <button class="btn small of-send">Send tilbud til kunden</button></details>`}</div>`).join('') || '<p class="muted">Ingen tilbudsforespørgsler.</p>';
    $$('#inq-list [data-inq] .of-send').forEach((btn) => btn.addEventListener('click', async () => {
      const el = btn.closest('[data-inq]'); const v = (c) => el.querySelector(c).value;
      const { error } = await S.sb.rpc('admin_send_offer', { p_id: el.dataset.inq, p_ex_vat: Math.round(parseFloat(v('.of-price')) * 100), p_note: v('.of-note') || null, p_pickup_at: new Date(v('.of-pickup')).toISOString(), p_pallets: parseInt(v('.of-pal'), 10), p_weight_kg: parseInt(v('.of-kg'), 10), p_valid_until: new Date(v('.of-valid')).toISOString() });
      if (error) alert('Tilbuddet blev ikke sendt: ' + error.message); else { await loadInquiries(); renderInquiries(); }
    }));
    $$('#inq-list [data-inq]').forEach((el) => el.querySelector('.inq-save').addEventListener('click', async () => {
      const { error } = await S.sb.from('quote_inquiries').update({ status: el.querySelector('.inq-status').value, admin_note: el.querySelector('.inq-note').value.trim() || null }).eq('id', el.dataset.inq);
      if (error) alert(error.message); else { await loadInquiries(); renderInquiries(); }
    }));
  }

  // ───────────── Køretøjer ─────────────
  const VEH_FIELDS = [['pallets_note', 'Pallekapacitet (tekst)'], ['cargo_dimensions', 'Lastrumsmål'], ['max_payload_kg', 'Maks. godsvægt'], ['door_openings', 'Døråbninger'], ['lift_capacity', 'Liftkapacitet']];
  function renderVehicles() {
    const el = $('#veh-list'); if (!el || !S.vehicles) return;
    if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
    el.innerHTML = S.vehicles.map((v) => `<div class="card" style="margin-bottom:12px" data-veh="${v.id}"><b>${esc(v.name)}</b> <span class="muted">${v.bookable ? 'Kan bestilles med fast pris' : 'Få et tilbud'}${v.verified ? ' · verificeret' : ' · ikke verificeret'}${v.mapping_note || v.mapping_confirmed === false ? (v.mapping_confirmed ? ' · kobling bekræftet' : ' · <b>kobling til prisliste ubekræftet</b>') : ''}</span>
      ${v.mapping_note ? `<p class="muted">${esc(v.mapping_note)}</p>` : ''}
      ${VEH_FIELDS.map(([k, l]) => `<label>${l}<input data-f="${k}" value="${esc(v[k] || '')}" maxlength="200"></label>`).join('')}
      <label><input type="checkbox" data-f="bookable"${v.bookable ? ' checked' : ''}> Kan bestilles med fast pris (kun hvis prisen er dokumenteret)</label>
      ${v.mapping_note ? `<label><input type="checkbox" data-f="mapping_confirmed"${v.mapping_confirmed ? ' checked' : ''}> Jeg har kontrolleret, at prisen/koblingen gælder dette køretøj</label>` : ''}
      <label><input type="checkbox" data-f="verified"${v.verified ? ' checked' : ''}> Data er verificeret mod dokumentation/opmåling</label>
      <button class="btn small veh-save">Gem</button></div>`).join('');
    $$('#veh-list [data-veh]').forEach((c) => c.querySelector('.veh-save').addEventListener('click', async () => {
      const upd = {}; c.querySelectorAll('[data-f]').forEach((i) => { upd[i.dataset.f] = i.type === 'checkbox' ? i.checked : (i.value.trim() || (i.dataset.f === 'pallets_note' ? 'Skal bekræftes' : 'Afventer dokumentation')); });
      const { error } = await S.sb.from('vehicle_types').update(upd).eq('id', c.dataset.veh);
      if (error) alert(error.message); else { await loadVehicles(); renderVehicles(); }
    }));
  }

  // ───────────── Dataopbevaring (kun prøvekørsel – sletter intet) ─────────────
  async function runRetentionPreview() {
    const out = $('#ret-out'); out.textContent = 'Kører prøvekørsel…';
    const { data, error } = await S.sb.rpc('admin_retention_preview');
    let html = error ? `<p class="muted">Fejl: ${esc(error.message)}</p>` : '<ul>' + (data || []).map((r) => `<li>${esc(r.action)}: <b>${esc(String(r.affected))}</b></li>`).join('') + '</ul>';
    const f = await S.sb.functions.invoke('purge-storage', { body: { dry_run: true } });
    html += f.error ? '<p class="muted">Storage-prøvekørsel kunne ikke køres.</p>' : `<p>Storage (prøve): ${esc(String(f.data.would_remove ?? 0))} fil(er) ville blive slettet, ${esc(String(f.data.protected ?? 0))} beskyttet.</p>`;
    out.innerHTML = html + '<p class="muted">Prøvekørsel – der er ikke slettet noget.</p>';
  }
  document.addEventListener('click', (e) => { if (e.target && e.target.id === 'ret-preview') runRetentionPreview(); });

  // ───────────── Firmaoplysninger (til faktura) ─────────────
  const COMPANY_FIELDS = [['name', 'Firmanavn'], ['cvr', 'CVR'], ['address', 'Adresse'], ['email', 'E-mail'], ['phone', 'Telefon'], ['bank_info', 'Bankoplysninger (reg./konto eller IBAN)'], ['invoice_footer', 'Fakturatekst (fx betalingsfrist)']];
  function renderCompanyForm() {
    if (!S.company || $('#company-fields').children.length) return;
    $('#company-fields').innerHTML = COMPANY_FIELDS.map(([k, l]) => `<label>${esc(l)}<input name="${k}" value="${esc(S.company[k])}"></label>`).join('');
  }
  async function saveCompany(e) {
    e.preventDefault(); const v = Object.fromEntries(new FormData(e.target));
    const { error } = await S.sb.from('company_settings').update(v).eq('id', 1);
    $('#company-msg').textContent = error ? `Kunne ikke gemme: ${error.message}` : '✔ Gemt. Bruges på nye fakturaer.';
  }

  async function createDriver(e) {
    e.preventDefault();
    const f = e.target; const body = Object.fromEntries(new FormData(f)); const msg = $('#driver-msg');
    msg.textContent = 'Opretter…';
    const { error } = await S.sb.functions.invoke('admin-create-driver', { body });
    if (error) { msg.textContent = await fnError(error); return; }
    msg.textContent = `✔ ${body.full_name} er oprettet. Giv chaufføren e-mail og startadgangskode.`;
    f.reset(); await loadDrivers(); renderDriversList(); renderPanel();
  }

  function renderPricingForm() {
    if (!S.pricing || $('#pricing-fields').children.length) return;
    $('#pricing-fields').innerHTML = PRICING_GROUPS.map(([title, fields]) => `<h3>${esc(title)}</h3><div class="row2">` + fields.map(([k, label, unit, money]) =>
      `<label>${esc(label)} (${esc(unit)})<input name="${k}" type="number" step="${money ? '0.5' : '1'}" min="0"${/^van_large_max_/.test(k) ? '' : ' required'} value="${S.pricing[k] == null ? '' : money ? S.pricing[k] / 100 : S.pricing[k]}"></label>`).join('') + '</div>').join('');
    renderPricingExample();
  }
  function readPricing() {
    const o = {}; for (const [k, , , money] of PRICING_FIELDS) { const raw = $(`#pricing-form [name=${k}]`).value; if (raw === '' && /^van_large_max_/.test(k)) { o[k] = null; continue; } const v = Number(raw); o[k] = money ? Math.round(v * 100) : Math.round(v); } return o;
  }
  function renderPricingExample() {
    const P = window.RFPricing; if (!P) return;
    const p = readPricing(); if (!Object.values(p).every(Number.isFinite)) return;
    const wed = new Date('2026-11-11T09:00:00Z'), sat = new Date('2026-11-14T09:00:00Z');
    const ex = (label, input) => { try { const r = P.computePrice(p, input); return `${label} → <b>${kr(r.exVat)}</b> ekskl. / ${kr(r.total)} inkl. moms`; } catch (e) { return `${label} → ${esc(e.message)}`; } };
    $('#pricing-example').innerHTML = 'Eksempler (hverdag kl. 10 hvis ikke andet står):<br>' + [
      ex('Kassebil 30 km', { vehicle: 'van', km: 30, pickupAt: wed }),
      ex('Liftbil 50 km, 1 ekstra stop', { vehicle: 'lift', km: 50, stops: 1, pickupAt: wed }),
      ex('Kassebil 50 km, lørdag', { vehicle: 'van', km: 50, pickupAt: sat }),
      ex('Liftbil 4 timer + ekstra mand 2 t', { service: 'hourly', vehicle: 'lift', hours: 4, extraManHours: 2, pickupAt: wed }),
      ex('Kassebil 120 km', { vehicle: 'van', km: 120, pickupAt: wed }),
    ].join('<br>');
  }
  async function savePricing(e) {
    e.preventDefault(); const msg = $('#pricing-msg');
    const { error } = await S.sb.from('pricing_settings').update({ ...readPricing(), updated_at: new Date().toISOString() }).eq('id', 1);
    msg.textContent = error ? `Kunne ikke gemme: ${error.message}` : '✔ Gemt. Nye bestillinger bruger de nye priser.';
  }

  // ───────────── Ordre-detalje ─────────────
  async function openDrawer(id, silent) {
    const o = S.orders.find((x) => x.id === id); if (!o) return;
    S.selected = id;
    const [{ data: events }, { data: extras }, { data: inv }] = await Promise.all([S.sb.from('order_events').select('*').eq('order_id', id).order('at'), S.sb.from('order_extras').select('*').eq('order_id', id).order('id'), S.sb.from('invoices').select('*').eq('order_id', id).maybeSingle()]);
    let pod = '';
    if (o.pod_photo_path) {
      const { data } = await S.sb.storage.from('pod').createSignedUrl(o.pod_photo_path, 300);
      if (data?.signedUrl) pod = `<img class="pod" alt="Leveringsfoto" src="${esc(data.signedUrl)}">`;
    }
    const canAssign = ['new', 'assigned'].includes(o.status) && o.payment_status === 'paid';
    const canCancel = !['delivered', 'cancelled'].includes(o.status);
    $('#drawer-body').innerHTML = `
      <h2>${esc(o.ref)} <span class="pill ${esc(o.status)}">${esc(STATUS[o.status])}</span></h2>
      <dl class="kv">
        <dt>Kunde</dt><dd>${esc(custName(o))} (${o.customer_kind === 'business' ? 'erhverv' : 'privat'})<br>${esc(o.customer?.phone || '')}</dd>
        <dt>Afhentning</dt><dd>${esc(o.from_address)}<br>${esc(dt(o.pickup_at))}</dd>
        <dt>Levering</dt><dd>${esc(o.to_address)}</dd>
        <dt>Gods</dt><dd>${esc(o.goods)}<br>${esc(vehLabel(o))} · ${esc(pal(o.pallets))} · ${esc(o.weight_kg)} kg · ${esc(distLabel(o))}</dd>${(o.stops || []).length ? `<dt>Ekstra stop</dt><dd>${o.stops.map((s, n) => `${n + 1}. ${esc(s)}`).join('<br>')}</dd>` : ''}${(o.price_lines || []).length ? `<dt>Pris</dt><dd>${o.price_lines.map((l) => `${esc(l.label)}: ${kr(l.amount)}`).join('<br>')}</dd>` : ''}
        <dt>Pris</dt><dd>${kr(o.price_ex_vat)} + moms ${kr(o.vat)} = <b>${kr(o.price_total)}</b><br>${esc(PAY[o.payment_status] || o.payment_status)}${o.cancel_fee_ex_vat ? ` · gebyr ${kr(o.cancel_fee_ex_vat)} ekskl. moms` : ''}</dd>
        <dt>Chauffør</dt><dd>${esc(driverName(o.driver_id))}</dd>
        ${o.recipient_name ? `<dt>Modtaget af</dt><dd>${esc(o.recipient_name)}</dd>` : ''}
      </dl>
      ${['delivered', 'in_transit', 'loaded', 'assigned'].includes(o.status) || o.cancel_fee_ex_vat ? `<h3 style="margin-top:16px">Tillæg</h3>
        <ul class="timeline">${(extras || []).map((x) => `<li>${esc(EXTRA_KIND[x.kind])}: ${esc(x.description)} – <b>${kr(x.amount_ex_vat)}</b> ${x.vat_applies ? '+ moms' : '(momsfri udlæg)'}</li>`).join('') || '<li class="muted">Ingen tillæg</li>'}</ul>
        ${inv ? '' : `<form id="extra-form"><div class="row2"><label>Type<select name="kind">${Object.entries(EXTRA_KIND).map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join('')}</select></label><label>Beløb ekskl. moms (kr)<input name="amount" type="number" step="0.5" min="1" required></label></div>
        <label>Beskrivelse<input name="description" required minlength="2" maxlength="200" placeholder="Fx ventetid 30 min ved levering"></label>
        <label class="chip" style="margin-bottom:8px"><input type="checkbox" name="vat" checked> Tillæg moms</label><button class="btn small" type="submit">Tilføj tillæg</button></form>`}` : ''}
      ${inv ? `<h3 style="margin-top:16px">Faktura</h3><p>${esc(inv.number)} · ${kr(inv.total)} · ${inv.due > 0 ? `<b>restbeløb ${kr(inv.due)}</b>` : 'intet restbeløb'}</p><button id="d-invoice-view" class="btn small">Vis / print faktura</button>`
        : (o.status === 'delivered' || (o.status === 'cancelled' && o.cancel_fee_ex_vat > 0)) ? '<h3 style="margin-top:16px">Faktura</h3><button id="d-invoice" class="btn primary small">Udsted faktura</button>' : ''}
      ${canAssign ? `<label>${o.driver_id ? 'Skift chauffør' : 'Tildel chauffør'}<select id="d-assign">${driverOptions(o.driver_id)}</select></label>` : ''}
      ${pod}
      <h3 style="margin-top:16px">Historik</h3>
      <ul class="timeline">${(events || []).map((ev) => `<li><b>${esc(STATUS[ev.status])}</b> <span class="muted">${esc(dt(ev.at))}</span>${ev.note ? `<br>${esc(ev.note)}` : ''}</li>`).join('')}</ul>
      ${canCancel ? '<button id="d-cancel" class="btn danger">Annullér ordre…</button>' : ''}`;
    $('#d-assign')?.addEventListener('change', (e) => e.target.value && assign(id, e.target.value));
    $('#d-cancel')?.addEventListener('click', () => cancelOrder(id));
    $('#extra-form')?.addEventListener('submit', (e) => addExtra(id, e));
    $('#d-invoice')?.addEventListener('click', () => issueInvoice(id));
    $('#d-invoice-view')?.addEventListener('click', () => showInvoice(inv));
    $('#drawer').hidden = false;
  }
  function closeDrawer() { $('#drawer').hidden = true; S.selected = null; S.route?.setMap(null); }

  // ───────────── Kort ─────────────
  const DARK = [
    { elementType: 'geometry', stylers: [{ color: '#14171c' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#8c94a3' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#14171c' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a303a' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3a4352' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b0d10' }] },
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  ];

  function loadGoogle() {
    return new Promise((resolve, reject) => {
      if (window.google?.maps) return resolve();
      if (!CFG.GOOGLE_MAPS_BROWSER_KEY) return reject(new Error('Google Maps-nøgle mangler i config.js'));
      window.__rfMapReady = resolve;
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(CFG.GOOGLE_MAPS_BROWSER_KEY)}&callback=__rfMapReady&language=da&region=DK`;
      s.onerror = () => reject(new Error('Google Maps kunne ikke indlæses. Tjek nøglen og at Maps JavaScript API er slået til.'));
      document.head.appendChild(s);
    });
  }
  async function initMap() {
    await loadGoogle();
    S.map = new google.maps.Map($('#map'), { center: { lat: 56.0, lng: 10.4 }, zoom: 7, styles: DARK, mapTypeControl: false, streetViewControl: false, fullscreenControl: true });
    S.traffic = new google.maps.TrafficLayer();
    S.info = new google.maps.InfoWindow();
  }

  const dot = (color, scale = 9) => ({ path: google.maps.SymbolPath.CIRCLE, fillColor: color, fillOpacity: 1, strokeColor: '#fff', strokeWeight: 2, scale });
  function renderMap() { if (!S.map) return; renderDriverMarkers(); renderOrderMarkers(); }

  function renderDriverMarkers() {
    if (!S.map) return;
    const show = $('#t-drivers').checked;
    for (const [id, m] of S.dMarkers) if (!S.positions.has(id) || !show) { m.setMap(null); S.dMarkers.delete(id); }
    if (!show) return;
    for (const [id, p] of S.positions) {
      const pos = { lat: p.lat, lng: p.lon };
      const name = driverName(id);
      let m = S.dMarkers.get(id);
      if (!m) {
        m = new google.maps.Marker({ map: S.map, position: pos, zIndex: 10, icon: dot('#255cff', 12), label: { text: (name[0] || '?').toUpperCase(), color: '#fff', fontWeight: '700' } });
        m.addListener('click', () => { S.info.setContent(`<b>${esc(driverName(id))}</b><br>Position ${esc(ago(S.positions.get(id).updated_at))}`); S.info.open(S.map, m); });
        S.dMarkers.set(id, m);
      } else m.setPosition(pos);
      m.setOpacity(Date.now() - new Date(p.updated_at) > 5 * 60000 ? 0.45 : 1); // gammel position vises svagere
    }
  }

  function renderOrderMarkers() {
    if (!S.map) return;
    S.oMarkers.forEach((m) => m.setMap(null)); S.oMarkers = [];
    if (!$('#t-orders').checked) return;
    for (const o of S.orders.filter((x) => x.status === 'new' || ACTIVE.includes(x.status))) {
      const mk = (lat, lon, color, title) => { const m = new google.maps.Marker({ map: S.map, position: { lat, lng: lon }, icon: dot(color, 7), title }); m.addListener('click', () => openDrawer(o.id)); S.oMarkers.push(m); };
      if (o.status !== 'loaded' && o.status !== 'in_transit') mk(o.from_lat, o.from_lon, '#2fcf7a', `${o.ref} afhentning`);
      mk(o.to_lat, o.to_lon, '#ff5a5f', `${o.ref} levering`);
    }
  }

  function focusOrder(id) {
    const o = S.orders.find((x) => x.id === id); if (!o || !S.map) return;
    const b = new google.maps.LatLngBounds(); b.extend({ lat: o.from_lat, lng: o.from_lon }); b.extend({ lat: o.to_lat, lng: o.to_lon });
    S.map.fitBounds(b, 80);
    S.route?.setMap(null);
    new google.maps.DirectionsService().route({ origin: { lat: o.from_lat, lng: o.from_lon }, destination: { lat: o.to_lat, lng: o.to_lon }, travelMode: 'DRIVING' }, (res, st) => {
      if (st === 'OK') { S.route = new google.maps.DirectionsRenderer({ map: S.map, directions: res, suppressMarkers: true, preserveViewport: true, polylineOptions: { strokeColor: '#255cff', strokeWeight: 5 } }); }
    });
  }
})();
