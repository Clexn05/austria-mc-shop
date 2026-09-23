# Austria-MC Buy Shop — Cloudflare D1 Edition

Diese Version benötigt **keine externe MySQL-Datenbank und kein Hyperdrive**.
Produkte, Bestellungen und Fulfillment-Status werden direkt in Cloudflare D1 gespeichert.

## Enthalten

- Shop-Frontend im Austria-MC Stil
- Cloudflare Worker API
- Cloudflare D1 Datenbank
- vier kaufbare Ränge:
  - Spüla+ — 5,00 €
  - VIP — 10,00 €
  - VIP+ — 12,00 €
  - Builder — 25,00 €
- LuckPerms-Rechte/Command-Hinweise
- Mollie Checkout für PayPal, paysafecard und Klarna
- Webhook-Verifikation gegen die Mollie API
- Fulfillment-API für das spätere Bungee/LuckPerms-Plugin

## 1. D1 Datenbank erstellen

Im Cloudflare Dashboard:

Storage & databases → D1 → Create database

Name:

`austria-mc-shop`

Danach die **Database ID** kopieren.

## 2. wrangler.jsonc anpassen

In `wrangler.jsonc`:

```json
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "austria-mc-shop",
    "database_id": "DEINE-D1-DATABASE-ID"
  }
]
```

## 3. Schema importieren

Lokal im Projektordner:

```bash
npm install
npx wrangler login
npx wrangler d1 execute austria-mc-shop --remote --file=./schema.sql
```

Dadurch werden Tabellen, Produkte und Permissions angelegt.

Alternativ kannst du `schema.sql` im Cloudflare-D1-Dashboard über die SQL-Konsole ausführen.

## 4. Secrets setzen

Im Worker unter Settings → Variables and Secrets:

- `MOLLIE_API_KEY` als Secret
- `FULFILLMENT_TOKEN` als Secret

Für Mollie zuerst einen Test-Key verwenden.

`STORE_BASE_URL` ist bereits auf `https://buy.austria-mc.net` gesetzt.

## 5. Worker deployen

GitHub mit dem Worker verbinden.

Deploy command:

```bash
npx wrangler deploy --config wrangler.jsonc
```

Build command kann leer bleiben.

## 6. buy.austria-mc.net verbinden

Beim Worker:

Settings → Domains & Routes → Add → Custom Domain

`buy.austria-mc.net`

Falls die Domain noch am alten Website-Worker hängt, sie dort zuerst entfernen.

## 7. Zahlung

Die verwendeten Mollie Method-IDs sind:

- `paypal`
- `paysafecard`
- `klarna`

Diese Methoden müssen in deinem Mollie-Profil aktiviert sein.

## 8. Bungee-Fulfillment

Das spätere Bungee-Plugin ruft mit

`Authorization: Bearer <FULFILLMENT_TOKEN>`

folgendes ab:

`GET /api/fulfillment/pending`

Nach erfolgreicher LuckPerms-Zuweisung:

`POST /api/fulfillment/<ORDER-ID>/complete`

Body:

```json
{"success":true,"message":"LuckPerms group applied"}
```

## Wichtig vor Livegang

- Impressum ausfüllen
- Datenschutz ausfüllen
- AGB ausfüllen
- Testkäufe mit PayPal, paysafecard und Klarna durchführen
- Live-Mollie-Key erst nach erfolgreichem Test setzen
- Rückerstattungen/Chargebacks organisatorisch definieren
- danach Bungee-LuckPerms-Fulfillment anschließen
