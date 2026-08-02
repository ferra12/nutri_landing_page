// Tutte le date del sito si ragionano su Europe/Rome: i Workers girano in UTC
// e il browser in ora locale, quindi il fuso va fissato esplicitamente.

export function romeToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(now);
}

// Mezzogiorno UTC come ora di riferimento: nessun cambio d'ora può spostare
// il giorno di calendario.
function atNoon(iso) {
  return new Date(`${iso}T12:00:00Z`);
}

export function isWeekend(iso) {
  const dow = atNoon(iso).getUTCDay();
  return dow === 0 || dow === 6;
}

export function minBookingDate(now = new Date()) {
  const d = atNoon(romeToday(now));
  let lavorativi = 0;
  while (lavorativi < 2) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) lavorativi++;
  }
  return d.toISOString().slice(0, 10);
}

export function maxBookingDate(now = new Date()) {
  const d = atNoon(romeToday(now));
  d.setUTCMonth(d.getUTCMonth() + 6);
  return d.toISOString().slice(0, 10);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// schema: { campo: { label, required, requiredIf, max, oneOf, email, bool, check } }
export function validate(data, schema) {
  const errors = [];
  const clean = {};

  for (const [name, rule] of Object.entries(schema)) {
    // Il consenso privacy è l'unico booleano: deve essere true, non "on".
    if (rule.bool) {
      if (data[name] !== true) errors.push(`${rule.label} è obbligatorio.`);
      clean[name] = true;
      continue;
    }

    const value = typeof data[name] === 'string' ? data[name].trim() : '';
    const required = rule.requiredIf ? rule.requiredIf(data) : rule.required;

    if (!value) {
      if (required) errors.push(`${rule.label} è obbligatorio.`);
      clean[name] = '';
      continue;
    }

    if (rule.max && value.length > rule.max) errors.push(`${rule.label} è troppo lungo.`);
    if (rule.oneOf && !rule.oneOf.includes(value)) errors.push(`${rule.label} non è valido.`);
    if (rule.email && !EMAIL_RE.test(value)) errors.push(`${rule.label} non è valido.`);
    if (rule.check) {
      const err = rule.check(value);
      if (err) errors.push(err);
    }

    clean[name] = value;
  }

  return { ok: errors.length === 0, errors, clean };
}
