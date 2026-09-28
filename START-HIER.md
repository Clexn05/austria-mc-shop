# Austria-MC Shop v4 — Start hier

Dieses Paket ist für dein bestehendes Cloudflare-Worker-Projekt `austria-mc-shop` vorbereitet.

## 1. Dateien nach GitHub hochladen

Den **Inhalt** dieses Ordners direkt in den Root deines GitHub-Repositories laden. Danach müssen im Repo direkt sichtbar sein:

- `public/`
- `src/`
- `schema.sql`
- `migrate-admin.sql`
- `migrate-direct-payments.sql`
- `migrate-rank-checks.sql`
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

Die neue Rangprüfung in v4.3 legt ihre Tabelle beim ersten Aufruf automatisch an. Optional kannst du sie vorher manuell anlegen:

```powershell
npx.cmd wrangler d1 execute austria-mc-shop --remote --file=.\migrate-rank-checks.sql
```

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


## Admin-Fix v4.1

Die Admin-Oberfläche trennt jetzt Login-/Sessionfehler von Fehlern beim Laden der Übersichts- oder Produktdaten.
Wenn der Login erfolgreich ist, bleibt die Admin-Oberfläche sichtbar und zeigt eventuelle Datenbank-/API-Fehler als Toast statt still zum Login zurückzuspringen.

Nach Upload/Commit lokal deployen:

```powershell
npx.cmd wrangler deploy --config .\wrangler.jsonc
```


## Neu in v4.2

Im Adminbereich können jetzt alle Bestellungen gelöscht werden. Testkäufe haben weiterhin einen eigenen Lösch-Button; bei echten Bestellungen erscheint eine doppelte Sicherheitsabfrage. Vor dem Löschen wird ein Audit-Eintrag mit den wichtigsten Bestelldaten gespeichert.


## Neu in v4.3 – Rangschutz

Der Shop fragt **vor dem Erstellen einer Zahlung** den aktuellen LuckPerms-Rang beim `AustriaShopBridge` ab. Dadurch werden derselbe Rang und Downgrades bereits vor dem Zahlungsanbieter blockiert. Standardmäßig gilt die Reihenfolge:

```text
spüla+ < vip < vip+ < builder
```

Mit dem aktuell funktionierenden `AustriaShopBridge v1.1.1` werden standardmäßig unter anderem `mod`, `moderator`, `admin`, `administrator`, `inhaber`, `inhoba` und `owner` als geschützte Staff-Gruppen erkannt. Weitere Staff-Gruppen können in `plugins/AustriaShopBridge/config.properties` über `protected.groups=` ergänzt werden.

Wichtig ist die Update-Reihenfolge:

1. Für den Rangschutz `AustriaShopBridge v1.1.1` verwenden und die bestehende `plugins/AustriaShopBridge/config.properties` behalten.
2. Danach die Shop-Dateien ins GitHub-Repo kopieren/committen und deployen.

So bleibt der alte Shop während des Plugin-Updates weiter nutzbar. Sobald v4.3 online ist, ist die serverseitige Rangprüfung aktiv. Wenn der Proxy bzw. das Plugin nicht erreichbar ist, wird der Checkout absichtlich blockiert, statt eine möglicherweise falsche Zahlung zu starten.

## PayPal + Kredit-/Debitkarte (seit v4.4)

Der öffentliche Checkout zeigt jetzt nur noch:

```text
PayPal
Kredit-/Debitkarte
```

Beide Zahlungsarten werden über PayPal verarbeitet. Die Kartenfelder kommen aus dem PayPal Web SDK v6; Austria-MC erhält keine rohe Kartennummer und speichert keine Kartendaten.

### Update von v4.3

1. Die Dateien der aktuellen Shop-ZIP über deine bestehenden Shop-Dateien kopieren.
2. `AustriaShopBridge v1.1.1` auf dem Proxy **nicht ändern** – der funktionierende Rangschutz bleibt bestehen.
3. Es ist **keine neue D1-Migration** erforderlich.
4. Deine bestehenden Secrets `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` und `PAYPAL_WEBHOOK_ID` bleiben erhalten.
5. Deployen:

```powershell
npx.cmd wrangler deploy --config .\wrangler.jsonc
```

### Preise in v4.5

Der Admin-/D1-Preis ist jetzt der **Basis-/Zielpreis**. Der Shop berechnet daraus vor der Anzeige einen einheitlichen Kunden-Endpreis für PayPal und Karte. Standardmäßig gilt `3,4 % + 0,35 €`; die Werte stehen als `PRICE_COST_PERCENT` und `PRICE_COST_FIXED_CENTS` in `wrangler.jsonc` und können an deinen echten Tarif angepasst werden.

Beispiel: Aus `1000` Cent Basis-/Zielpreis werden mit den Standardwerten **10,72 € Kunden-Endpreis**. Im Checkout kommt danach keine weitere Zahlungsgebühr mehr hinzu.

### Wenn „Karte“ nicht verfügbar ist

Dann ist dein PayPal-Konto sehr wahrscheinlich noch nicht für **Advanced Card Payments** freigeschaltet oder die PayPal-Secrets/Umgebung stimmen nicht. Der Shop deaktiviert die Karte in diesem Fall automatisch, damit keine kaputte Zahlungsart angeboten wird.


## Update v4.5 – Endpreis-Kostenpuffer

Für v4.5 ist **keine D1-Migration** nötig. Kopiere die Shop-Dateien über v4.4, prüfe in `wrangler.jsonc` die Werte `PRICE_COST_PERCENT` und `PRICE_COST_FIXED_CENTS`, teste zuerst in der PayPal-Sandbox und deploye anschließend. `AustriaShopBridge v1.1.1` bleibt unverändert.
