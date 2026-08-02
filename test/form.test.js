import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romeToday, minBookingDate, maxBookingDate, isWeekend } from '../lib/form.js';

test('romeToday restituisce la data di Roma, non UTC', () => {
  // 2026-03-15T23:30Z è già il 16 marzo a Roma (UTC+1)
  assert.equal(romeToday(new Date('2026-03-15T23:30:00Z')), '2026-03-16');
});

test('minBookingDate salta il weekend', () => {
  // giovedì 2026-08-06 + 2 giorni lavorativi = lunedì 2026-08-10
  assert.equal(minBookingDate(new Date('2026-08-06T10:00:00Z')), '2026-08-10');
  // lunedì 2026-08-03 + 2 giorni lavorativi = mercoledì 2026-08-05
  assert.equal(minBookingDate(new Date('2026-08-03T10:00:00Z')), '2026-08-05');
});

test('isWeekend riconosce sabato e domenica', () => {
  assert.equal(isWeekend('2026-08-08'), true);   // sabato
  assert.equal(isWeekend('2026-08-09'), true);   // domenica
  assert.equal(isWeekend('2026-08-10'), false);  // lunedì
});

import { validate } from '../lib/form.js';

const SCHEMA = {
  nome:     { label: 'Nome', required: true, max: 100 },
  email:    { label: 'Email', required: true, max: 254, email: true },
  telefono: { label: 'Telefono', max: 20 },
  type:     { label: 'Tipo visita', required: true, oneOf: ['prima-visita', 'controllo', 'controllo-online'] },
  studio:   { label: 'Studio', oneOf: ['studio-1', 'studio-2'], requiredIf: d => d.type !== 'controllo-online' },
  privacy:  { label: 'Consenso privacy', bool: true },
};

test('validate accetta un payload corretto', () => {
  const r = validate({ nome: ' Anna ', email: 'a@b.it', type: 'controllo', studio: 'studio-1', privacy: true }, SCHEMA);
  assert.equal(r.ok, true);
  assert.equal(r.clean.nome, 'Anna', 'i campi di testo vanno trimmati');
});

test('validate rifiuta email malformata', () => {
  const r = validate({ nome: 'Anna', email: 'non-una-email', type: 'controllo', studio: 'studio-1', privacy: true }, SCHEMA);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Email/);
});

test('validate rifiuta campo obbligatorio mancante', () => {
  const r = validate({ email: 'a@b.it', type: 'controllo', studio: 'studio-1', privacy: true }, SCHEMA);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Nome/);
});

test('validate rifiuta il consenso privacy assente o falso', () => {
  for (const privacy of [undefined, false, 'on']) {
    const r = validate({ nome: 'Anna', email: 'a@b.it', type: 'controllo', studio: 'studio-1', privacy }, SCHEMA);
    assert.equal(r.ok, false, `privacy=${privacy} deve essere rifiutato`);
  }
});

test('studio non è richiesto per le visite online', () => {
  const r = validate({ nome: 'Anna', email: 'a@b.it', type: 'controllo-online', privacy: true }, SCHEMA);
  assert.equal(r.ok, true);
});

test('studio è richiesto per le visite in presenza', () => {
  const r = validate({ nome: 'Anna', email: 'a@b.it', type: 'controllo', privacy: true }, SCHEMA);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Studio/);
});

test('validate rifiuta un valore fuori whitelist', () => {
  const r = validate({ nome: 'Anna', email: 'a@b.it', type: 'massaggio', studio: 'studio-1', privacy: true }, SCHEMA);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Tipo visita/);
});

test('validate rifiuta un campo troppo lungo', () => {
  const r = validate({ nome: 'x'.repeat(101), email: 'a@b.it', type: 'controllo', studio: 'studio-1', privacy: true }, SCHEMA);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /Nome/);
});

test('validate non esplode su input nullo o non-oggetto', () => {
  const s = { nome: { label: 'Nome', required: true, max: 100 } };
  for (const input of [null, undefined, 'stringa', 42, []]) {
    const r = validate(input, s);
    assert.equal(r.ok, false, `input ${JSON.stringify(input)} deve dare ok:false, non lanciare`);
  }
});

test('clean.privacy riflette il valore reale, non una costante', () => {
  const s = { privacy: { label: 'Consenso privacy', bool: true } };
  assert.equal(validate({ privacy: true }, s).clean.privacy, true);
  assert.equal(validate({ privacy: 'on' }, s).clean.privacy, false);
  assert.equal(validate({}, s).clean.privacy, false);
});

test('maxBookingDate somma 6 mesi', () => {
  assert.equal(maxBookingDate(new Date('2026-08-10T10:00:00Z')), '2027-02-10');
  // Overflow di fine mese noto e accettato: il 31 agosto + 6 mesi non esiste
  // (31 febbraio) e JS normalizza in avanti. È un limite superiore su una
  // richiesta confermata a mano: qualche giorno di tolleranza non danneggia.
  assert.equal(maxBookingDate(new Date('2026-08-31T10:00:00Z')), '2027-03-03');
});

import { sendMail, json } from '../lib/form.js';

test('sendMail simula l\'invio quando manca la chiave API', async () => {
  const r = await sendMail({ subject: 'x', text: 'y' }, {});
  assert.equal(r.ok, true);
  assert.equal(r.simulated, true);
});

test('sendMail chiama Resend quando la chiave è presente', async () => {
  const chiamate = [];
  const fetchOriginale = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    chiamate.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: true };
  };

  try {
    const r = await sendMail(
      { subject: 'Nuova richiesta', text: 'corpo', replyTo: 'paziente@example.it' },
      { RESEND_API_KEY: 'k', MAIL_FROM: 'no-reply@giuliadadalt.it', MAIL_TO: 'destinataria@example.it' },
    );
    assert.equal(r.ok, true);
    assert.equal(r.simulated, false);
    assert.equal(chiamate.length, 1);
    assert.equal(chiamate[0].url, 'https://api.resend.com/emails');
    assert.equal(chiamate[0].body.reply_to, 'paziente@example.it');
    assert.deepEqual(chiamate[0].body.to, ['destinataria@example.it']);
    assert.equal(chiamate[0].body.from, 'no-reply@giuliadadalt.it');
    assert.equal(chiamate[0].headers.authorization, 'Bearer k');
  } finally {
    globalThis.fetch = fetchOriginale;
  }
});

test('sendMail restituisce ok:false senza lanciare se fetch fallisce', async () => {
  const fetchOriginale = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('rete giù'); };
  try {
    const r = await sendMail({ subject: 'x', text: 'y' }, { RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.it', MAIL_TO: 'c@d.it' });
    assert.equal(r.ok, false);
  } finally {
    globalThis.fetch = fetchOriginale;
  }
});

test('sendMail restituisce ok:false quando Resend rifiuta', async () => {
  const fetchOriginale = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => '{"message":"domain is not verified"}' });
  try {
    const r = await sendMail({ subject: 'x', text: 'y' }, { RESEND_API_KEY: 'k', MAIL_FROM: 'a@b.it', MAIL_TO: 'c@d.it' });
    assert.equal(r.ok, false);
  } finally {
    globalThis.fetch = fetchOriginale;
  }
});

test('json costruisce una Response con lo status giusto', async () => {
  const res = json({ error: 'no' }, 422);
  assert.equal(res.status, 422);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), { error: 'no' });
});
