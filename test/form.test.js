import { test } from 'node:test';
import assert from 'node:assert/strict';
import { romeToday, minBookingDate, isWeekend } from '../lib/form.js';

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
