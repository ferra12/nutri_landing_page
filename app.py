import os
import logging
import smtplib
from dotenv import load_dotenv
load_dotenv()
from datetime import date, datetime, time, timedelta
from email.message import EmailMessage
from zoneinfo import ZoneInfo

from flask import Flask, render_template, request, jsonify
from google.oauth2 import service_account
from googleapiclient.discovery import build
import googleapiclient.discovery
googleapiclient.discovery.logger.setLevel("ERROR")

app = Flask(__name__, static_url_path="", static_folder="static")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# ── Config ────────────────────────────────────────────────────────────────────
SMTP_HOST     = os.environ.get("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", 587))
SMTP_USER     = os.environ.get("SMTP_USER", "")
SMTP_PASS     = os.environ.get("SMTP_PASS", "")
CONTACT_EMAIL = os.environ.get("CONTACT_EMAIL", SMTP_USER)

GOOGLE_CALENDAR_ID = os.environ.get("GOOGLE_CALENDAR_ID", "giuliadadalt.biologa@gmail.com")
GOOGLE_SA_FILE     = os.environ.get("GOOGLE_SA_FILE", "service-account-key.json")
CALENDAR_SCOPES    = ["https://www.googleapis.com/auth/calendar"]

ROME_TZ    = ZoneInfo("Europe/Rome")
WORK_START = time(9, 0)
WORK_END   = time(18, 0)
DURATIONS  = {"prima-visita": 60, "controllo": 30, "controllo-online": 30}


# ── Google Calendar ───────────────────────────────────────────────────────────
def get_calendar_service():
    if not os.path.exists(GOOGLE_SA_FILE):
        return None
    try:
        creds = service_account.Credentials.from_service_account_file(
            GOOGLE_SA_FILE, scopes=CALENDAR_SCOPES
        )
        return build("calendar", "v3", credentials=creds)
    except Exception as exc:
        logger.error("Errore init Calendar service: %s", exc)
        return None


# ── Routes ────────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    resp = app.make_response(render_template("index.html"))
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    return resp


@app.route("/api/availability")
def availability():
    week_param = request.args.get("week")
    appt_type  = request.args.get("type", "prima-visita")
    duration   = DURATIONS.get(appt_type, 60)

    today = date.today()
    if week_param:
        try:
            anchor     = date.fromisoformat(week_param)
            week_start = anchor - timedelta(days=anchor.weekday())
        except ValueError:
            week_start = today - timedelta(days=today.weekday())
    else:
        week_start = today - timedelta(days=today.weekday())

    week_end = week_start + timedelta(days=5)  # sabato

    # Recupera periodi occupati da Google Calendar
    busy_ranges = []
    service = get_calendar_service()
    if service:
        try:
            time_min = datetime.combine(week_start, time(0, 0), tzinfo=ROME_TZ).isoformat()
            time_max = datetime.combine(week_end,   time(0, 0), tzinfo=ROME_TZ).isoformat()
            result = service.freebusy().query(body={
                "timeMin":   time_min,
                "timeMax":   time_max,
                "items":     [{"id": GOOGLE_CALENDAR_ID}],
                "timeZone":  "Europe/Rome",
            }).execute()
            for b in result["calendars"].get(GOOGLE_CALENDAR_ID, {}).get("busy", []):
                bs = datetime.fromisoformat(b["start"].replace("Z", "+00:00")).astimezone(ROME_TZ)
                be = datetime.fromisoformat(b["end"].replace("Z", "+00:00")).astimezone(ROME_TZ)
                busy_ranges.append((bs, be))
        except Exception as exc:
            logger.error("Errore freebusy: %s", exc)

    # Genera slot Lun–Ven
    now   = datetime.now(ROME_TZ)
    step  = timedelta(minutes=duration)
    slots = []

    for offset in range(5):
        day      = week_start + timedelta(days=offset)
        slot_dt  = datetime.combine(day, WORK_START, tzinfo=ROME_TZ)
        day_end  = datetime.combine(day, WORK_END,   tzinfo=ROME_TZ)

        while slot_dt + step <= day_end:
            slot_end  = slot_dt + step
            available = (
                slot_dt > now + timedelta(minutes=30) and
                not any(slot_dt < be and slot_end > bs for bs, be in busy_ranges)
            )
            slots.append({
                "date":      day.isoformat(),
                "time":      slot_dt.strftime("%H:%M"),
                "available": available,
            })
            slot_dt += step

    return jsonify({
        "week_start": week_start.isoformat(),
        "slots":      slots,
        "duration":   duration,
    })


@app.route("/api/book", methods=["POST"])
def book():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Dati non validi."}), 400

    nome      = data.get("nome", "").strip()
    cognome   = data.get("cognome", "").strip()
    email_val = data.get("email", "").strip()
    telefono  = data.get("telefono", "").strip()
    appt_type = data.get("type", "prima-visita")
    studio    = data.get("studio", "").strip()
    date_str  = data.get("date", "").strip()
    time_str  = data.get("time", "").strip()

    if not all([nome, cognome, email_val, date_str, time_str]):
        return jsonify({"error": "Campi obbligatori mancanti."}), 422

    duration = DURATIONS.get(appt_type, 60)
    try:
        h, m     = (int(x) for x in time_str.split(":"))
        dt_start = datetime.combine(date.fromisoformat(date_str), time(h, m), tzinfo=ROME_TZ)
    except (ValueError, TypeError):
        return jsonify({"error": "Data o orario non valido."}), 422

    dt_end     = dt_start + timedelta(minutes=duration)
    tipo_label = {"prima-visita": "Prima Visita Nutrizionale", "controllo": "Visita di Controllo", "controllo-online": "Visita di Controllo Online"}.get(appt_type, "Visita")

    # Crea evento su Google Calendar
    service = get_calendar_service()
    if not service:
        return jsonify({"error": "Servizio calendario non disponibile."}), 503

    try:
        event = {
            "summary":     f"{tipo_label} – {nome} {cognome}",
            "description": f"Email: {email_val}\nTelefono: {telefono or '—'}\nStudio: {studio or '—'}",
            "start": {"dateTime": dt_start.isoformat(), "timeZone": "Europe/Rome"},
            "end":   {"dateTime": dt_end.isoformat(),   "timeZone": "Europe/Rome"},
            "reminders": {
                "useDefault": False,
                "overrides": [
                    {"method": "email", "minutes": 1440},
                    {"method": "popup", "minutes": 30},
                ],
            },
        }
        service.events().insert(calendarId=GOOGLE_CALENDAR_ID, body=event).execute()
        logger.info("Evento creato: %s %s – %s", nome, cognome, dt_start)
    except Exception as exc:
        logger.error("Errore creazione evento: %s", exc)
        return jsonify({"error": "Errore nella prenotazione. Riprova più tardi."}), 500

    # Invia email
    if SMTP_USER and SMTP_PASS and CONTACT_EMAIL:
        date_it = dt_start.strftime("%d/%m/%Y")
        time_it = dt_start.strftime("%H:%M")
        try:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(SMTP_USER, SMTP_PASS)

                msg_nutri = EmailMessage()
                msg_nutri["Subject"]   = f"Nuova prenotazione – {tipo_label} – {nome} {cognome} il {date_it}"
                msg_nutri["From"]      = SMTP_USER
                msg_nutri["To"]        = CONTACT_EMAIL
                msg_nutri["Reply-To"]  = email_val
                msg_nutri.set_content(
                    f"Tipo: {tipo_label}\nNome: {nome} {cognome}\n"
                    f"Email: {email_val}\nTelefono: {telefono or '—'}\n"
                    f"Data: {date_it}\nOrario: {time_it}\n"
                )
                smtp.send_message(msg_nutri)

                msg_paz = EmailMessage()
                msg_paz["Subject"] = f"Prenotazione confermata – {tipo_label}"
                msg_paz["From"]    = SMTP_USER
                msg_paz["To"]      = email_val
                msg_paz.set_content(
                    f"Ciao {nome},\n\nla tua prenotazione è confermata.\n\n"
                    f"Tipo: {tipo_label}\nData: {date_it}\nOrario: {time_it}\n\n"
                    f"Per qualsiasi necessità puoi rispondere a questa email.\n\n"
                    f"A presto,\nGiulia Da Dalt\nBiologa Nutrizionista\n"
                )
                smtp.send_message(msg_paz)

            logger.info("Email inviate per prenotazione di %s", email_val)
        except Exception as exc:
            logger.error("Errore invio email: %s", exc)

    return jsonify({"ok": True}), 200


@app.route("/api/contact", methods=["POST"])
def contact():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Dati non validi."}), 400

    nome      = data.get("nome", "").strip()
    cognome   = data.get("cognome", "").strip()
    email     = data.get("email", "").strip()
    telefono  = data.get("telefono", "").strip()
    servizio  = data.get("servizio", "").strip()
    messaggio = data.get("messaggio", "").strip()

    if not all([nome, cognome, email, messaggio]):
        return jsonify({"error": "Campi obbligatori mancanti."}), 422

    if SMTP_USER and SMTP_PASS and CONTACT_EMAIL:
        try:
            with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as smtp:
                smtp.ehlo()
                smtp.starttls()
                smtp.login(SMTP_USER, SMTP_PASS)

                msg_nutri = EmailMessage()
                msg_nutri["Subject"]  = f"Nuovo messaggio – {nome} {cognome}"
                msg_nutri["From"]     = SMTP_USER
                msg_nutri["To"]       = CONTACT_EMAIL
                msg_nutri["Reply-To"] = email
                msg_nutri.set_content(
                    f"Nome: {nome} {cognome}\nEmail: {email}\n"
                    f"Telefono: {telefono or '—'}\nServizio: {servizio or '—'}\n\n"
                    f"Messaggio:\n{messaggio}\n"
                )
                smtp.send_message(msg_nutri)

                msg_paz = EmailMessage()
                msg_paz["Subject"] = "Ho ricevuto il tuo messaggio – Giulia Da Dalt Biologa Nutrizionista"
                msg_paz["From"]    = SMTP_USER
                msg_paz["To"]      = email
                msg_paz.set_content(
                    f"Ciao {nome},\n\nho ricevuto il tuo messaggio e ti risponderò entro 24–48 ore.\n\n"
                    f"A presto,\nGiulia Da Dalt\nBiologa Nutrizionista\n"
                )
                smtp.send_message(msg_paz)

            logger.info("Email inviate per messaggio di %s", email)
        except Exception as exc:
            logger.error("Errore invio email: %s", exc)

    return jsonify({"ok": True}), 200


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
