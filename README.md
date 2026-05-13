# Nutri Landing Page

## Deploy online con Cloudflare Tunnel

### Prerequisiti
- `cloudflared` installato e tunnel `nutri-tunnel` già configurato
- Python + dipendenze installate (`pip install -r requirements.txt`)

### Avvio

Aprire **due terminali**:

**Terminale 1 — Flask app:**
```bash
python app.py
```

**Terminale 2 — Cloudflare Tunnel:**
```bash
cloudflared tunnel run nutri-tunnel
```

Flask gira su `localhost:5000`, Cloudflare espone il sito su HTTPS pubblico.

---

### Setup iniziale tunnel (solo prima volta)

```bash
python app.py

cloudflared tunnel route dns nutri-tunnel tuodominio.com
```

Config `~/.cloudflared/config.yml`:
```yaml
tunnel: <TUNNEL_ID>
ingress:
  - hostname: tuodominio.com
    service: http://localhost:5000
  - service: http_status:404
```
