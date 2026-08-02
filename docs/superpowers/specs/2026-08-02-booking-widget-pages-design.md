# Widget prenotazione semplificato su Cloudflare Pages

Data: 2026-08-02
Stato: approvato, pronto per il piano di implementazione

## Problema

Il sito gira oggi come app Flask esposta da un tunnel Cloudflare, quindi
richiede un PC acceso. L'obiettivo è servirlo da Cloudflare Pages.

Cloudflare Pages non esegue Python. Il widget di prenotazione attuale dipende
da `google-api-python-client` per leggere la disponibilità e creare eventi, e
da `smtplib` per le email: nessuna delle due cose esiste in un runtime
Workers. Il widget è inoltre già disattivato — il blocco `bookingWidget` in
`templates/index.html` è commentato e `booking.js` esce subito — quindi
`/api/availability` e `/api/book` sono codice morto.

Serve un widget che funzioni su Pages e che sia più semplice da mantenere di
quello originale.

## Decisioni

Quattro scelte, prese esplicitamente, che determinano tutto il resto.

**Nessuna lettura del Google Calendar.** Il widget raccoglie una richiesta di
appuntamento; Giulia conferma a mano data e ora esatte. Elimina la firma JWT
RS256 con WebCrypto, il secret della service account e la gestione dei
conflitti di doppia prenotazione.

**Data più fascia oraria.** Il paziente indica un giorno preferito e una
fascia (mattina o pomeriggio), non uno slot preciso.

**Una sola email, verso Giulia.** Il paziente non riceve acknowledgment
automatico; la pagina mostra un messaggio di successo.

**Resend come trasporto**, chiamato da Pages Functions. Mittente sul dominio
proprio, template sotto controllo, e la porta resta aperta per aggiungere in
futuro l'email al paziente senza cambiare fornitore.

## Architettura

```
public/                    unica fonte di verità, servita da Pages
  index.html               widget + form contatti
  privacy.html
  css/style.css
  js/main.js               submit di entrambe le form
  img/profilo.jpeg
  robots.txt
  sitemap.xml
_headers                   header di sicurezza
lib/form.js                validate() + sendMail() condivisi
functions/api/book.js
functions/api/contact.js
```

Il codice condiviso sta in `lib/` e non in `functions/`, perché ogni file
sotto `functions/` viene esposto come route.

`robots.txt` e `sitemap.xml` diventano file statici con URL assoluta fissa,
al posto delle route Flask che le generavano da `request.url_root`.

Gli header di sicurezza oggi impostati da `@app.after_request` si spostano nel
file `_headers`: `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Strict-Transport-Security`.

### Contratto HTTP

Invariato rispetto a oggi, così il frontend resta indipendente da chi risponde
e una futura versione Flask resta possibile senza modifiche al client.

```
POST /api/book
  { nome, cognome, email, telefono, type, studio, date, fascia, note }
  → 200 { ok: true }
  → 400 | 422 | 502  { error: "messaggio in italiano" }

POST /api/contact
  invariato rispetto all'implementazione Flask attuale
```

### Modulo condiviso `lib/form.js`

Due funzioni, usate da entrambe le Functions:

- `validate(data, schema)` → `{ ok, errors }`
- `sendMail({ subject, text, replyTo })` → chiamata all'API Resend

Ogni Function si riduce così a circa 25 righe: parse, validate, sendMail,
risposta.

## Widget

Markup nuovo, non un recupero del blocco commentato. Quattro controlli nativi
al posto delle griglie di bottoni con stato JavaScript.

```
Tipo visita  [Prima visita ▾]    Studio [Spresiano ▾]
Giorno       [ 12/08/2026 📅 ]   Fascia [Mattina (9-13) ▾]

Nome*  Cognome*  Email*  Telefono   Note

                                    [ Richiedi appuntamento ]

ℹ Riceverai conferma con data e ora esatte entro 24h.
```

`<input type="date">` con `min` impostato a domani porta calendario,
localizzazione e picker mobile direttamente dal browser.

Campi e valori ammessi:

- `type`: `prima-visita`, `controllo`, `controllo-online`
- `studio`: `studio-1`, `studio-2`
- `fascia`: `mattina`, `pomeriggio`

La nota "conferma entro 24h" è parte del design, non decorazione: è ciò che
rende esplicito al paziente che sta inviando una richiesta e non prenotando
uno slot garantito.

`static/js/booking.js` viene eliminato per intero (circa 330 righe). La logica
di submit diventa circa 40 righe in `main.js`, sulla stessa forma di quella
che già gestisce il form contatti.

## Validazione

Server-side sempre; il client valida solo per esperienza d'uso e non è mai
fonte di verità.

Regole portate invariate da `app.py`: trim e lunghezze massime sui campi di
testo, regex email con limite di 254 caratteri.

Regole nuove:

- `date` in formato ISO, non nel passato, non sabato o domenica, entro 6 mesi
- `type`, `studio` e `fascia` verificati contro whitelist

## Errori

| Caso | Codice | Comportamento |
|---|---|---|
| JSON malformato | 400 | messaggio generico |
| Validazione fallita | 422 | messaggio specifico sul campo |
| Resend non risponde o fallisce | 502 | messaggio con indirizzo email diretto come fallback |

Il fallback sul 502 è deliberato: una richiesta di appuntamento persa in
silenzio è un paziente perso.

## Anti-spam

Campo honeypot nascosto, più una regola WAF di rate limit su `/api/*` — il
piano Cloudflare free ne include una. Sostituisce `flask-limiter`, che
dipendeva da uno stato in-process inesistente su Workers.

Turnstile va aggiunto solo se lo spam si presenta davvero.

## Test

Un unico file `test/forms.test.js`: sei payload inviati a un base URL
parametrico.

1. Payload valido → 200
2. Email invalida → 422
3. Campo obbligatorio mancante → 422
4. Data nel passato → 422
5. Data nel weekend → 422
6. Honeypot compilato → richiesta scartata

Solo `assert`, nessun framework. Gira contro `wrangler pages dev` in locale e
contro la produzione cambiando il base URL.

## Configurazione del deploy

Cloudflare Pages rileva `requirements.txt` e tenta un build Python. Nelle
impostazioni del progetto: framework preset `None`, build command vuoto,
output directory `public`.

Secret di Pages: `RESEND_API_KEY`. Il dominio è già su Cloudflare, quindi la
verifica DNS richiesta da Resend è immediata.

## Codice eliminato

- `static/js/booking.js` per intero
- le regole CSS `bw-*` in `static/css/style.css`
- il blocco HTML commentato del widget in `templates/index.html`
- in `app.py`: `get_calendar_service()`, `DURATIONS`, le route
  `/api/availability` e `/api/book`, l'intero blocco `smtplib`
- da `requirements.txt`: `google-api-python-client`, `google-auth`,
  `flask-limiter`
- `service-account-key.json` non ha più alcun uso

La cartella `templates/` sparisce: i file non contengono alcun costrutto Jinja
e si spostano in `public/` invariati.

Nota separata, non parte di questo lavoro: `ADR-001-architettura-app.md`
descrive lo stack Flask come architettura corrente e andrà aggiornato o
sostituito una volta completata la migrazione.

## Estensioni future

Nessuna delle due richiede di rifare la form.

- Acknowledgment al paziente: una seconda chiamata a `sendMail()`
- Disponibilità reale: lettura freebusy da Google Calendar, che riempie la
  select della fascia con slot effettivi
