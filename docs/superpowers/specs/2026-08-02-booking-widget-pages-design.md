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

Il codice condiviso sta in `lib/`, fuori da `functions/`, dove ogni file
diventa una route. Anche `functions/_lib/` funzionerebbe — Pages esclude dal
routing i percorsi con prefisso underscore — ma tenerlo fuori rende la
separazione esplicita e non dipende da quella convenzione.

`robots.txt` e `sitemap.xml` diventano file statici con URL assoluta fissa su
`https://giuliadadalt.it`, al posto delle route Flask che le generavano da
`request.url_root`.

Gli header di sicurezza oggi impostati da `@app.after_request` si spostano nel
file `_headers`: `X-Content-Type-Options`, `X-Frame-Options`,
`Referrer-Policy`, `Strict-Transport-Security`.

### Contratto HTTP

Invariato rispetto a oggi, così il frontend resta indipendente da chi risponde
e una futura versione Flask resta possibile senza modifiche al client.

```
POST /api/book
  { nome, cognome, email, telefono, type, studio, date, fascia, note, privacy }
  → 200 { ok: true }
  → 400 | 422 | 502  { error: "messaggio in italiano" }

POST /api/contact
  { nome, cognome, email, telefono, oggetto, messaggio, privacy }
  → 200 { ok: true }
  → 400 | 422 | 502  { error: "messaggio in italiano" }
```

I campi di `/api/contact` restano quelli di oggi, ma i codici di errore si
allineano alla tabella sotto: l'implementazione Flask risponde 500 su
fallimento invio e 503 se SMTP non è configurato, qui è **502 in entrambi i
casi**. È l'unico scostamento voluto dal comportamento attuale.

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

[ ] Ho letto e accetto la Privacy Policy *

                                    [ Richiedi appuntamento ]

ℹ Riceverai conferma con data e ora esatte entro 24h.
```

`<input type="date">` porta calendario, localizzazione e picker mobile
direttamente dal browser. `min` è impostato a **+2 giorni lavorativi**, non a
domani: promettere conferma entro 24h su una richiesta per l'indomani mattina
è una promessa che non si può mantenere.

Il browser però **non sa escludere i weekend** — `min` e `max` esistono, la
disabilitazione dei singoli giorni no. Servono tre righe di JS sull'evento
`change` che segnalano subito la scelta di sabato o domenica, invece di far
scoprire l'errore con un 422 dopo il submit.

La checkbox privacy è obbligatoria, com'è già oggi in entrambe le form
([index.html:561](../../../templates/index.html) per il booking,
[index.html:627](../../../templates/index.html) per i contatti).

Campi e valori ammessi:

- `type`: `prima-visita`, `controllo`, `controllo-online`
- `studio`: `studio-1`, `studio-2` — richiesto solo se `type` non è
  `controllo-online`, altrimenti il campo è nascosto e il valore ignorato
- `fascia`: `mattina`, `pomeriggio`
- `privacy`: deve essere `true`

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
testo, regex email con limite di 254 caratteri. `note` segue lo stesso limite
di `messaggio` nel form contatti, 2000 caratteri.

Regole nuove:

- `date` in formato ISO, non prima del minimo consentito, non sabato o
  domenica, entro 6 mesi
- `type` e `fascia` verificati contro whitelist
- `studio` verificato contro whitelist solo se `type` non è `controllo-online`
- `privacy` deve essere esattamente `true`, altrimenti 422

### Nota sul consenso privacy

Oggi `app.py` **non verifica il campo `privacy`** in nessuno dei due endpoint:
il controllo esiste solo lato client in `booking.js` e `main.js`, quindi è
aggirabile con una POST diretta. Trattandosi di prenotazioni sanitarie, questo
design chiude il buco invece di ereditarlo — il consenso diventa una regola di
validazione server-side come tutte le altre.

## Errori

Identici per entrambi gli endpoint.

| Caso | Codice | Comportamento |
|---|---|---|
| JSON malformato | 400 | messaggio generico |
| Validazione fallita, consenso privacy incluso | 422 | messaggio specifico sul campo |
| Resend non risponde o fallisce | 502 | messaggio con indirizzo email diretto come fallback |
| Honeypot compilato | 200 | `{ ok: true }`, nessuna email inviata |

Il fallback sul 502 è deliberato: una richiesta di appuntamento persa in
silenzio è un paziente perso.

Il 200 sull'honeypot è altrettanto deliberato: un bot che riceve un errore
capisce di essere stato individuato e riprova cambiando strategia. Un
successo finto lo lascia convinto di aver funzionato.

## Anti-spam

Campo honeypot nascosto, più una regola WAF di rate limit su `/api/*` — il
piano Cloudflare free ne include una. Sostituisce `flask-limiter`, che
dipendeva da uno stato in-process inesistente su Workers.

Turnstile va aggiunto solo se lo spam si presenta davvero.

## Test

Un unico file `test/forms.test.js`: otto payload inviati a un base URL
parametrico.

1. Payload valido → 200 `{ ok: true }`
2. Email invalida → 422
3. Campo obbligatorio mancante → 422
4. Data prima del minimo consentito → 422
5. Data nel weekend → 422
6. `privacy` assente o `false` → 422
7. `controllo-online` senza `studio` → 200 (lo studio non è richiesto)
8. Honeypot compilato → 200 senza invio email

Gira con `node --test`, solo `assert`, nessun framework. Base URL
parametrico: `wrangler pages dev` in locale, oppure la produzione.

## Configurazione del deploy

Cloudflare Pages rileva `requirements.txt` e tenta un build Python. Nelle
impostazioni del progetto: framework preset `None`, build command vuoto,
output directory `public`.

Il repo non ha ancora un `package.json`. Ne serve uno minimo per `wrangler`
(dipendenza di sviluppo) e per lo script di test; nessuna dipendenza a runtime
— le Functions usano solo `fetch` e le API standard di Workers.

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
