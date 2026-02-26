import os
import logging
import smtplib
from email.message import EmailMessage

from flask import Flask, render_template, request, jsonify

app = Flask(__name__, static_url_path="", static_folder="static")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Config ────────────────────────────────────────────────────────────────────
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASS     = os.environ.get("SMTP_PASS", "")
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", SMTP_USER)


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/contact", methods=["POST"])
def contact():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Dati non validi."}), 400

    nome     = data.get("nome", "").strip()
    cognome  = data.get("cognome", "").strip()
    email    = data.get("email", "").strip()
    telefono = data.get("telefono", "").strip()
    servizio = data.get("servizio", "").strip()
    messaggio = data.get("messaggio", "").strip()

    if not all([nome, cognome, email, messaggio]):
        return jsonify({"error": "Campi obbligatori mancanti."}), 422

    # ── Send email ────────────────────────────────────────────────────────────
    if SMTP_USER and SMTP_PASS and CONTACT_EMAIL:
        try:
            msg = EmailMessage()
            msg["Subject"] = f"Nuovo contatto dal sito – {nome} {cognome}"
            msg["From"]    = SMTP_USER
            msg["To"]      = CONTACT_EMAIL
            msg["Reply-To"] = email

            body = (
                f"Nome: {nome} {cognome}\n"
                f"Email: {email}\n"
                f"Telefono: {telefono or '—'}\n"
                f"Servizio: {servizio or '—'}\n\n"
                f"Messaggio:\n{messaggio}\n"
            )
            msg.set_content(body)

            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(SMTP_USER, SMTP_PASS)
                smtp.send_message(msg)

            logger.info("Email inviata da %s", email)
        except Exception as exc:
            logger.error("Errore invio email: %s", exc)
            return jsonify({"error": "Errore nell'invio. Riprova più tardi."}), 500
    else:
        # Log to stdout when email is not configured (development / preview)
        logger.warning("SMTP non configurato. Messaggio ricevuto da %s %s <%s>", nome, cognome, email)
        logger.info("Messaggio: %s", messaggio)

    return jsonify({"ok": True}), 200


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=False)
