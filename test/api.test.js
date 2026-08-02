import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { minBookingDate } from '../lib/form.js';

const BASE = process.env.BASE_URL || 'http://localhost:8788';

// Parte dal minimo consentito e avanza fino al primo giorno feriale.
function giornoValido() {
  const d = new Date(`${minBookingDate()}T12:00:00Z`);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const BASE_PAYLOAD = {
  nome: 'Anna', cognome: 'Bianchi', email: 'anna@example.it',
  type: 'controllo', studio: 'studio-1', fascia: 'mattina', privacy: true,
};

const post = (path, body) => fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

before(async () => {
  try {
    await fetch(BASE);
  } catch {
    throw new Error(`Nessun server su ${BASE}. Avvia "npm run dev" in un altro terminale.`);
  }
});

test('payload valido → 200', async () => {
  const res = await post('/api/book', { ...BASE_PAYLOAD, date: giornoValido() });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('email invalida → 422', async () => {
  const res = await post('/api/book', { ...BASE_PAYLOAD, date: giornoValido(), email: 'non-valida' });
  assert.equal(res.status, 422);
});

test('campo obbligatorio mancante → 422', async () => {
  const { nome, ...senzaNome } = BASE_PAYLOAD;
  const res = await post('/api/book', { ...senzaNome, date: giornoValido() });
  assert.equal(res.status, 422);
});

test('data prima del minimo consentito → 422', async () => {
  const res = await post('/api/book', { ...BASE_PAYLOAD, date: '2020-01-06' });
  assert.equal(res.status, 422);
});

test('data nel weekend → 422', async () => {
  const d = new Date(`${giornoValido()}T12:00:00Z`);
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  const res = await post('/api/book', { ...BASE_PAYLOAD, date: d.toISOString().slice(0, 10) });
  assert.equal(res.status, 422);
  assert.match((await res.json()).error, /weekend/);
});

test('consenso privacy assente → 422', async () => {
  const res = await post('/api/book', { ...BASE_PAYLOAD, date: giornoValido(), privacy: false });
  assert.equal(res.status, 422);
});

test('visita online senza studio → 200', async () => {
  const { studio, ...senzaStudio } = BASE_PAYLOAD;
  const res = await post('/api/book', { ...senzaStudio, type: 'controllo-online', date: giornoValido() });
  assert.equal(res.status, 200);
});

test('honeypot compilato → 200 senza invio', async () => {
  const res = await post('/api/book', { ...BASE_PAYLOAD, date: giornoValido(), website: 'http://spam.example' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('JSON malformato → 400', async () => {
  const res = await fetch(`${BASE}/api/book`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'non-json',
  });
  assert.equal(res.status, 400);
});

test('/api/contact accetta un messaggio valido', async () => {
  const res = await post('/api/contact', {
    nome: 'Anna', cognome: 'Bianchi', email: 'anna@example.it',
    oggetto: 'Informazioni', messaggio: 'Ciao', privacy: true,
  });
  assert.equal(res.status, 200);
});

test('/api/contact rifiuta senza consenso privacy', async () => {
  const res = await post('/api/contact', {
    nome: 'Anna', cognome: 'Bianchi', email: 'anna@example.it',
    oggetto: 'Informazioni', messaggio: 'Ciao',
  });
  assert.equal(res.status, 422);
});
