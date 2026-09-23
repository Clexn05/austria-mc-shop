# Austria-MC Shop v3 — GitHub + Cloudflare Worker + D1 + Admin

Kompletter Rang-Shop für `buy.austria-mc.net` im Austria-MC-Stil — **ohne Skins/Rüstungs-Render und ohne Coins**.

## Enthalten

- responsives Austria-MC Shop-Design mit Alpen-/Österreich-Look
- Ränge aus Cloudflare D1: **Spüla+**, **VIP**, **VIP+**, **Builder**
- Builder-Akzent: deutliches Grau `#6B7280`
- direkte Zahlungsanbindungen vorbereitet für PayPal, Klarna und paysafecard
- Fulfillment-API für `AustriaShopBridge.jar` / LuckPerms
- passwortgeschütztes Adminpanel unter `/admin/`
- Admin-Dashboard mit Bestellungen, Umsatz, offenen Freischaltungen und Testkäufen
- Ränge, Preise, Prefixe, Farben und Permissions im Browser bearbeiten
- kostenlosen Testkauf erzeugen (`PAID + PENDING`, ohne Zahlungsanbieter)
- D1-Datenbank-Browser für alle Shop-/Admin-Tabellen
- Audit-Log für Admin-Änderungen
- Admin-Username und Passwort im Adminpanel änderbar
- HttpOnly/Secure Admin-Session, CSRF/Origin-Schutz und Login-Drosselung

## Repository-Struktur

```text
public/
  index.html
  styles.css
  app.js
  assets/austria-logo.png
  admin/
    index.html
    admin.css
    admin.js
src/
  index.ts
schema.sql
migrate-direct-payments.sql
migrate-admin.sql
wrangler.jsonc
package.json
```

## 1. D1-ID eintragen

In `wrangler.jsonc`:

```json
"database_id": "DEINE-D1-DATABASE-ID"
```

Die bestehende D1-Datenbank heißt bei diesem Projekt `austria-mc-shop`.

## 2. Bestehende Datenbank migrieren

Wenn du bereits die aktuelle Austria-MC-D1 verwendest, führe in Cloudflare D1 → `austria-mc-shop` → Console nacheinander aus:

1. `migrate-direct-payments.sql` — nur falls noch nicht erfolgt
2. `migrate-admin.sql` — kann mehrfach ausgeführt werden

Bei einer komplett neuen Datenbank reicht `schema.sql`.

## 3. Cloudflare Runtime-Secrets

Unter Worker → Settings → Variables and Secrets als **Secrets** anlegen:

```text
FULFILLMENT_TOKEN
ADMIN_BOOTSTRAP_USERNAME
ADMIN_BOOTSTRAP_PASSWORD
ADMIN_SECRET
```

`ADMIN_SECRET` sollte ein langer zufälliger Wert sein, z. B. 64+ Zeichen.

Für den ersten Admin-Login verwendest du `ADMIN_BOOTSTRAP_USERNAME` und `ADMIN_BOOTSTRAP_PASSWORD`. Beim ersten erfolgreichen Login wird der Admin-Benutzer in D1 angelegt. Danach kannst du Benutzername und Passwort direkt unter `/admin/` → **Zugang** ändern.

Die Bootstrap-Werte dienen danach nur noch als Recovery-Vorlage und werden nicht für normale Logins verwendet, sobald `admin_users` existiert.

### Zahlungsanbieter

Nur die Anbieter, die du verwenden willst, benötigen Secrets:

```text
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID

KLARNA_USERNAME
KLARNA_PASSWORD

PAYSAFECARD_API_KEY
```

Test/Sandbox ist in `wrangler.jsonc` voreingestellt.

## 4. Deployment

Cloudflare Builds:

```text
Production branch: main
Root directory: leer
Build command: leer
Deploy command: npx wrangler deploy --config ./wrangler.jsonc
```

## 5. Adminpanel

Aufrufen:

```text
https://buy.austria-mc.net/admin/
```

Funktionen:

- **Übersicht**: Käufe, bezahlte Orders, Umsatz, offene LuckPerms-Freischaltungen
- **Bestellungen**: Spieler, Rang, Zahlung, Fulfillment-Status; bezahlte Aufträge erneut auf `PENDING` setzen
- **Ränge & Rechte**: Preis, Name, LuckPerms-Gruppe, Prefix, Farbe, Beschreibung, Aktivstatus und Permissions bearbeiten
- **Testkauf**: kostenlosen Testauftrag erzeugen; AustriaShopBridge verarbeitet ihn wie einen echten bezahlten Kauf
- **Datenbank**: Inhalte der Shop-/Admin-Tabellen lesen
- **Zugang**: Admin-Benutzername und Passwort ändern

Echte bezahlte Bestellungen können im Adminpanel absichtlich nicht einfach gelöscht werden. Testbestellungen können gelöscht werden. Das verhindert versehentliches Entfernen von Zahlungsnachweisen.

## 6. AustriaShopBridge

Der Proxy-Bridge-Token muss auf beiden Seiten identisch sein:

Cloudflare Secret:

```text
FULFILLMENT_TOKEN
```

Bungee:

```properties
fulfillment.token=DERSELBE_TOKEN
```

Der Worker stellt bezahlte Aufträge unter `/api/fulfillment/pending` bereit. AustriaShopBridge setzt die LuckPerms-Gruppe und meldet die Order als `FULFILLED` zurück.

## 7. Kostenlos testen

Im Adminpanel:

```text
Testkauf → Minecraft-Name → Rang → Testkauf erstellen
```

Dabei wird **kein Zahlungsanbieter** aufgerufen. Die D1-Order wird direkt als `PAID` + `PENDING` angelegt. AustriaShopBridge sollte den Rang anschließend vergeben. Je nach Tab-/Scoreboard-/Permission-Cache kann ein Rejoin nötig sein, damit der Rang überall sichtbar wird.

## Wichtig vor Live-Zahlungen

- Impressum, Datenschutz und AGB mit echten Daten befüllen
- Zahlungsanbieter vollständig verifizieren
- zuerst Sandbox/Test benutzen
- Webhooks und Rückerstattungsprozess testen
- Admin-Secrets niemals in GitHub committen
- `FULFILLMENT_TOKEN` niemals öffentlich teilen
