/* RoadForce driftscenter – Regnskab, underleverandører, kvalitet og support. Ren browser-JS. */
(() => {
  const A = window.RFApp; if (!A) return;
  const { S, esc, kr, $, $$ } = A;
  const sb = () => S.sb;
  const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : 0).toLocaleString('da-DK') + ' %';
  const d10 = (iso) => new Date(iso).toLocaleDateString('sv-SE'); // yyyy-mm-dd lokal
  const dk = (iso) => (iso ? new Date(iso).toLocaleDateString('da-DK') : '–');
  const dt2 = (iso) => new Date(iso).toLocaleString('da-DK', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const num = (ore) => (ore / 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const STATUS = { assigned: 'Tildelt', loaded: 'Afhentet', in_transit: 'Undervejs', delivered: 'Leveret' };
  const PAYS = { unpaid: 'Ubetalt', paid: 'Betalt', refunded: 'Refunderet', partially_refunded: 'Delvist refunderet', failed: 'Fejlet' };
  const SETT = { draft: 'Afventer godkendelse', approved: 'Godkendt', paid: 'Betalt' };
  const SUBST = { pending: 'Afventer', active: 'Aktiv', paused: 'Sat på pause', ended: 'Ophørt' };
  const ACTIVE = ['assigned', 'loaded', 'in_transit'];
  const err = (e) => (e && (e.message || e.error_description)) || 'Fejl';

  // ───── hjælpere ─────
  function csv(name, head, rows) {
    const q = (v) => { v = v == null ? '' : String(v); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    const body = [head, ...rows].map((r) => r.map(q).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500);
  }
  function ask(title, fields, okText = 'Gem') {
    return new Promise((res) => {
      const w = document.createElement('div'); w.className = 'modal';
      w.innerHTML = `<form class="card modal-card"><h3>${esc(title)}</h3>${fields.map((f) => f.type === 'select'
        ? `<label>${esc(f.label)}<select name="${f.k}">${f.options.map(([v, t]) => `<option value="${esc(v)}" ${v === f.value ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>`
        : f.type === 'textarea' ? `<label>${esc(f.label)}<textarea name="${f.k}" rows="3" required minlength="3">${esc(f.value || '')}</textarea></label>`
        : `<label>${esc(f.label)}<input name="${f.k}" type="${f.type || 'text'}" required value="${esc(f.value ?? '')}" ${f.step ? `step="${f.step}"` : ''}></label>`).join('')}
        <div class="row"><button class="btn primary" type="submit">${esc(okText)}</button><button class="btn ghost" type="button" data-x>Annullér</button></div></form>`;
      document.body.appendChild(w);
      const done = (v) => { w.remove(); res(v); };
      w.querySelector('[data-x]').onclick = () => done(null);
      w.querySelector('form').onsubmit = (e) => { e.preventDefault(); done(Object.fromEntries(new FormData(e.target))); };
    });
  }
  const tile = (id, label, value, sub, cls = '') => `<button class="tile ${cls}" data-tile="${id}"><span>${esc(label)}</span><b>${value}</b><small>${sub || ''}</small></button>`;
  const table = (heads, rows) => `<div class="table-wrap"><table><thead><tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${heads.length}" class="muted">Ingen data i den valgte periode.</td></tr>`}</tbody></table></div>`;

  // ───── periode ─────
  function range(kind, fromV, toV) {
    const n = new Date(); const iso = (d) => d.toLocaleDateString('sv-SE');
    if (kind === 'day') return [iso(n), iso(n)];
    if (kind === 'week') { const d = new Date(n); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); const e = new Date(d); e.setDate(e.getDate() + 6); return [iso(d), iso(e)]; }
    if (kind === 'month') return [iso(new Date(n.getFullYear(), n.getMonth(), 1)), iso(new Date(n.getFullYear(), n.getMonth() + 1, 0))];
    if (kind === 'year') return [`${n.getFullYear()}-01-01`, `${n.getFullYear()}-12-31`];
    return [fromV || '1970-01-01', toV || '2999-12-31'];
  }
  const periodBar = (P) => `<div class="filters">
      ${[['day', 'I dag'], ['week', 'Denne uge'], ['month', 'Denne måned'], ['year', 'I år'], ['custom', 'Vælg periode']].map(([k, t]) => `<button class="chip-btn ${P.kind === k ? 'on' : ''}" data-p="${k}">${t}</button>`).join('')}
      <input type="date" data-from value="${P.from}"><input type="date" data-to value="${P.to}"></div>`;
  function wirePeriod(root, P, rerender) {
    $$('[data-p]', root).forEach((b) => b.onclick = () => { P.kind = b.dataset.p; if (P.kind !== 'custom') [P.from, P.to] = range(P.kind); rerender(); });
    const f = $('[data-from]', root), t = $('[data-to]', root);
    f.onchange = () => { P.kind = 'custom'; P.from = f.value; rerender(); }; t.onchange = () => { P.kind = 'custom'; P.to = t.value; rerender(); };
  }

  // ═════════════ Road Force Regnskab ═════════════
  const R = { rows: null, P: { kind: 'month', from: '', to: '' }, f: { cust: '', sub: '', drv: '', status: '', pay: '', test: false }, tile: '' };
  [R.P.from, R.P.to] = range('month');
  const rfOf = (r) => r.rf_share + r.adj_rf, subOf = (r) => r.sub_share + r.adj_sub, revOf = (r) => r.basis_ex_vat + r.adj_rf + r.adj_sub;
  const dateOf = (r) => d10(r.pickup_at || r.created_at);

  async function loadFinance() {
    const { data, error } = await sb().rpc('admin_trip_finance', { p_include_test: R.f.test });
    if (error) { $('#rg-body').innerHTML = `<p class="error">${esc(err(error))}</p>`; return false; }
    R.rows = data; return true;
  }
  const tileTest = (t, r) => ({ expected: ACTIVE.includes(r.status), earned: r.status === 'delivered', received: r.received_gross > 0, sub: r.executed_by === 'subcontractor', own: r.executed_by === 'own',
    credit: r.refund_ex_vat > 0 || r.adj_count > 0, expenses: r.expenses_sub + r.expenses_rf > 0 }[t] ?? true);
  function filtered(withTile) {
    return R.rows.filter((r) => { const d = dateOf(r);
      if (d < R.P.from || d > R.P.to) return false;
      const f = R.f;
      if (f.cust && r.customer_id !== f.cust) return false;
      if (f.sub === 'own' ? r.executed_by !== 'own' : f.sub && r.subcontractor_id !== f.sub) return false;
      if (f.drv && r.driver_id !== f.drv) return false;
      if (f.status && r.status !== f.status) return false;
      if (f.pay && r.payment_status !== f.pay) return false;
      if (withTile && R.tile) return tileTest(R.tile, r);
      return true; });
  }

  function donut(parts) {
    const tot = parts.reduce((a, p) => a + Math.max(0, p.v), 0);
    if (!tot) return '<p class="muted">Ingen tal at vise.</p>';
    let a0 = -Math.PI / 2; const R0 = 70, r0 = 42, cx = 90, cy = 90;
    const P = (a, r) => `${cx + r * Math.cos(a)} ${cy + r * Math.sin(a)}`;
    const paths = parts.filter((p) => p.v > 0).map((p) => {
      const full = p.v === tot; const a1 = a0 + (full ? Math.PI * 2 - 0.001 : (p.v / tot) * Math.PI * 2); const big = a1 - a0 > Math.PI ? 1 : 0;
      const d = `M ${P(a0, R0)} A ${R0} ${R0} 0 ${big} 1 ${P(a1, R0)} L ${P(a1, r0)} A ${r0} ${r0} 0 ${big} 0 ${P(a0, r0)} Z`; a0 = a1; return `<path d="${d}" fill="${p.c}"/>`; }).join('');
    return `<div class="donut"><svg viewBox="0 0 180 180" width="180" height="180">${paths}</svg><ul>${parts.map((p) => `<li><i style="background:${p.c}"></i>${esc(p.t)}<b>${kr(p.v)}</b><small>${pct(p.v, tot)}</small></li>`).join('')}</ul></div>`;
  }
  function bars(rows) {
    const m = new Map(); rows.forEach((r) => m.set(dateOf(r), (m.get(dateOf(r)) || 0) + rfOf(r)));
    const days = [...m.entries()].sort(); if (!days.length) return '<p class="muted">Ingen tal at vise.</p>';
    const max = Math.max(...days.map((d) => d[1]), 1), w = Math.max(30, Math.min(60, 640 / days.length)), H = 150;
    return `<div class="bars"><svg viewBox="0 0 ${days.length * w + 20} ${H + 40}" width="${days.length * w + 20}" height="${H + 40}">${days.map(([d, v], i) => { const h = Math.max(2, (v / max) * H); const x = 10 + i * w;
      return `<g><rect x="${x}" y="${H - h + 10}" width="${w - 6}" height="${h}" rx="3" fill="#2fcf7a"><title>${d}: ${kr(v)}</title></rect><text x="${x + (w - 6) / 2}" y="${H + 26}" font-size="9" fill="#8c94a3" text-anchor="middle">${d.slice(8)}/${d.slice(5, 7)}</text><text x="${x + (w - 6) / 2}" y="${H - h + 6}" font-size="8" fill="#f5f5f2" text-anchor="middle">${Math.round(v / 100)}</text></g>`; }).join('')}</svg></div>`;
  }

  async function renderRegnskab() {
    const root = $('#rg-body'); if (!R.rows && !(await loadFinance())) return;
    const all = filtered(false), rows = filtered(true);
    const uniq = (k, n) => [...new Map(R.rows.filter((r) => r[k]).map((r) => [r[k], r[n]])).entries()];
    const sum = (a, f) => a.reduce((s, r) => s + f(r), 0);
    const sbRows = all.filter((r) => r.executed_by === 'subcontractor'), ownRows = all.filter((r) => r.executed_by === 'own');
    const exp = all.filter((r) => ACTIVE.includes(r.status)), earn = all.filter((r) => r.status === 'delivered');
    const K = { rev: sum(all, revOf), rf: sum(all, rfOf), sub: sum(all, subOf), expected: sum(exp, rfOf), earned: sum(earn, rfOf), received: sum(all, (r) => r.received_gross),
      vat: sum(all, (r) => r.vat_amount), expS: sum(all, (r) => r.expenses_sub), expR: sum(all, (r) => r.expenses_rf), refunds: sum(all, (r) => r.refund_ex_vat), adj: sum(all, (r) => r.adj_sub + r.adj_rf),
      rfSub: sum(sbRows, rfOf), own: sum(ownRows, rfOf) };
    const opt = (list, v) => `<option value="">Alle</option>` + list.map(([id, n]) => `<option value="${esc(id)}" ${id === v ? 'selected' : ''}>${esc(n)}</option>`).join('');
    root.innerHTML = `
      <p class="notice"><b>Road Forces andel er indtjening før egne omkostninger</b> – ikke overskud. Beløb er ekskl. moms, medmindre andet står. Fordelingen bruger den procent, der er gemt på hver tur/afregning (standard 80 % til underleverandør / 20 % til Road Force). Egne ture har ingen fordeling: hele transportindtægten tilhører Road Force.</p>
      ${periodBar(R.P)}
      <div class="filters">
        <label>Kunde<select data-f="cust">${opt(uniq('customer_id', 'customer_name'), R.f.cust)}</select></label>
        <label>Underleverandør<select data-f="sub"><option value="">Alle</option><option value="own" ${R.f.sub === 'own' ? 'selected' : ''}>Egne ture</option>${uniq('subcontractor_id', 'subcontractor_name').map(([id, n]) => `<option value="${esc(id)}" ${id === R.f.sub ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label>Chauffør<select data-f="drv">${opt(uniq('driver_id', 'driver_name'), R.f.drv)}</select></label>
        <label>Turstatus<select data-f="status"><option value="">Alle</option>${Object.entries(STATUS).map(([k, v]) => `<option value="${k}" ${k === R.f.status ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label>Betaling<select data-f="pay"><option value="">Alle</option>${Object.entries(PAYS).map(([k, v]) => `<option value="${k}" ${k === R.f.pay ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" data-f="test" ${R.f.test ? 'checked' : ''}> Vis testordrer</label>
        <button class="btn small" id="rg-csv">⬇ Eksportér CSV</button>
      </div>
      <div class="tiles">
        ${tile('', 'Samlet omsætning', kr(K.rev), `${all.length} ture · moms ${kr(K.vat)} særskilt`)}
        ${tile('', 'Road Forces andel (før omkostninger)', kr(K.rf), `${pct(K.rf, K.rev)} af omsætningen`, 'good')}
        ${tile('sub', 'Underleverandørernes andel', kr(K.sub), `${pct(K.sub, K.rev)} af omsætningen`)}
        ${tile('expected', 'Forventet indtjening (tildelte ture)', kr(K.expected), `${exp.length} ture endnu ikke leveret`)}
        ${tile('earned', 'Optjent indtjening (leverede ture)', kr(K.earned), `${earn.length} gennemførte ture`, 'good')}
        ${tile('received', 'Modtaget fra kunder (inkl. moms)', kr(K.received), 'betalinger registreret via Stripe')}
        ${tile('earned', 'Gns. indtjening pr. gennemført tur', kr(earn.length ? Math.round(K.earned / earn.length) : 0), 'Road Forces andel')}
        ${tile('own', 'Egne ture (hele indtægten)', kr(K.own), `${ownRows.length} ture – ikke overskud`)}
        ${tile('sub', 'Andel fra underleverandørture', kr(K.rfSub), `${sbRows.length} ture`)}
        ${tile('expenses', 'Udlæg (bro/færge/parkering)', kr(K.expS + K.expR), `underlev. ${kr(K.expS)} · Road Force ${kr(K.expR)} – uden for fordelingen`)}
        ${tile('credit', 'Kreditnotaer og refusioner', kr(K.refunds), 'ekskl. moms, trukket fra omsætningen')}
        ${tile('credit', 'Reguleringer', kr(K.adj), 'efter godkendelse, med begrundelse')}
      </div>
      ${R.tile ? `<p class="muted">Viser kun ture for det valgte tal. <button class="btn small ghost" id="rg-clear">Vis alle ture</button></p>` : '<p class="muted">Klik på et tal for at se de tilhørende ture.</p>'}
      <div class="cols2">
        <div class="card"><h3>Fordeling i perioden</h3>${donut([{ t: 'Road Force (underleverandørture)', v: K.rfSub, c: '#2fcf7a' }, { t: 'Underleverandører', v: K.sub, c: '#255cff' }, { t: 'Road Force – egne ture', v: K.own, c: '#f5a524' }])}</div>
        <div class="card"><h3>Road Forces indtjening pr. dag (kr)</h3>${bars(all)}</div>
      </div>
      <h3 class="sec">Ture (${rows.length})</h3>
      ${table(['Tur-ID', 'Dato', 'Kunde', 'Underleverandør', 'Chauffør', 'Salgspris ekskl. moms', 'Underlev. andel', 'Road Force andel', 'Status', 'Betaling', 'Afregning'],
        rows.map((r) => `<tr><td><b>${esc(r.ref)}</b>${r.is_test ? ' <span class="tag">TEST</span>' : ''}</td><td>${dk(r.pickup_at || r.created_at)}</td><td>${esc(r.customer_name || '–')}</td><td>${r.executed_by === 'own' ? '<span class="tag">Egen tur</span>' : esc(r.subcontractor_name || '–')}</td><td>${esc(r.driver_name || '–')}</td>
          <td class="r">${kr(revOf(r))}${r.extras_pending_ex_vat ? `<small class="warn">+${kr(r.extras_pending_ex_vat)} afventer</small>` : ''}</td>
          <td class="r">${r.executed_by === 'own' ? '–' : `${kr(subOf(r))}<small>${r.sub_percent} %</small>`}</td>
          <td class="r"><b>${kr(rfOf(r))}</b><small>${pct(rfOf(r), revOf(r))}</small></td><td>${STATUS[r.status] || r.status}</td><td>${PAYS[r.payment_status] || r.payment_status}</td><td>${r.executed_by === 'own' ? '–' : esc(SETT[r.settlement_status] || 'Ikke oprettet endnu')}</td></tr>`))}`;
    $$('[data-f]', root).forEach((el) => el.onchange = () => { const k = el.dataset.f; if (k === 'test') { R.f.test = el.checked; R.rows = null; } else R.f[k] = el.value; renderRegnskab(); });
    $$('[data-tile]', root).forEach((b) => b.onclick = () => { const t = b.dataset.tile; R.tile = R.tile === t ? '' : t; renderRegnskab(); });
    wirePeriod(root, R.P, renderRegnskab);
    const c = $('#rg-clear', root); if (c) c.onclick = () => { R.tile = ''; renderRegnskab(); };
    $('#rg-csv', root).onclick = () => csv(`roadforce-regnskab_${R.P.from}_${R.P.to}.csv`,
      ['Tur-ID', 'Dato', 'Kunde', 'Udført af', 'Underleverandør', 'Chauffør', 'Status', 'Betaling', 'Transport ekskl. moms', 'Tillæg ekskl. moms', 'Refusion ekskl. moms', 'Salgspris/grundlag ekskl. moms', 'Moms', 'Underlev. %', 'Underlev. andel', 'Road Force andel (før omkostninger)', 'Udlæg underlev.', 'Udlæg Road Force', 'Regulering underlev.', 'Regulering Road Force', 'Afregning', 'Betalt dato', 'Reference', 'Modtaget inkl. moms', 'Test'],
      rows.map((r) => [r.ref, dk(r.pickup_at || r.created_at), r.customer_name, r.executed_by === 'own' ? 'Egen tur' : 'Underleverandør', r.subcontractor_name || '', r.driver_name || '', STATUS[r.status] || r.status, PAYS[r.payment_status] || r.payment_status,
        num(r.transport_ex_vat), num(r.extras_ex_vat), num(r.refund_ex_vat), num(r.basis_ex_vat), num(r.vat_amount), r.sub_percent ?? '', num(r.sub_share), num(r.rf_share), num(r.expenses_sub), num(r.expenses_rf), num(r.adj_sub), num(r.adj_rf), SETT[r.settlement_status] || '', r.paid_at || '', r.payment_reference || '', num(r.received_gross), r.is_test ? 'ja' : '']));
  }

  // ═════════════ Underleverandører og afregning ═════════════
  const U = { subs: [], drivers: [], P: { kind: 'month', from: '', to: '' }, sel: '', rows: null, test: true };
  [U.P.from, U.P.to] = range('month');
  async function renderSubs() {
    const root = $('#sub-body');
    const [{ data: subs, error }, { data: drivers }] = await Promise.all([sb().from('subcontractors').select('*').order('name'), sb().from('profiles').select('id,full_name,subcontractor_id,active').eq('role', 'driver')]);
    if (error) { root.innerHTML = `<p class="error">${esc(err(error))}</p>`; return; }
    U.subs = subs; U.drivers = drivers || [];
    const { data: fin } = await sb().rpc('admin_trip_finance', { p_include_test: U.test }); U.rows = (fin || []).filter((r) => r.executed_by === 'subcontractor');
    const rows = U.rows.filter((r) => { const d = dateOf(r); return d >= U.P.from && d <= U.P.to && (!U.sel || r.subcontractor_id === U.sel); });
    const body = rows.map((r) => `<tr><td>${r.settlement_status === 'draft' ? `<input type="checkbox" data-ap="${r.settlement_id}">` : ''}</td><td><b>${esc(r.ref)}</b>${r.is_test ? ' <span class="tag">TEST</span>' : ''}</td><td>${dk(r.pickup_at || r.created_at)}</td><td>${esc(r.subcontractor_name)}</td><td>${esc(r.driver_name || '–')}</td>
      <td class="r">${kr(r.basis_ex_vat)}</td><td class="r">${kr(r.sub_share)}<small>${r.sub_percent} %</small></td><td class="r">${kr(r.rf_share)}</td><td class="r">${kr(r.expenses_sub + r.expenses_rf)}<small>underlev. ${kr(r.expenses_sub)} · RF ${kr(r.expenses_rf)}</small></td>
      <td class="r">${r.adj_count ? `${kr(r.adj_sub + r.adj_rf)}<small>${r.adj_count} reg.</small>` : '–'}</td><td>${r.settlement_id ? esc(SETT[r.settlement_status]) : '<span class="muted">Oprettes ved levering</span>'}${r.paid_at ? `<small>${dk(r.paid_at)} · ${esc(r.payment_reference)}</small>` : ''}</td>
      <td class="acts">${r.settlement_status === 'draft' ? `<button class="btn small ghost" data-recalc="${r.order_id}">Genberegn</button>` : ''}${r.settlement_status === 'approved' ? `<button class="btn small" data-pay="${r.settlement_id}">Marker betalt</button>` : ''}${r.settlement_id && r.settlement_status !== 'draft' ? `<button class="btn small ghost" data-adj="${r.order_id}">Regulér</button>` : ''}</td></tr>`);
    const per = U.subs.map((s) => { const rr = rows.filter((r) => r.subcontractor_id === s.id); const sm = (f) => rr.reduce((a, r) => a + f(r), 0); const by = (st) => rr.filter((r) => r.settlement_status === st).reduce((a, r) => a + r.sub_share + r.adj_sub, 0);
      return `<tr><td><b>${esc(s.name)}</b></td><td>${rr.length}</td><td class="r">${kr(sm((r) => r.basis_ex_vat))}</td><td class="r">${kr(sm((r) => r.sub_share))}</td><td class="r">${kr(sm((r) => r.rf_share))}</td><td class="r">${kr(sm((r) => r.expenses_sub + r.expenses_rf))}</td><td class="r">${kr(sm((r) => r.adj_sub + r.adj_rf))}</td><td class="r">${kr(by('draft'))}</td><td class="r">${kr(by('approved'))}</td><td class="r">${kr(by('paid'))}</td></tr>`; });
    root.innerHTML = `
      <div class="cols2">
        <div class="card"><h3>Firmaer</h3>${U.subs.map((s) => { const n = U.drivers.filter((d) => d.subcontractor_id === s.id).length; return `<div class="item click" data-edit="${s.id}"><b>${esc(s.name)}</b> <span class="tag">${SUBST[s.status]}</span> ${s.rates_confirmed ? '' : '<span class="tag warnt">Afregningssats: uafklaret</span>'}<small>CVR ${esc(s.cvr || '–')} ${s.cvr_verified ? '✔ kontrolleret' : '(ikke kontrolleret)'} · ${n} chauffør(er) · ${s.subcontractor_percent} % / ${100 - s.subcontractor_percent} %</small></div>`; }).join('') || '<p class="muted">Ingen underleverandører endnu.</p>'}
          <button class="btn primary small" id="sub-new">+ Ny underleverandør</button></div>
        <div class="card"><h3>Tilknyt chauffører</h3><p class="muted">En chauffør uden firma er egen chauffør (ingen 80/20). Ændringen gælder nye tildelinger – tidligere ture beholder deres gemte fordeling.</p>
          ${U.drivers.map((d) => `<div class="item row"><span>${esc(d.full_name)}</span><select data-drv="${d.id}"><option value="">Egen chauffør</option>${U.subs.map((s) => `<option value="${s.id}" ${s.id === d.subcontractor_id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`).join('')}</div>
      </div>
      <div id="sub-edit"></div>
      <h3 class="sec">Indtjening og afregning pr. firma</h3>
      ${periodBar(U.P)}
      <div class="filters"><label>Firma<select id="u-sub"><option value="">Alle</option>${U.subs.map((s) => `<option value="${s.id}" ${s.id === U.sel ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
        <label class="chk"><input type="checkbox" id="u-test" ${U.test ? 'checked' : ''}> Vis testordrer</label>
        <button class="btn small" id="u-approve">Godkend markerede</button><button class="btn small" id="u-csv">⬇ Eksportér CSV</button></div>
      ${table(['Firma', 'Ture', 'Betaling fra kunde ekskl. moms', 'Underlev. andel', 'Road Force andel', 'Udlæg', 'Reguleringer', 'Afventer godkendelse', 'Godkendt', 'Betalt'], per)}
      <h3 class="sec">Afregninger (${rows.length})</h3><p class="muted">Afregning er manuel: godkend, betal selv via banken og registrér dato og reference. Intet udbetales automatisk. Godkendte afregninger er låst – senere ændringer sker som regulering med begrundelse.</p>
      ${table(['', 'Tur', 'Dato', 'Firma', 'Chauffør', 'Grundlag ekskl. moms', 'Underlev. andel', 'Road Force andel', 'Udlæg (separat)', 'Reguleringer', 'Afregning', ''], body)}`;
    wirePeriod(root, U.P, renderSubs);
    $('#u-sub', root).onchange = (e) => { U.sel = e.target.value; renderSubs(); };
    $('#u-test', root).onchange = (e) => { U.test = e.target.checked; renderSubs(); };
    $('#sub-new', root).onclick = () => editSub({});
    $$('[data-edit]', root).forEach((el) => el.onclick = () => editSub(U.subs.find((s) => s.id === el.dataset.edit)));
    $$('[data-drv]', root).forEach((el) => el.onchange = async () => { const { error: e } = await sb().rpc('admin_set_driver_company', { p_driver: el.dataset.drv, p_sub: el.value || null }); if (e) alert(err(e)); renderSubs(); });
    $$('[data-recalc]', root).forEach((b) => b.onclick = async () => { const { error: e } = await sb().rpc('admin_recalc_settlement', { p_order: b.dataset.recalc }); if (e) alert(err(e)); renderSubs(); });
    $$('[data-pay]', root).forEach((b) => b.onclick = async () => { const v = await ask('Registrér betaling til underleverandør', [{ k: 'd', label: 'Betalingsdato', type: 'date', value: new Date().toLocaleDateString('sv-SE') }, { k: 'r', label: 'Reference (bankoverførsel/bilag)' }], 'Marker betalt'); if (!v) return;
      const { error: e } = await sb().rpc('admin_mark_settlement_paid', { p_id: b.dataset.pay, p_paid_at: v.d, p_reference: v.r }); if (e) alert(err(e)); renderSubs(); });
    $$('[data-adj]', root).forEach((b) => b.onclick = async () => { const v = await ask('Regulering af godkendt afregning', [{ k: 'a', label: 'Ændring i grundlag ekskl. moms (kr, negativ = kreditering)', type: 'number', step: '0.01' }, { k: 'r', label: 'Begrundelse (påkrævet)', type: 'textarea' }], 'Registrér regulering'); if (!v) return;
      const { error: e } = await sb().rpc('admin_adjust_settlement', { p_order: b.dataset.adj, p_delta_ex_vat: Math.round(parseFloat(v.a) * 100), p_reason: v.r }); if (e) alert(err(e)); renderSubs(); });
    $('#u-approve', root).onclick = async () => { const ids = $$('[data-ap]:checked', root).map((c) => c.dataset.ap); if (!ids.length) return alert('Markér mindst én afregning.');
      if (!confirm(`Godkend ${ids.length} afregning(er)? De låses derefter.`)) return; const { error: e } = await sb().rpc('admin_approve_settlements', { p_ids: ids }); if (e) alert(err(e)); renderSubs(); };
    $('#u-csv', root).onclick = () => csv(`underleverandoer-afregning_${U.P.from}_${U.P.to}.csv`, ['Tur', 'Dato', 'Firma', 'Chauffør', 'Grundlag ekskl. moms', 'Underlev. %', 'Underlev. andel', 'Road Force andel', 'Udlæg underlev.', 'Udlæg Road Force', 'Regulering underlev.', 'Regulering Road Force', 'Afregning', 'Betalt dato', 'Reference'],
      rows.map((r) => [r.ref, dk(r.pickup_at || r.created_at), r.subcontractor_name, r.driver_name || '', num(r.basis_ex_vat), r.sub_percent, num(r.sub_share), num(r.rf_share), num(r.expenses_sub), num(r.expenses_rf), num(r.adj_sub), num(r.adj_rf), SETT[r.settlement_status] || '', r.paid_at || '', r.payment_reference || '']));
  }
  function editSub(s) {
    const box = $('#sub-edit'); const isNew = !s.id;
    box.innerHTML = `<form class="card" id="sub-form"><h3>${isNew ? 'Ny underleverandør' : 'Rediger ' + esc(s.name)}</h3>
      <div class="grid3"><label>Firmanavn<input name="name" required minlength="2" value="${esc(s.name || '')}"></label><label>CVR (8 cifre)<input name="cvr" pattern="[0-9]{8}" value="${esc(s.cvr || '')}"></label>
      <label>Status<select name="status">${Object.entries(SUBST).map(([k, v]) => `<option value="${k}" ${k === (s.status || 'pending') ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Adresse<input name="address" value="${esc(s.address || '')}"></label><label>Kontaktperson<input name="contact_name" value="${esc(s.contact_name || '')}"></label><label>Telefon<input name="phone" value="${esc(s.phone || '')}"></label>
      <label>E-mail<input name="email" type="email" value="${esc(s.email || '')}"></label><label>Betalingsbetingelser<input name="payment_terms" value="${esc(s.payment_terms || '')}" placeholder="fx 14 dage efter godkendelse"></label>
      <label>Underleverandørens andel (%)<input name="subcontractor_percent" type="number" min="0" max="100" value="${s.subcontractor_percent ?? 80}"></label></div>
      <label>Aftale / noter<textarea name="agreement_note" rows="2">${esc(s.agreement_note || '')}</textarea></label>
      <label class="chk"><input type="checkbox" name="rates_confirmed" ${s.rates_confirmed ? 'checked' : ''}> Afregningssats er aftalt og bekræftet med firmaet (ellers vises “uafklaret”)</label>
      <label class="chk"><input type="checkbox" name="cvr_verified" ${s.cvr_verified ? 'checked' : ''}> CVR er kontrolleret (fx i CVR-registret) – kontrolleres ikke automatisk</label>
      <div class="row"><button class="btn primary" type="submit">Gem</button><button class="btn ghost" type="button" id="sub-cancel">Luk</button><span id="sub-msg" class="muted"></span></div></form>`;
    $('#sub-cancel', box).onclick = () => (box.innerHTML = '');
    $('#sub-form', box).onsubmit = async (e) => { e.preventDefault(); const f = new FormData(e.target); const row = Object.fromEntries(f);
      row.rates_confirmed = f.has('rates_confirmed'); row.cvr_verified = f.has('cvr_verified'); row.subcontractor_percent = parseInt(row.subcontractor_percent, 10); row.cvr = row.cvr || null; row.updated_at = new Date().toISOString();
      if (row.cvr_verified && !s.cvr_verified) row.cvr_checked_at = new Date().toISOString();
      const q = isNew ? sb().from('subcontractors').insert(row) : sb().from('subcontractors').update(row).eq('id', s.id);
      const { error: er } = await q; if (er) { $('#sub-msg', box).textContent = err(er); return; } box.innerHTML = ''; renderSubs(); };
    box.scrollIntoView({ behavior: 'smooth' });
  }

  // ═════════════ Kvalitet: anmeldelser, klager, strikes ═════════════
  function jsonTable(data) {
    if (!data || !data.length) return '<p class="muted">Ingen data endnu.</p>';
    const keys = Object.keys(data[0]); return table(keys.map(esc), data.map((r) => `<tr>${keys.map((k) => `<td>${esc(r[k] ?? '')}</td>`).join('')}</tr>`));
  }
  async function renderQuality() {
    const root = $('#q-body');
    const [rt, cp, st, ss, ql, dr] = await Promise.all([sb().from('ratings').select('*').order('created_at', { ascending: false }).limit(100), sb().from('complaints').select('*').order('created_at', { ascending: false }),
      sb().from('strikes').select('*').order('issued_at', { ascending: false }), sb().from('strike_settings').select('*').limit(1), sb().rpc('admin_driver_quality'), sb().from('profiles').select('id,full_name,subcontractor_id').eq('role', 'driver')]);
    const dn = (id) => (dr.data || []).find((d) => d.id === id)?.full_name || '–';
    const ordRef = (id) => S.orders.find((o) => o.id === id)?.ref || String(id || '').slice(0, 8);
    const CST = { open: 'Åben', reviewing: 'Under behandling', justified: 'Berettiget', unfounded: 'Ubegrundet', closed: 'Lukket' };
    const set = ss.data?.[0];
    root.innerHTML = `
      <p class="notice">Ingen automatiske strikes eller opsigelser. En strike kræver en berettiget klage, chaufførens svar, en begrundelse og dokumentation – og kan tilbagekaldes. Chaufføren kan se og svare på sagen.</p>
      <div class="card narrow"><h3>Udløb af strikes</h3><p class="muted">${set?.expiry_months ? `Strikes udløber efter ${set.expiry_months} måneder.` : 'Udløbsregel er <b>ikke fastsat</b> – strikes udløber ikke, før I har besluttet en regel.'}</p>
        <div class="row"><input id="q-exp" type="number" min="1" max="120" placeholder="Måneder (tom = ingen udløb)" value="${set?.expiry_months ?? ''}"><button class="btn small" id="q-exp-save">Gem</button></div></div>
      <h3 class="sec">Kvalitet pr. chauffør</h3>${ql.error ? `<p class="error">${esc(err(ql.error))}</p>` : jsonTable(ql.data)}
      <h3 class="sec">Klagesager (${cp.data?.length || 0})</h3>
      ${table(['Dato', 'Tur', 'Chauffør', 'Kilde', 'Sammendrag', 'Chaufførens svar', 'Status', ''], (cp.data || []).map((c) => `<tr><td>${dk(c.created_at)}</td><td>${esc(ordRef(c.order_id))}</td><td>${esc(dn(c.driver_id))}</td><td>${esc(c.source)}</td><td>${esc(c.summary || '')}</td><td>${c.driver_response ? esc(c.driver_response) : '<span class="muted">Intet svar endnu</span>'}</td><td>${CST[c.status]}${c.admin_decision ? `<small>${esc(c.admin_decision)}</small>` : ''}</td>
        <td class="acts">${['open', 'reviewing'].includes(c.status) ? `<button class="btn small ghost" data-cp="${c.id}" data-st="reviewing">Under behandling</button><button class="btn small" data-cp="${c.id}" data-st="justified">Berettiget</button><button class="btn small ghost" data-cp="${c.id}" data-st="unfounded">Ubegrundet</button>` : ''}${c.status === 'justified' && !(st.data || []).some((s) => s.complaint_id === c.id) ? `<button class="btn small danger" data-strike="${c.id}" data-drv="${c.driver_id}">Udsted strike…</button>` : ''}${['justified', 'unfounded'].includes(c.status) ? `<button class="btn small ghost" data-cp="${c.id}" data-st="closed">Luk</button>` : ''}</td></tr>`))}
      <h3 class="sec">Strikes (${st.data?.length || 0})</h3>
      ${table(['Udstedt', 'Chauffør', 'Begrundelse', 'Dokumentation', 'Ansættelsesform', 'Udløber', 'Status', ''], (st.data || []).map((s) => `<tr><td>${dk(s.issued_at)}</td><td>${esc(dn(s.driver_id))}</td><td>${esc(s.reason)}</td><td>${esc(s.documentation || '')}</td><td>${s.employment_type === 'employee' ? 'Ansat' : 'Underleverandør'}</td><td>${s.expires_at ? dk(s.expires_at) : 'ikke fastsat'}</td><td>${s.revoked_at ? `Tilbagekaldt<small>${esc(s.revoke_reason || '')}</small>` : 'Aktiv'}</td><td>${s.revoked_at ? '' : `<button class="btn small ghost" data-rv="${s.id}">Tilbagekald</button>`}</td></tr>`))}
      <h3 class="sec">Kundebedømmelser (seneste 100)</h3>
      ${table(['Dato', 'Tur', 'Chauffør', 'Stjerner', 'Kommentar'], (rt.data || []).map((r) => `<tr><td>${dk(r.created_at)}</td><td>${esc(ordRef(r.order_id))}</td><td>${esc(dn(r.driver_id))}</td><td>${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</td><td>${esc(r.comment || '')}</td></tr>`))}`;
    $('#q-exp-save', root).onclick = async () => { const v = $('#q-exp', root).value; const { error } = await sb().from('strike_settings').update({ expiry_months: v ? parseInt(v, 10) : null, updated_at: new Date().toISOString() }).eq('id', set.id); if (error) alert(err(error)); renderQuality(); };
    $$('[data-cp]', root).forEach((b) => b.onclick = async () => { const v = await ask('Afgørelse', [{ k: 'd', label: 'Begrundelse / note', type: 'textarea' }]); if (!v) return; const { error } = await sb().rpc('admin_resolve_complaint', { p_complaint: b.dataset.cp, p_status: b.dataset.st, p_decision: v.d }); if (error) alert(err(error)); renderQuality(); });
    $$('[data-strike]', root).forEach((b) => b.onclick = async () => { const d = (dr.data || []).find((x) => x.id === b.dataset.drv); const v = await ask('Udsted strike', [{ k: 'r', label: 'Begrundelse', type: 'textarea' }, { k: 'doc', label: 'Dokumentation (hvad foreligger, fx ordre, billeder, kundens udsagn)', type: 'textarea' }, { k: 'e', label: 'Ansættelsesform', type: 'select', value: d?.subcontractor_id ? 'subcontractor' : 'employee', options: [['employee', 'Ansat'], ['subcontractor', 'Underleverandør']] }], 'Udsted strike'); if (!v) return;
      const { error } = await sb().rpc('admin_issue_strike', { p_complaint: b.dataset.strike, p_reason: v.r, p_documentation: v.doc, p_employment: v.e }); if (error) alert(err(error)); renderQuality(); });
    $$('[data-rv]', root).forEach((b) => b.onclick = async () => { const v = await ask('Tilbagekald strike', [{ k: 'r', label: 'Begrundelse', type: 'textarea' }], 'Tilbagekald'); if (!v) return; const { error } = await sb().rpc('admin_revoke_strike', { p_strike: b.dataset.rv, p_reason: v.r }); if (error) alert(err(error)); renderQuality(); });
  }

  // ═════════════ Support ═════════════
  async function renderSupport() {
    const root = $('#sup-body');
    const [t, m] = await Promise.all([sb().from('support_tickets').select('*').order('created_at', { ascending: false }), sb().from('support_messages').select('*').order('created_at')]);
    if (t.error) { root.innerHTML = `<p class="error">${esc(t.error.message)}</p>`; return; }
    const ST = { open: 'Åben', in_progress: 'I gang', closed: 'Lukket' };
    root.innerHTML = `<p class="notice">Svartid er ikke garanteret 24/7. Svar kunder så hurtigt som muligt i åbningstiden.</p>` + (t.data.map((x) => `<div class="card ticket"><div class="row"><b>${esc(x.ref)} · ${esc(x.subject)}</b><span class="tag">${ST[x.status]}</span><small>${dk(x.created_at)}${x.order_id ? ' · tur ' + esc(S.orders.find((o) => o.id === x.order_id)?.ref || '') : ''}</small></div>
      <p>${esc(x.body)}</p>${(m.data || []).filter((y) => y.ticket_id === x.id).map((y) => `<p class="msg ${y.from_admin ? 'adm' : ''}"><small>${y.from_admin ? 'Road Force' : 'Kunde'} · ${dt2(y.created_at)}</small><br>${esc(y.body)}</p>`).join('')}
      <form class="row" data-reply="${x.id}"><input name="b" placeholder="Skriv svar…" required minlength="2"><button class="btn small primary">Send</button><select name="s"><option value="">Sæt status: i gang</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></form></div>`).join('') || '<p class="muted">Ingen supporthenvendelser.</p>');
    $$('[data-reply]', root).forEach((f) => f.onsubmit = async (e) => { e.preventDefault(); const id = f.dataset.reply; const b = f.b.value;
      let r = await sb().from('support_messages').insert({ ticket_id: id, author: S.me?.id, from_admin: true, body: b }); if (r.error) return alert(err(r.error));
      r = await sb().from('support_tickets').update({ status: f.s.value || 'in_progress', updated_at: new Date().toISOString() }).eq('id', id); if (r.error) alert(err(r.error)); renderSupport(); });
  }


  // ═════════════ Afgifter (bro, færge, vejafgifter) ═════════════
  async function renderTolls() {
    const root = $('#toll-body');
    const { data, error } = await sb().from('toll_rates').select('*').order('id');
    if (error) { root.innerHTML = `<p class="error">${esc(error.message)}</p>`; return; }
    const kr0 = (o) => (o == null ? '' : String(o / 100).replace('.', ','));
    const toOre = (v) => { v = String(v || '').trim().replace(',', '.'); if (v === '') return null; const n = parseFloat(v); return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
    root.innerHTML = `<p class="notice">Priser her er ekskl. moms og vises som særskilte linjer i tilbuddet før booking og betaling. Markér "Afventer pris", hvis prisen kræver et konkret tilbud – linjen vises da med 0 kr og opkræves først efter kundens godkendelse. Kontrollér altid mod udbyderens aktuelle takst.</p>` +
      data.map((r) => `<div class="card" data-toll="${r.id}"><div class="row"><b>${esc(r.name)}</b><small class="muted">Kilde: ${esc(r.source || '–')} · kontrolleret ${esc(r.checked_at || '–')}</small></div>
        <p class="muted">${esc(r.reason)}</p>
        <div class="row"><label>Lille varebil (kr)<input name="van" value="${kr0(r.van_ore)}" inputmode="decimal"></label><label>Stor varebil (kr)<input name="vl" value="${kr0(r.van_large_ore)}" inputmode="decimal"></label><label>Lift/lastbil (kr)<input name="lift" value="${kr0(r.lift_ore)}" inputmode="decimal"></label></div>
        <div class="row"><label><input type="checkbox" name="pending" ${r.pending ? 'checked' : ''}> Afventer pris (kræver tilbud)</label><label><input type="checkbox" name="active" ${r.active ? 'checked' : ''}> Aktiv</label><button class="btn small primary" data-save="${r.id}">Gem</button></div></div>`).join('') || '<p class="muted">Ingen afgifter.</p>';
    $$('[data-save]', root).forEach((b) => b.onclick = async () => {
      const c = b.closest('[data-toll]'); const q = (n) => c.querySelector(`[name=${n}]`);
      const van = toOre(q('van').value), vl = toOre(q('vl').value), li = toOre(q('lift').value);
      if ([van, vl, li].some((x) => Number.isNaN(x))) return alert('Ugyldigt beløb.');
      const { error: e2 } = await sb().rpc('admin_save_toll', { p_id: parseInt(b.dataset.save, 10), p_van: van, p_van_large: vl, p_lift: li, p_pending: q('pending').checked, p_active: q('active').checked });
      if (e2) return alert(err(e2)); renderTolls();
    });
  }

  window.addEventListener('rf-showview', (e) => { const v = e.detail; if (v === 'regnskab') { R.rows = null; renderRegnskab(); } if (v === 'subs') renderSubs(); if (v === 'tolls') renderTolls(); if (v === 'quality') renderQuality(); if (v === 'support') renderSupport(); });
  window.RFModules = { renderTolls, renderRegnskab, renderSubs, renderQuality, renderSupport, R, U };
})();
