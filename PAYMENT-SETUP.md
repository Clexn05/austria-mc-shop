# Austria-MC Shop – direkte Zahlungen ohne Mollie

Diese Version entfernt Mollie aus dem Worker. Der Shop kann direkt mit **PayPal**, **Klarna** und **paysafecard** sprechen.

## 0. Bestehende D1-Datenbank einmal migrieren

Da deine Datenbank bereits existiert, zuerst in Cloudflare D1 → `austria-mc-shop` → Console den Inhalt von

`migrate-direct-payments.sql`

genau **einmal** ausführen.

Die vorhandenen Produkte, Permissions und Bestellungen bleiben erhalten. Die alten `mollie_payment_id`-Felder werden nicht gelöscht, aber nicht mehr verwendet.

## 1. D1-ID in wrangler.jsonc

In `wrangler.jsonc` deine bestehende D1-ID wieder eintragen:

```json
"database_id": "DEINE-D1-ID"
```

## 2. Cloudflare Worker Secrets

Im Worker `austria-mc-shop` unter **Settings → Variables and Secrets** die folgenden Werte als **Secrets** hinterlegen.

### PayPal

```text
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID
```

`PAYPAL_ENV` steht im `wrangler.jsonc` zunächst auf `sandbox`.

Für Live später:

```text
PAYPAL_ENV = live
```

Webhook-URL:

```text
https://buy.austria-mc.net/api/paypal/webhook
```

Empfohlene Events:

```text
CHECKOUT.ORDER.APPROVED
PAYMENT.CAPTURE.COMPLETED
PAYMENT.CAPTURE.DENIED
CHECKOUT.ORDER.VOIDED
```

### Klarna

```text
KLARNA_USERNAME
KLARNA_PASSWORD
```

`KLARNA_ENV` steht zunächst auf `playground`.

Optional, falls Klarna für deinen Merchant einen anderen regionalen API-Endpunkt vorgibt:

```text
KLARNA_API_BASE
```

Die Integration verwendet Klarna Payments + Hosted Payment Page und `PLACE_ORDER`. Nach erfolgreicher Bestellung wird der digitale Rang serverseitig erfasst und die Klarna-Order direkt gecaptured.

### paysafecard

```text
PAYSAFECARD_API_KEY
```

`PAYSAFECARD_ENV` steht zunächst auf `test`.

Optional, wenn Paysafe dir einen abweichenden Merchant-Endpunkt gibt:

```text
PAYSAFECARD_API_BASE
```

Die Integration macht: Payment anlegen → Kunde zu paysafecard → Status serverseitig prüfen → AUTHORIZED Payment capturen → erst danach Bestellung auf `PAID` setzen.

**Wichtig:** paysafecard verlangt bei neuen Merchant-Integrationen Test/UAT und kann für Produktion IP-Freigaben verlangen. Kläre mit Paysafe, ob dein Cloudflare-Workers-Setup für die Produktionsfreigabe akzeptiert wird.

## 3. Fulfillment Secret

Für das spätere Bungee/LuckPerms-Plugin:

```text
FULFILLMENT_TOKEN
```

als langes zufälliges Secret setzen.

## 4. Deployment

Cloudflare Build-Einstellungen:

```text
Root directory: leer
Build command: leer
Deploy command: npx wrangler deploy --config ./wrangler.jsonc
Production branch: main
```

## 5. Automatische Anzeige der Zahlungsmethoden

Der Browser ruft `/api/payment-methods` auf.

Eine Zahlungsart ist nur auswählbar, wenn die zugehörigen Secrets gesetzt sind. Du kannst deshalb zuerst nur PayPal konfigurieren; Klarna und paysafecard erscheinen bis dahin deaktiviert.

## 6. Sicherheitslogik

Der Browser bestimmt weder Preis noch LuckPerms-Gruppe. Beides kommt aus D1.

Ein Auftrag wird erst `PAID`, wenn der Worker die Zahlung beim jeweiligen Anbieter serverseitig geprüft bzw. gecaptured hat. Erst dann taucht die Bestellung unter

```text
GET /api/fulfillment/pending
```

für das spätere Bungee-Plugin auf.
