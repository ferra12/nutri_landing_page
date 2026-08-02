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

Il file `_headers` sta in `public/`, perché Pages lo legge dalla directory di
output e non dalla radice del repository.

Variabili d'ambiente: `RESEND_API_KEY` (secret), `MAIL_TO`, `MAIL_FROM`.
