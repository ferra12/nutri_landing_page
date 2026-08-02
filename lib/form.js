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
