# Adminpanel einrichten

## Cloudflare-Secrets

Lege unter `austria-mc-shop` → Settings → Variables and Secrets diese drei Werte als **Secret** an:

```text
ADMIN_BOOTSTRAP_USERNAME = dein gewünschter erster Benutzername
ADMIN_BOOTSTRAP_PASSWORD = dein starkes erstes Passwort
ADMIN_SECRET = langer zufälliger Geheimwert, mindestens 64 Zeichen empfohlen
```

`ADMIN_SECRET` darf später nicht einfach geändert werden, solange du aktive Sessions behalten willst. Nach einer Änderung werden bestehende Sessions ungültig.

## Migration

In D1 → Console den Inhalt von `migrate-admin.sql` ausführen.

## Erster Login

Öffne:

```text
https://buy.austria-mc.net/admin/
```

Melde dich mit den Bootstrap-Daten an. Beim ersten erfolgreichen Login wird ein Admin-Benutzer in D1 angelegt.

## Benutzername / Passwort später ändern

Adminpanel → **Zugang**.

Dort musst du dein aktuelles Passwort angeben und kannst Benutzername und/oder Passwort ändern. Die Änderung erhöht die Session-Version und macht andere noch offene Admin-Sessions ungültig.

## Passwort vergessen

Wenn bereits ein Admin-Benutzer existiert, werden die Bootstrap-Daten nicht automatisch als Hintertür akzeptiert. Für Recovery solltest du den bestehenden `admin_users`-Datensatz bewusst zurücksetzen und danach mit neuen Bootstrap-Secrets erneut initialisieren.

Beispiel in D1 Console:

```sql
DELETE FROM admin_users WHERE id = 1;
```

Danach neue `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` Secrets setzen und erneut `/admin/` öffnen.

## Sicherheit

- Session-Cookie: `HttpOnly`, `Secure`, `SameSite=Strict`
- Schreibzugriffe prüfen Same-Origin + Admin-Header
- Passwort wird mit Salt + PBKDF2 + `ADMIN_SECRET` gehasht
- Login-Fehlversuche werden pro Client gedrosselt
- Adminseiten werden mit `no-store`, CSP und `X-Frame-Options: DENY` ausgeliefert
- Passwort und Secrets werden nicht über den Datenbank-Browser ausgegeben
