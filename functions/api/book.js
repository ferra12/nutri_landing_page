import { validate, sendMail, json, isWeekend, minBookingDate, maxBookingDate } from '../../lib/form.js';

const TIPI = {
  'prima-visita':     'Prima Visita Nutrizionale',
  'controllo':        'Visita di Controllo',
  'controllo-online': 'Visita di Controllo Online',
};

const STUDI = {
  'studio-1': 'Centro Salus – Spresiano (TV)',
  'studio-2': 'Secondo studio',
};

const FASCE = {
  mattina:    'Mattina (9–13)',
  pomeriggio: 'Pomeriggio (14–18)',
};

function schema() {
  const min = minBookingDate();
  const max = maxBookingDate();
  return {
    nome:     { label: 'Nome', required: true, max: 100 },
    cognome:  { label: 'Cognome', required: true, max: 100 },
    email:    { label: 'Email', required: true, max: 254, email: true },
    telefono: { label: 'Telefono', max: 20 },
    note:     { label: 'Note', max: 2000 },
    type:     { label: 'Tipo visita', required: true, oneOf: Object.keys(TIPI) },
    studio:   { label: 'Studio', oneOf: Object.keys(STUDI), requiredIf: d => d?.type !== 'controllo-online' },
    fascia:   { label: 'Fascia oraria', required: true, oneOf: Object.keys(FASCE) },
    privacy:  { label: 'Consenso privacy', bool: true },
    date: {
      label: 'Giorno', required: true,
      check: v => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Giorno non valido.';
        if (isWeekend(v)) return 'Lo studio è chiuso nel weekend.';
        if (v < min) return `Le richieste partono dal ${min}.`;
        if (v > max) return 'Il giorno è troppo lontano nel tempo.';
        return null;
      },
    },
  };
}

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Dati non validi.' }, 400);
  }

  if (data?.website) return json({ ok: true });

  const { ok, errors, clean } = validate(data, schema());
  if (!ok) return json({ error: errors[0] }, 422);

  const tipo = TIPI[clean.type];
  const sent = await sendMail({
    subject: `Richiesta appuntamento – ${tipo} – ${clean.nome} ${clean.cognome}`,
    replyTo: clean.email,
    text: [
      `Tipo: ${tipo}`,
      `Studio: ${STUDI[clean.studio] || '— (online)'}`,
      `Giorno richiesto: ${clean.date}`,
      `Fascia: ${FASCE[clean.fascia]}`,
      '',
      `Nome: ${clean.nome} ${clean.cognome}`,
      `Email: ${clean.email}`,
      `Telefono: ${clean.telefono || '—'}`,
      '',
      `Note: ${clean.note || '—'}`,
      '',
      'Da confermare a mano con data e ora esatte.',
    ].join('\n'),
  }, env);

  if (!sent.ok) {
    return json({ error: `Errore nell'invio. Riprova o scrivi a ${env.MAIL_TO}.` }, 502);
  }

  return json({ ok: true });
}
