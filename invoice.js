// Faktura som printbar HTML-side. Al tekst fra databasen går gennem esc() (XSS-beskyttelse).
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const money = (ore) => `${(ore / 100).toLocaleString('da-DK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kr`;
const date = (iso) => new Date(iso).toLocaleDateString('da-DK', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Copenhagen' });
const lines = (s) => esc(s).replace(/\n/g, '<br>');

export function renderInvoiceHtml(inv) {
  const s = inv.seller || {}, b = inv.buyer || {}, m = inv.meta || {};
  const rows = (inv.lines || []).map((l) => `<tr><td>${esc(l.label)}</td><td class="r">${money(l.amount)}</td><td class="r">${l.vat ? esc(inv.vat_percent) + ' %' : '0 %'}</td></tr>`).join('');
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>Faktura ${esc(inv.number)}</title>
<style>body{font:14px/1.45 system-ui,sans-serif;color:#111;max-width:760px;margin:30px auto;padding:0 20px}h1{margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:18px 0}
th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}.r{text-align:right}.tot td{font-weight:700;border-top:2px solid #111}.muted{color:#555}.cols{display:flex;gap:40px;justify-content:space-between}
@media print{button{display:none}}</style></head><body>
<button onclick="print()">Print / gem som PDF</button>
<div class="cols"><div><h1>Faktura</h1><div class="muted">Nr. ${esc(inv.number)}<br>Dato ${esc(date(inv.issued_at))}</div></div>
<div style="text-align:right"><b>${esc(s.name)}</b><br>${lines(s.address)}<br>${s.cvr ? 'CVR ' + esc(s.cvr) + '<br>' : ''}${esc(s.email)} ${esc(s.phone)}</div></div>
<p><b>Til:</b><br>${esc(b.company || b.name)}${b.company && b.name ? '<br>att. ' + esc(b.name) : ''}<br>${lines(b.address)}${b.cvr ? '<br>CVR ' + esc(b.cvr) : ''}<br>${esc(b.email)}</p>
<p class="muted">Ordre ${esc(m.order_ref)} · ${esc(m.from)}${m.to && m.to !== m.from ? ' → ' + esc(m.to) : ''}${m.pickup_at ? ' · ' + esc(date(m.pickup_at)) : ''}</p>
<table><thead><tr><th>Beskrivelse</th><th class="r">Beløb ekskl. moms</th><th class="r">Moms</th></tr></thead><tbody>${rows}
<tr class="tot"><td>I alt ekskl. moms</td><td class="r">${money(inv.ex_vat)}</td><td></td></tr>
<tr><td>Moms ${esc(inv.vat_percent)} %</td><td class="r">${money(inv.vat)}</td><td></td></tr>
<tr class="tot"><td>Total inkl. moms</td><td class="r">${money(inv.total)}</td><td></td></tr>
<tr><td>Betalt med kort</td><td class="r">−${money(inv.paid)}</td><td></td></tr>
<tr class="tot"><td>${inv.due > 0 ? 'Til betaling' : inv.due < 0 ? 'Til gode' : 'Til betaling'}</td><td class="r">${money(inv.due)}</td><td></td></tr></tbody></table>
${inv.due > 0 && s.bank_info ? `<p><b>Betaling:</b><br>${lines(s.bank_info)}</p>` : ''}<p class="muted">${lines(s.footer)}</p></body></html>`;
}
