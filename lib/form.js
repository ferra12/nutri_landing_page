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
  if (typeof data !== 'object' || data === null || Array.isArray(data)) data = {};

  const errors = [];
  const clean = {};

  for (const [name, rule] of Object.entries(schema)) {
    // Il consenso privacy è l'unico booleano: deve essere true, non "on".
    if (rule.bool) {
      if (data[name] !== true) errors.push(`${rule.label} è obbligatorio.`);
      clean[name] = data[name] === true;
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

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// Senza RESEND_API_KEY l'invio viene simulato: i test di integrazione non
// riempiono la casella di Giulia e lo sviluppo locale non richiede la chiave.
export async function sendMail({ subject, text, replyTo }, env) {
  if (!env.RESEND_API_KEY) {
    console.log(`[sendMail] simulato — ${subject}`);
    return { ok: true, simulated: true };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        from: env.MAIL_FROM,
        to: [env.MAIL_TO],
        subject,
        text,
        reply_to: replyTo,
      }),
    });

    if (!res.ok) {
      console.error(`[sendMail] Resend ha rifiutato: ${res.status} ${await res.text()}`);
    }

    return { ok: res.ok, simulated: false };
  } catch (err) {
    console.error('[sendMail] errore di rete verso Resend', err);
    return { ok: false, simulated: false };
  }
}
