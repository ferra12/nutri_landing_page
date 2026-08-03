# Migrazione a Cloudflare Pages con widget prenotazione — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Servire il sito da Cloudflare Pages senza backend Python, sostituendo il widget di prenotazione basato su Google Calendar con una richiesta di appuntamento (data + fascia oraria) inviata per email via Resend.

**Architecture:** Statico in `public/` servito da Pages. Due Pages Functions (`/api/book`, `/api/contact`) che condividono validazione e invio email da `lib/form.js`. Nessuno stato persistente: la richiesta vive nell'email. `app.py`, `templates/` e il tunnel vengono eliminati.

**Tech Stack:** Cloudflare Pages + Pages Functions (JavaScript, runtime Workers), Resend HTTP API, `node --test` per i test, `wrangler` per lo sviluppo locale.

**Spec:** `docs/superpowers/specs/2026-08-02-booking-widget-pages-design.md`

---

## Struttura dei file

| File | Responsabilità |
|---|---|
| `public/` | tutto lo statico servito da Pages (ex `static/` + ex `templates/`) |
| `public/index.html` | landing page, widget prenotazione, form contatti |
| `public/js/main.js` | submit di entrambe le form, regole data lato client |
| `lib/form.js` | `validate()`, `sendMail()`, helper date su Europe/Rome, `json()` |
| `functions/api/book.js` | endpoint richiesta appuntamento |
| `functions/api/contact.js` | endpoint messaggio generico |
| `test/form.test.js` | unit test di `lib/form.js`, senza rete |
| `test/api.test.js` | test HTTP contro `wrangler pages dev` |
| `public/_headers` | header di sicurezza (Pages lo legge dalla directory di output, non dalla radice) |
| `package.json` | `wrangler` come devDependency, script di test |

`lib/form.js` è l'unico file con logica condivisa: le due Functions sono glue di ~25 righe. I test sono divisi perché hanno costi diversi — `form.test.js` gira in millisecondi senza server, `api.test.js` richiede `wrangler` avviato.

---

## Task 1: Impalcatura del progetto

**Files:**
- Create: `package.json`
- Modify: `.gitignore`
- Move: `static/*` → `public/`, `templates/*.html` → `public/`

- [ ] **Step 1: Creare `package.json`**

```json
{
  "name": "nutri-landing-page",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler pages dev public",
    "test:unit": "node --test test/form.test.js",
    "test:api": "node --test test/api.test.js"
  },
  "devDependencies": {
    "wrangler": "^3.0.0"
  }
}
```

- [ ] **Step 2: Aggiungere `node_modules` a `.gitignore`**

Aggiungere in fondo al file:

```
node_modules/
.wrangler/
```

- [ ] **Step 3: Spostare i file statici**

```bash
mkdir -p public
git mv static/css public/css
git mv static/js public/js
git mv static/img public/img
git mv templates/index.html public/index.html
git mv templates/privacy.html public/privacy.html
rmdir templates static
```

- [ ] **Step 4: Installare wrangler e verificare che il sito si apra**

```bash
npm install
npm run dev
```

Aprire `http://localhost:8788`. Atteso: la pagina si carica con CSS e immagini corretti (i path sono già root-relative). Le due form falliscono — non esistono ancora le Functions. Fermare con Ctrl+C.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: sposta lo statico in public/ e aggiunge package.json"
```

---

## Task 2: Helper date su Europe/Rome

**Files:**
- Create: `lib/form.js`
- Test: `test/form.test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Creare `test/form.test.js`:

```js
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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npm run test:unit`
Expected: FAIL — `Cannot find module '../lib/form.js'`

- [ ] **Step 3: Implementare gli helper**

Creare `lib/form.js`:

```js
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
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npm run test:unit`
Expected: PASS, 3 test

- [ ] **Step 5: Commit**

```bash
git add lib/form.js test/form.test.js
git commit -m "feat: helper date su Europe/Rome per il widget prenotazione"
```

---

## Task 3: Funzione di validazione

**Files:**
- Modify: `lib/form.js`
- Test: `test/form.test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `test/form.test.js`:

```js
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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npm run test:unit`
Expected: FAIL — `validate is not a function`

- [ ] **Step 3: Implementare `validate`**

Aggiungere in fondo a `lib/form.js`:

```js
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
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npm run test:unit`
Expected: PASS, 11 test

- [ ] **Step 5: Commit**

```bash
git add lib/form.js test/form.test.js
git commit -m "feat: validazione condivisa con consenso privacy server-side"
```

---

## Task 4: Invio email via Resend

**Files:**
- Modify: `lib/form.js`
- Test: `test/form.test.js`

- [ ] **Step 1: Scrivere il test che fallisce**

Aggiungere in fondo a `test/form.test.js`:

```js
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
    chiamate.push({ url, body: JSON.parse(opts.body) });
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
```

- [ ] **Step 2: Eseguire il test e verificare che fallisca**

Run: `npm run test:unit`
Expected: FAIL — `sendMail is not a function`

- [ ] **Step 3: Implementare `sendMail` e `json`**

Aggiungere in fondo a `lib/form.js`:

```js
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

  return { ok: res.ok, simulated: false };
}
```

- [ ] **Step 4: Eseguire il test e verificare che passi**

Run: `npm run test:unit`
Expected: PASS, 14 test

- [ ] **Step 5: Commit**

```bash
git add lib/form.js test/form.test.js
git commit -m "feat: invio email via Resend con modalita' simulata senza chiave"
```

---

## Task 5: Endpoint `/api/contact`

**Files:**
- Create: `functions/api/contact.js`

Nessun test unitario: questo file è glue, ed è coperto dai test HTTP del Task 9.

- [ ] **Step 1: Scrivere la Function**

Creare `functions/api/contact.js`:

```js
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
  if (data.website) return json({ ok: true });

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
```

- [ ] **Step 2: Verificare a mano con wrangler**

```bash
npm run dev
```

In un secondo terminale:

```bash
curl -s -X POST http://localhost:8788/api/contact \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Anna","cognome":"Bianchi","email":"anna@example.it","oggetto":"Info","messaggio":"Ciao","privacy":true}'
```

Expected: `{"ok":true}`, e nel log di wrangler la riga `[sendMail] simulato — Nuovo messaggio…`. Fermare wrangler.

- [ ] **Step 3: Commit**

```bash
git add functions/api/contact.js
git commit -m "feat: endpoint /api/contact come Pages Function"
```

---

## Task 6: Endpoint `/api/book`

**Files:**
- Create: `functions/api/book.js`

- [ ] **Step 1: Scrivere la Function**

Creare `functions/api/book.js`:

```js
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
    studio:   { label: 'Studio', oneOf: Object.keys(STUDI), requiredIf: d => d.type !== 'controllo-online' },
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

  if (data.website) return json({ ok: true });

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
```

- [ ] **Step 2: Verificare a mano con wrangler**

```bash
npm run dev
```

In un secondo terminale, con una data feriale futura:

```bash
curl -s -X POST http://localhost:8788/api/book \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Anna","cognome":"Bianchi","email":"anna@example.it","type":"controllo","studio":"studio-1","date":"2026-09-16","fascia":"mattina","privacy":true}'
```

Expected: `{"ok":true}`

Poi con un sabato:

```bash
curl -s -X POST http://localhost:8788/api/book \
  -H 'Content-Type: application/json' \
  -d '{"nome":"Anna","cognome":"Bianchi","email":"anna@example.it","type":"controllo","studio":"studio-1","date":"2026-09-19","fascia":"mattina","privacy":true}'
```

Expected: `{"error":"Lo studio è chiuso nel weekend."}` con status 422. Fermare wrangler.

- [ ] **Step 3: Commit**

```bash
git add functions/api/book.js
git commit -m "feat: endpoint /api/book per richieste di appuntamento"
```

---

## Task 7: Markup del widget

**Files:**
- Modify: `public/index.html` — sostituire il blocco commentato del vecchio widget (dall'apertura `<!-- ── Booking Widget ── -->` fino alla chiusura del commento subito prima di `<div class="form-divider">`)
- Modify: `public/css/style.css`

- [ ] **Step 1: Sostituire il blocco commentato con il markup nuovo**

Il vecchio widget occupa un unico grande commento HTML dentro `<div class="contatti-form fade-in">`. Va rimosso per intero e sostituito con:

```html
          <!-- ── Richiesta appuntamento ── -->
          <form id="bookingForm" class="contact-form" novalidate>
            <div class="form-row">
              <div class="form-group">
                <label for="bkType">Tipo di visita *</label>
                <select id="bkType" name="type" required>
                  <option value="prima-visita">Prima Visita Nutrizionale</option>
                  <option value="controllo">Visita di Controllo</option>
                  <option value="controllo-online">Visita di Controllo Online</option>
                </select>
              </div>
              <div class="form-group" id="bkStudioGroup">
                <label for="bkStudio">Studio *</label>
                <select id="bkStudio" name="studio">
                  <option value="studio-1">Centro Salus – Spresiano (TV)</option>
                  <option value="studio-2">Secondo studio</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="bkDate">Giorno preferito *</label>
                <input type="date" id="bkDate" name="date" required>
              </div>
              <div class="form-group">
                <label for="bkFascia">Fascia oraria *</label>
                <select id="bkFascia" name="fascia" required>
                  <option value="mattina">Mattina (9–13)</option>
                  <option value="pomeriggio">Pomeriggio (14–18)</option>
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="bkNome">Nome *</label>
                <input type="text" id="bkNome" name="nome" placeholder="Il tuo nome" required>
              </div>
              <div class="form-group">
                <label for="bkCognome">Cognome *</label>
                <input type="text" id="bkCognome" name="cognome" placeholder="Il tuo cognome" required>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label for="bkEmail">Email *</label>
                <input type="email" id="bkEmail" name="email" placeholder="la.tua@email.it" required>
              </div>
              <div class="form-group">
                <label for="bkTelefono">Telefono</label>
                <input type="tel" id="bkTelefono" name="telefono" placeholder="+39 000 000 0000">
              </div>
            </div>
            <div class="form-group">
              <label for="bkNote">Note</label>
              <textarea id="bkNote" name="note" rows="3" placeholder="Qualcosa che è utile sapere prima della visita"></textarea>
            </div>
            <div class="form-check">
              <input type="checkbox" id="bkPrivacy" name="privacy" required>
              <label for="bkPrivacy">Ho letto e accetto la <a href="/privacy">Privacy Policy</a> *</label>
            </div>
            <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp-field">
            <button type="submit" class="btn-primary btn-full">Richiedi appuntamento</button>
            <p class="bk-note">Riceverai conferma con data e ora esatte entro 24h.</p>
            <div id="bookingMessage" class="form-message" hidden role="alert"></div>
          </form>
```

- [ ] **Step 2: Aggiungere il campo honeypot anche al form contatti**

In `public/index.html`, dentro `<form id="contactForm">`, subito prima di `<button type="submit" class="btn-primary btn-full">Invia messaggio</button>`:

```html
            <input type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" class="hp-field">
```

- [ ] **Step 3: Nascondere l'honeypot via CSS**

In fondo a `public/css/style.css`:

```css
/* Honeypot anti-spam: invisibile a un umano, compilato dai bot */
.hp-field {
  position: absolute;
  left: -9999px;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.bk-note {
  margin-top: 0.75rem;
  font-size: 0.85rem;
  opacity: 0.75;
  text-align: center;
}
```

- [ ] **Step 4: Verificare visivamente**

```bash
npm run dev
```

Aprire `http://localhost:8788`. Atteso: il form richiesta appuntamento appare sopra il divisore, riusa lo stile delle altre form, e il campo `website` non è visibile in nessun punto della pagina. Fermare wrangler.

- [ ] **Step 5: Commit**

```bash
git add public/index.html public/css/style.css
git commit -m "feat: markup del widget richiesta appuntamento"
```

---

## Task 8: Logica client delle form

**Files:**
- Modify: `public/js/main.js`
- Delete: `public/js/booking.js`
- Modify: `public/index.html` (rimuovere il tag script di `booking.js`)

- [ ] **Step 1: Eliminare il vecchio widget JS**

```bash
git rm public/js/booking.js
```

In `public/index.html` rimuovere la riga:

```html
  <script src="/js/booking.js"></script>
```

- [ ] **Step 2: Sostituire il gestore del form contatti con uno condiviso**

In `public/js/main.js`, il blocco `if (contactForm) { ... }` contiene un handler di submit, e più sotto c'è la funzione `showMsg`. Sostituire entrambi con:

```js
function showMsg(el, text, type) {
  el.textContent = text;
  el.className = 'form-message ' + type;
  el.hidden = false;
  el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  setTimeout(() => { el.hidden = true; }, 7000);
}

function bindForm(form, url, msgEl, successText) {
  if (!form) return;

  form.addEventListener('submit', async e => {
    e.preventDefault();

    const required = form.querySelectorAll('[required]');
    let valid = true;
    required.forEach(field => {
      const invalid = field.type === 'checkbox' ? !field.checked : !field.value.trim();
      field.style.borderColor = invalid ? '#ef4444' : '';
      if (invalid) valid = false;
    });

    if (!valid) {
      showMsg(msgEl, 'Compila tutti i campi obbligatori (*).', 'error');
      return;
    }

    const emailField = form.querySelector('input[type="email"]');
    if (emailField && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailField.value)) {
      emailField.style.borderColor = '#ef4444';
      showMsg(msgEl, 'Inserisci un indirizzo email valido.', 'error');
      return;
    }

    const btn = form.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.textContent = 'Invio in corso…';
    btn.disabled = true;

    try {
      const data = Object.fromEntries(new FormData(form).entries());
      // Una checkbox spedisce la stringa "on"; il server pretende un booleano.
      data.privacy = form.querySelector('[name="privacy"]').checked;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      if (response.ok) {
        showMsg(msgEl, successText, 'success');
        form.reset();
        required.forEach(f => (f.style.borderColor = ''));
      } else {
        const err = await response.json().catch(() => ({}));
        showMsg(msgEl, err.error || 'Errore nell\'invio. Riprova o contattami direttamente.', 'error');
      }
    } catch {
      showMsg(msgEl, 'Errore di rete. Controlla la connessione e riprova.', 'error');
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  form.querySelectorAll('input, select, textarea').forEach(field => {
    field.addEventListener('input', () => { field.style.borderColor = ''; });
  });
}

bindForm(
  document.getElementById('contactForm'),
  '/api/contact',
  document.getElementById('formMessage'),
  'Messaggio inviato! Ti risponderò al più presto.',
);

bindForm(
  document.getElementById('bookingForm'),
  '/api/book',
  document.getElementById('bookingMessage'),
  'Richiesta inviata! Ti confermo data e ora entro 24h.',
);
```

Se `main.js` dichiarava in cima le costanti `contactForm` e `formMessage` e non le usa altrove, rimuoverle: le tue modifiche le hanno rese orfane.

- [ ] **Step 3: Aggiungere le regole data e lo studio condizionale**

Aggiungere in fondo a `public/js/main.js`:

```js
// Regole del campo data. Il browser sa applicare min/max ma non sa escludere
// i weekend: quelli vanno segnalati a mano, altrimenti l'utente scopre
// l'errore solo dopo aver compilato tutto il form.
(function setupBookingDate() {
  const dateInput = document.getElementById('bkDate');
  if (!dateInput) return;

  const romeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' }).format(new Date());
  const atNoon = iso => new Date(`${iso}T12:00:00Z`);

  const min = atNoon(romeToday());
  let lavorativi = 0;
  while (lavorativi < 2) {
    min.setUTCDate(min.getUTCDate() + 1);
    const dow = min.getUTCDay();
    if (dow !== 0 && dow !== 6) lavorativi++;
  }

  const max = atNoon(romeToday());
  max.setUTCMonth(max.getUTCMonth() + 6);

  dateInput.min = min.toISOString().slice(0, 10);
  dateInput.max = max.toISOString().slice(0, 10);

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const dow = atNoon(dateInput.value).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    dateInput.style.borderColor = weekend ? '#ef4444' : '';
    if (weekend) {
      showMsg(document.getElementById('bookingMessage'), 'Lo studio è chiuso nel weekend, scegli un giorno feriale.', 'error');
    }
  });
})();

// Lo studio non ha senso per una visita online.
(function setupStudioToggle() {
  const type = document.getElementById('bkType');
  const group = document.getElementById('bkStudioGroup');
  if (!type || !group) return;

  const sync = () => { group.hidden = type.value === 'controllo-online'; };
  type.addEventListener('change', sync);
  sync();
})();
```

- [ ] **Step 4: Verificare a mano nel browser**

```bash
npm run dev
```

Su `http://localhost:8788`, verificare nell'ordine:

1. Il campo data non permette di scegliere prima di dopodomani (o lunedì, se dopodomani cade nel weekend)
2. Scegliendo un sabato compare il messaggio rosso
3. Scegliendo "Visita di Controllo Online" il campo Studio sparisce
4. Inviando il form completo compare "Richiesta inviata!" e nel log di wrangler appare `[sendMail] simulato`
5. Il form contatti continua a funzionare come prima

Fermare wrangler.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: submit condiviso delle form e regole data del widget"
```

---

## Task 9: Test HTTP degli endpoint

**Files:**
- Create: `test/api.test.js`

- [ ] **Step 1: Scrivere i test**

Creare `test/api.test.js`:

```js
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
```

- [ ] **Step 2: Eseguire i test**

In un terminale: `npm run dev`
In un altro: `npm run test:api`

Expected: PASS, 11 test. Nessuna email reale parte, perché `RESEND_API_KEY` non è definita in locale — nel log di wrangler compaiono le righe `[sendMail] simulato`.

- [ ] **Step 3: Commit**

```bash
git add test/api.test.js
git commit -m "test: copertura HTTP dei due endpoint"
```

---

## Task 10: File statici e header

**Files:**
- Create: `public/robots.txt`, `public/sitemap.xml`, `_headers`

- [ ] **Step 1: Creare `public/robots.txt`**

```
User-agent: *
Allow: /
Sitemap: https://giuliadadalt.it/sitemap.xml
```

- [ ] **Step 2: Creare `public/sitemap.xml`**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://giuliadadalt.it/</loc><changefreq>monthly</changefreq><priority>1.0</priority></url>
  <url><loc>https://giuliadadalt.it/privacy</loc><changefreq>yearly</changefreq><priority>0.3</priority></url>
</urlset>
```

- [ ] **Step 3: Creare `public/_headers`**

Va dentro `public/`, non nella radice: Pages legge questo file dalla directory di output. Verificato in esecuzione — dalla radice `X-Frame-Options` e `Strict-Transport-Security` non vengono applicati.

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Referrer-Policy: strict-origin-when-cross-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains
```

- [ ] **Step 4: Verificare**

```bash
npm run dev
curl -s http://localhost:8788/robots.txt
curl -sI http://localhost:8788/ | grep -i "x-frame-options"
```

Expected: il robots mostra la sitemap; l'header `x-frame-options: DENY` è presente. Fermare wrangler.

- [ ] **Step 5: Commit**

```bash
git add public/robots.txt public/sitemap.xml _headers
git commit -m "feat: robots, sitemap statici e header di sicurezza"
```

---

## Task 11: Rimozione del backend Flask

**Files:**
- Delete: `app.py`, `requirements.txt`, `service-account-key.json`
- Modify: `public/css/style.css`, `README.md`, `.env.example`

- [ ] **Step 1: Eliminare i file Python**

```bash
git rm app.py requirements.txt
rm -f service-account-key.json
```

`service-account-key.json` non è tracciato da git (è in `.gitignore`), quindi va rimosso dal filesystem e basta.

- [ ] **Step 2: Rimuovere le regole CSS del vecchio widget**

In `public/css/style.css` eliminare tutte le regole i cui selettori iniziano con `.bw-`. Per trovarle:

```bash
grep -n "\.bw-" public/css/style.css
```

Non toccare `.bk-note` e `.hp-field`, aggiunte nel Task 7.

- [ ] **Step 3: Aggiornare `.env.example`**

Sostituire il contenuto con:

```
# Variabili di Pages (Settings -> Environment variables)
RESEND_API_KEY=
MAIL_TO=
MAIL_FROM=no-reply@send.giuliadadalt.it
```

- [ ] **Step 4: Riscrivere `README.md`**

````markdown
# Nutri Landing Page

Sito statico su Cloudflare Pages, con due Pages Functions per le form.

## Sviluppo locale

```bash
npm install
npm run dev
```

Il sito gira su `http://localhost:8788`. Senza `RESEND_API_KEY` l'invio email
viene simulato e loggato in console, quindi le form si possono provare senza
spedire niente.

## Test

```bash
npm run test:unit          # validazione e helper date, non serve il server
npm run dev                # in un terminale
npm run test:api           # in un altro
```

## Deploy

Push su `main`: Cloudflare Pages fa il deploy da solo.

Impostazioni del progetto Pages:
- Framework preset: `None`
- Build command: vuoto
- Build output directory: `public`

Variabili d'ambiente: `RESEND_API_KEY` (secret), `MAIL_TO`, `MAIL_FROM`.
````

- [ ] **Step 5: Verificare che non resti niente di rotto**

```bash
grep -rn "booking.js\|/api/availability\|url_for" public/ || echo "nessun riferimento residuo"
npm run test:unit
```

Expected: nessun riferimento residuo, unit test verdi.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: rimuove il backend Flask, il tunnel e il CSS del vecchio widget"
```

---

## Task 12: Deploy e cutover

Nessun codice. L'ordine conta: il sito in produzione resta servito dal tunnel fino all'ultimo passo.

- [ ] **Step 1: Creare il progetto Pages**

Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git, selezionare `ferra12/nutri_landing_page`. Framework preset `None`, build command vuoto, output directory `public`.

- [ ] **Step 2: Configurare Resend**

Creare l'account, aggiungere `giuliadadalt.it` come dominio e inserire i record DNS che Resend indica. Il dominio è già su Cloudflare, quindi la propagazione è rapida. Generare la API key.

- [ ] **Step 3: Impostare le variabili d'ambiente su Pages**

Settings → Environment variables, ambiente Production:
- `RESEND_API_KEY` come **secret**
- `MAIL_TO` con la casella che deve ricevere le richieste
- `MAIL_FROM` con `no-reply@send.giuliadadalt.it` (sottodominio verificato su Resend, non la radice)

- [ ] **Step 4: Verificare sull'URL di anteprima**

Sul dominio `*.pages.dev` assegnato da Pages, con il tunnel ancora attivo:

```bash
BASE_URL=https://<progetto>.pages.dev npm run test:api
```

Expected: 11 test verdi. **Attenzione:** qui `RESEND_API_KEY` è definita, quindi questi test spediscono email reali. Eseguirli una volta sola e ripulire poi la casella.

Verificare inoltre a mano nel browser: entrambe le form inviano, `/privacy` si apre, `curl -sI` mostra gli header di sicurezza.

- [ ] **Step 5: Spostare il dominio**

Pages → Custom domains → aggiungere `giuliadadalt.it`. Attendere che il certificato sia attivo e che il dominio risponda da Pages.

- [ ] **Step 6: Spegnere il tunnel**

Solo ora, e solo dopo aver verificato che `https://giuliadadalt.it` risponda da Pages: fermare `cloudflared` e rimuovere la route DNS del tunnel.

- [ ] **Step 7: Aggiungere la regola di rate limit**

Security → WAF → Rate limiting rules: una regola su `URI Path starts with /api/`, 10 richieste al minuto per IP, azione Block.

- [ ] **Step 8: Merge su main**

```bash
git checkout main
git merge docs/booking-widget-pages-spec
```

---

## Rollback

Finché il Task 12 Step 6 non è eseguito il tunnel è ancora attivo: basta ripuntare il DNS e il sito torna su Flask. Dopo, `app.py` e `requirements.txt` vanno recuperati dalla storia git:

```bash
git log --oneline -- app.py
git show <commit-prima-del-task-11>:app.py > app.py
git show <commit-prima-del-task-11>:requirements.txt > requirements.txt
```

È il motivo per cui la verifica al Task 12 Step 4 non va abbreviata.

---

## Fuori scope

- `ADR-001-architettura-app.md` descrive lo stack Flask come architettura corrente e resterà obsoleto finché non viene riscritto. Decisione separata.
- Email di conferma automatica al paziente: una seconda chiamata a `sendMail()` in `functions/api/book.js`.
- Disponibilità reale da Google Calendar.
- Turnstile, da aggiungere solo se lo spam si presenta davvero.
