import { validate, sendMail, json } from '../../lib/form.js';

const SCHEMA = {
  nome:      { label: 'Nome', required: true, max: 100 },
  cognome:   { label: 'Cognome', required: true, max: 100 },
  email:     { label: 'Email', required: true, max: 254, email: true },
  telefono:  { label: 'Telefono', max: 20 },
  oggetto:   { label: 'Oggetto', required: true, max: 200 },
  messaggio: { label: 'Messaggio', required: true, max: 2000 },
  privacy:   { label: 'Consenso privacy', bool: true },
};

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ error: 'Dati non validi.' }, 400);
  }

  // Honeypot: successo finto, così il bot non capisce di essere stato scoperto.
  if (data?.website) return json({ ok: true });

  const { ok, errors, clean } = validate(data, SCHEMA);
  if (!ok) return json({ error: errors[0] }, 422);

  const sent = await sendMail({
    subject: `Nuovo messaggio – ${clean.oggetto} – ${clean.nome} ${clean.cognome}`,
    replyTo: clean.email,
    text: [
      `Nome: ${clean.nome} ${clean.cognome}`,
      `Email: ${clean.email}`,
      `Telefono: ${clean.telefono || '—'}`,
      `Oggetto: ${clean.oggetto}`,
      '',
      'Messaggio:',
      clean.messaggio,
    ].join('\n'),
  }, env);

  if (!sent.ok) {
    return json({ error: `Errore nell'invio. Riprova o scrivi a ${env.MAIL_TO}.` }, 502);
  }

  return json({ ok: true });
}
