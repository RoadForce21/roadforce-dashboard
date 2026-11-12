// RoadForce prisberegning efter erhvervsprislisten. Alle beløb i ØRE (heltal). Ren logik, ingen netværk.
// Kilde-filen ligger her; admin-web/pricing.js er en identisk kopi (testes), så dashboardet viser SAMME beregning.
// Kører KUN på serveren når der bestilles – appen viser blot resultatet.

export class QuoteError extends Error {
  constructor(message, code = 'INVALID') { super(message); this.name = 'QuoteError'; this.code = code; }
}

export const VEHICLES = { van: 'Kassebil', lift: 'Mindre liftbil' };

/** Standardsatser = prislisten (øre). Gemmes i tabellen pricing_settings og kan rettes i dashboardet. */
export const DEFAULT_PRICING = {
  van_min_ore: 42500, lift_min_ore: 57500,
  van_km_ore: 1600, lift_km_ore: 1950,
  van_stop_ore: 9000, lift_stop_ore: 12000,
  van_wait_ore: 14000, lift_wait_ore: 16500,          // pr. påbegyndt kvarter ud over inkluderet tid
  van_hour_ore: 55000, lift_hour_ore: 67500,
  van_extra_km_ore: 400, lift_extra_km_ore: 500,      // timebooking: km ud over puljen
  hourly_min_hours: 2, km_per_hour: 20,
  max_route_km: 100,                                  // længere A–B-ture kræver konkret tilbud
  max_stops: 5,
  acute_percent: 25, acute_min_ore: 20000,
  evening_percent: 25, night_percent: 50, weekend_percent: 50,
  extra_man_day_ore: 40000, extra_man_evening_ore: 50000, extra_man_night_ore: 60000, extra_man_min_hours: 2,
  vat_percent: 25,
  max_weight_kg: 1500, max_pallets: 8,
};

// ───────────── Danske tidszone- og helligdagshjælp ─────────────
const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Copenhagen', hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', weekday: 'short' });
/** Dansk lokaltid for et tidspunkt. */
export function copenhagenParts(date) {
  const o = {}; for (const x of fmt.formatToParts(date)) o[x.type] = x.value;
  return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour, min: +o.minute, wd: o.weekday }; // wd: Mon..Sun
}
function easter(y) { // Meeus/Jones/Butcher
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return Date.UTC(y, mo - 1, da);
}
const holidayCache = new Map();
/** Danske helligdage (lovbestemte kirkelige + nytår + jul). Store bededag er afskaffet fra 2024. */
export function holidays(y) {
  if (holidayCache.has(y)) return holidayCache.get(y);
  const E = easter(y), D = 86400000, set = new Set();
  const add = (ms) => { const t = new Date(ms); set.add(`${t.getUTCFullYear()}-${t.getUTCMonth() + 1}-${t.getUTCDate()}`); };
  [Date.UTC(y, 0, 1), E - 3 * D, E - 2 * D, E, E + D, E + 39 * D, E + 49 * D, E + 50 * D, Date.UTC(y, 11, 25), Date.UTC(y, 11, 26)].forEach(add);
  if (y < 2024) add(E + 26 * D);
  holidayCache.set(y, set); return set;
}
export const isHoliday = (p) => holidays(p.y).has(`${p.y}-${p.m}-${p.d}`);

/** 'day' | 'evening' | 'night' | 'weekend' for et tidspunkt (weekend gælder også helligdage). */
export function periodOf(date) {
  const p = copenhagenParts(date);
  if (p.wd === 'Sat' || p.wd === 'Sun' || isHoliday(p)) return 'weekend';
  if (p.h < 7 || p.h >= 22) return 'night';
  if (p.h >= 17) return 'evening';
  return 'day';
}
const pctOf = (p, period) => ({ day: 0, evening: p.evening_percent, night: p.night_percent, weekend: p.weekend_percent })[period];
const manRate = (p, period) => ({ day: p.extra_man_day_ore, evening: p.extra_man_evening_ore, night: p.extra_man_night_ore, weekend: p.extra_man_night_ore })[period];

/** Fordeler et tidsrum i kvarterer (forholdsmæssig afregning over flere tidsrum). Returnerer perioden for hvert kvarter. */
function quarters(start, hours) {
  const n = Math.round(hours * 4), out = [];
  for (let i = 0; i < n; i++) out.push(periodOf(new Date(start.getTime() + i * 900000 + 1)));
  return out;
}

const eur = (n) => Math.round(n);
const isQuarterHours = (h) => Number.isFinite(h) && Math.abs(h * 4 - Math.round(h * 4)) < 1e-9;

/**
 * @param p  satser (pricing_settings)
 * @param i  { service:'route'|'hourly', vehicle:'van'|'lift', km, stops, hours, pickupAt:Date, acute, extraManHours, pallets, weightKg }
 * @returns { lines:[{key,label,amount}], exVat, vat, total, vatPercent, km, notes:[] }
 */
export function computePrice(p, i) {
  const service = i.service ?? 'route';
  if (service !== 'route' && service !== 'hourly') throw new QuoteError('Ukendt ydelse');
  if (i.vehicle !== 'van' && i.vehicle !== 'lift') throw new QuoteError('Vælg kassebil eller mindre liftbil.');
  const v = i.vehicle;
  const pickup = i.pickupAt instanceof Date ? i.pickupAt : new Date(i.pickupAt);
  if (isNaN(pickup.getTime())) throw new QuoteError('Ugyldigt afhentningstidspunkt');
  if (!Number.isInteger(i.pallets ?? 1) || (i.pallets ?? 1) < 1) throw new QuoteError('Mindst 1 palleplads');
  if (!Number.isInteger(i.weightKg ?? 1) || (i.weightKg ?? 1) < 1) throw new QuoteError('Vægt skal være mindst 1 kg');
  if ((i.pallets ?? 1) > p.max_pallets) throw new QuoteError(`Maks ${p.max_pallets} pallepladser. Kontakt os for større opgaver.`, 'QUOTE_ONLY');
  if ((i.weightKg ?? 1) > p.max_weight_kg) throw new QuoteError(`Maks ${p.max_weight_kg} kg. Kontakt os for tungere opgaver.`, 'QUOTE_ONLY');
  const stops = i.stops ?? 0;
  if (!Number.isInteger(stops) || stops < 0) throw new QuoteError('Ugyldigt antal ekstra stop');
  if (stops > p.max_stops) throw new QuoteError(`Maks ${p.max_stops} ekstra stop. Kontakt os for flere.`, 'QUOTE_ONLY');
  const manH = i.extraManHours ?? 0;
  if (manH !== 0 && (!isQuarterHours(manH) || manH < p.extra_man_min_hours)) throw new QuoteError(`Ekstra mand bookes i mindst ${p.extra_man_min_hours} timer.`);

  const lines = [], notes = [];
  let base, km = null;

  if (service === 'route') {
    if (!Number.isFinite(i.km) || i.km <= 0) throw new QuoteError('Ugyldig afstand');
    km = Math.ceil(i.km - 1e-9);               // hele rutens afstand rundes samlet op
    if (km > p.max_route_km) throw new QuoteError(`Ture over ${p.max_route_km} km kræver et konkret tilbud. Kontakt os, så sender vi et fast tilbud.`, 'QUOTE_ONLY');
    const perKm = p[`${v}_km_ore`], min = p[`${v}_min_ore`];
    const kmPrice = eur(km * perKm);
    base = Math.max(min, kmPrice);              // minimumsprisen lægges IKKE oveni
    lines.push({ key: 'transport', label: kmPrice < min ? `Transport ${km} km (minimumspris)` : `Transport ${km} km`, amount: base });
    if (stops) lines.push({ key: 'stops', label: `${stops} ekstra stop`, amount: stops * p[`${v}_stop_ore`] });
    notes.push('Inkluderet tid pr. stop: ' + (v === 'van' ? '10' : '15') + ' min. Ekstra tid afregnes pr. påbegyndt kvarter (' + (p[`${v}_wait_ore`] / 100) + ' kr.).');
  } else {
    const h = i.hours;
    if (!isQuarterHours(h) || h < p.hourly_min_hours) throw new QuoteError(`Timebooking er mindst ${p.hourly_min_hours} timer (derefter pr. påbegyndt kvarter).`);
    base = eur(h * p[`${v}_hour_ore`]);
    lines.push({ key: 'hours', label: `${h} timer`, amount: base });
    notes.push(`${p.km_per_hour} km pr. faktureret time er inkluderet (${h * p.km_per_hour} km). Ekstra km: ${p[`${v}_extra_km_ore`] / 100} kr./km afregnes bagefter.`);
  }

  // Tillæg på grundprisen (aldrig på stop, ventetid, ekstra mand eller udlæg). Højeste af tidstillæg og akuttillæg – de lægges ikke sammen.
  let timeSur;
  if (service === 'route') timeSur = eur(base * pctOf(p, periodOf(pickup)) / 100);
  else { const q = quarters(pickup, i.hours); timeSur = eur(q.reduce((s, per) => s + (base / q.length) * pctOf(p, per) / 100, 0)); }
  const acuteSur = i.acute ? Math.max(eur(base * p.acute_percent / 100), p.acute_min_ore) : 0;
  if (Math.max(timeSur, acuteSur) > 0) {
    const useAcute = acuteSur >= timeSur;
    lines.push({ key: 'surcharge', label: useAcute ? 'Akuttillæg' : ({ evening: 'Aftentillæg', night: 'Nattillæg', weekend: 'Weekend-/helligdagstillæg', day: 'Tidstillæg' })[service === 'route' ? periodOf(pickup) : 'day'] ?? 'Tidstillæg', amount: Math.max(timeSur, acuteSur) });
  }

  if (manH) {
    const q = quarters(pickup, manH);
    lines.push({ key: 'man', label: `Ekstra mand ${manH} timer`, amount: eur(q.reduce((s, per) => s + manRate(p, per) / 4, 0)) });
  }

  const exVat = lines.reduce((s, l) => s + l.amount, 0);
  const vat = eur(exVat * p.vat_percent / 100);
  notes.push('Bro-, færge- og nødvendig betalingsparkering afregnes efter dokumenteret udgift. Ventetid ud over inkluderet tid faktureres bagefter.');
  return { lines, exVat, vat, total: exVat + vat, vatPercent: p.vat_percent, km, notes };
}

/** Afbestillingsgebyr (ekskl. moms) for enkeltbookinger. dispatched = bilen er afsendt / forgæves ankomst. */
export function cancellationFee(p, o, now = new Date()) {
  const min = o.service === 'hourly' ? p.hourly_min_hours * p[`${o.vehicle}_hour_ore`] : p[`${o.vehicle}_min_ore`];
  const hoursUntil = (new Date(o.pickupAt).getTime() - now.getTime()) / 3600000;
  let fee = 0;
  if (o.dispatched) fee = min;
  else if (hoursUntil < 24) fee = Math.round(min / 2);
  return Math.min(fee, o.confirmedExVat ?? fee);
}

/**
 * Hvad sker der ved annullering af en BETALT ordre?
 * o: { service, vehicle, pickupAt, dispatched, paidTotal, confirmedExVat, vatPercent, feeMode:'auto'|'none' }
 * Returnerer { feeExVat, feeVat, feeTotal, refund } (øre). Ubetalte ordrer har aldrig gebyr (booking er først bindende ved betaling).
 */
export function cancellationOutcome(p, o, now = new Date()) {
  const paid = o.paidTotal ?? 0;
  if (paid <= 0) return { feeExVat: 0, feeVat: 0, feeTotal: 0, refund: 0 };
  const feeExVat = o.feeMode === 'none' ? 0 : cancellationFee(p, o, now);
  const feeVat = Math.round(feeExVat * (o.vatPercent ?? p.vat_percent) / 100);
  const feeTotal = Math.min(feeExVat + feeVat, paid);
  return { feeExVat, feeVat, feeTotal, refund: paid - feeTotal };
}
