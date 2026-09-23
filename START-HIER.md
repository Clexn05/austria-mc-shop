# Austria-MC Shop v4 — Start hier

Dieses Paket ist für dein bestehendes Cloudflare-Worker-Projekt `austria-mc-shop` vorbereitet.

## 1. Dateien nach GitHub hochladen

Den **Inhalt** dieses Ordners direkt in den Root deines GitHub-Repositories laden. Danach müssen im Repo direkt sichtbar sein:

- `public/`
- `src/`
- `schema.sql`
- `migrate-admin.sql`
- `migrate-direct-payments.sql`
- `package.json`
- `tsconfig.json`
- `wrangler.jsonc`

Nicht noch einen zusätzlichen Unterordner darumlegen.

## 2. Cloudflare Build-Einstellungen

Deploy command:

```text
npx wrangler deploy --config ./wrangler.jsonc
```

Build command: leer lassen.

WICHTIG: Der API-Token, den Cloudflare für den GitHub-Build verwendet, braucht Zugriff auf den Worker **und auf D1**. Mindestens:

- Account → Workers Scripts → Edit
- Account → D1 → Edit
- Zone `austria-mc.net` → Workers Routes → Edit

Wenn dein automatischer Cloudflare-Build weiterhin Fehler `10021` für D1 zeigt, obwohl die ID stimmt, ist der Build-Token falsch berechtigt. Dein funktionierender lokaler Deploy-Befehl bleibt dann:

```powershell
npx.cmd wrangler deploy --config .\wrangler.jsonc
```

## 3. D1

In `wrangler.jsonc` ist deine bekannte Datenbank bereits eingetragen:

```text
austria-mc-shop
65135b75-3b98-4f11-9175-3c27dd4ef543
```

Für eine **neue/leere** D1-Datenbank:

```powershell
npx.cmd wrangler d1 execute austria-mc-shop --remote --file=.\schema.sql
```

Für deine bestehende Datenbank sind die Admin-Tabellen bereits über `migrate-admin.sql` vorgesehen. `migrate-direct-payments.sql` nur ausführen, wenn die `provider_*`-Spalten noch fehlen.

## 4. Secrets

`ADMIN_BOOTSTRAP_USERNAME` steht bereits als ungefährliche Variable auf `admin` und kann später im Adminpanel geändert werden.

Diese Werte als **Cloudflare Secret** anlegen:

```text
ADMIN_BOOTSTRAP_PASSWORD
ADMIN_SECRET
FULFILLMENT_TOKEN
```

`FULFILLMENT_TOKEN` muss exakt dem Wert in `AustriaShopBridge/config.properties` entsprechen:

```properties
fulfillment.token=DEIN_TOKEN
```

Optional für echte Zahlungen kommen noch die Anbieter-Secrets aus `PAYMENT-SETUP.md` dazu.

## 5. Test

Shop:

```text
https://buy.austria-mc.net/
```

Admin:

```text
https://buy.austria-mc.net/admin/
```

Diagnose:

```text
https://buy.austria-mc.net/api/health
```

Dort sollte `database: true` stehen. Für den Admin sollte `adminConfigured: true` stehen.

## Design

- eigener Austria-MC Alpen-/Burg-Hintergrund
- keine Skins
- keine Coins
- vier D1-gesteuerte Ränge
- responsive Desktop/Mobil
- Adminbereich bleibt vollständig enthalten
