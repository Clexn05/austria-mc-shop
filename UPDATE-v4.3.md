# Update auf v4.3 – Rangschutz

## Was geändert wurde

- Vor normalem Checkout **und** Admin-Testkauf wird der aktuelle LuckPerms-Rang serverseitig abgefragt.
- Derselbe Rang kann nicht erneut gekauft werden.
- Downgrades werden blockiert, z. B. `builder -> vip+`.
- Standardmäßig blockieren `mod`, `admin` und `inhaber` jeden Shop-Rangkauf.
- Zulässige Upgrades bleiben möglich, z. B. `vip -> vip+` und `vip+ -> builder`.
- Vor der tatsächlichen Freischaltung prüft das Plugin ein zweites Mal, damit eine zwischenzeitliche Beförderung keinen Downgrade verursacht.
- Bei erfolgreichem Update wird ein online befindlicher Spieler nach ungefähr einer Sekunde mit `Dein Rang wurde geupdatet! / Joine neu.` getrennt.
- Wenn die Rangprüfung nicht erreichbar ist, startet der Shop **keine Zahlung** (Fail-Closed).

## Reihenfolge beim Einspielen

1. Proxy stoppen.
2. Alte `plugins/AustriaShopBridge.jar` sichern.
3. Neue `AustriaShopBridge-v1.1.0.jar` als `AustriaShopBridge.jar` in den `plugins`-Ordner legen.
4. Bestehende `plugins/AustriaShopBridge/config.properties` **nicht löschen**.
5. Proxy starten und prüfen, ob `AustriaShopBridge v1.1.0 aktiviert.` im Log erscheint.
6. Danach den Inhalt der Shop-v4.3-ZIP in dein GitHub-Repo kopieren, vorhandene Dateien ersetzen, committen und pushen.
7. Deployen:

```powershell
cd C:\Users\cleme\Documents\GitHub\austria-mc-shop
npx.cmd wrangler deploy --config .\wrangler.jsonc
```

Die Tabelle `rank_checks` wird automatisch angelegt. Optional vorher manuell:

```powershell
npx.cmd wrangler d1 execute austria-mc-shop --remote --file=.\migrate-rank-checks.sql
```

## Rangfolge / Staff-Gruppen

Die bestehende Config funktioniert weiter. Neue Optionen sind optional; fehlen sie, gelten automatisch diese Defaults:

```properties
eligibility.poll.interval.seconds=1
shop.rank.order=spüla+,vip,vip+,builder
protected.groups=mod,admin,inhaber
```

Wenn deine echten LuckPerms-Gruppennamen anders heißen, `protected.groups` entsprechend ergänzen.
