# Austria-MC Shop v4.5

Cloudflare-Workers-Shop für Austria-MC mit D1, Adminbereich, PayPal/Kartenzahlung und automatischer Rang-Freischaltung über AustriaShopBridge.

## Enthalten

- Austria-MC Shop im Alpen-/Minecraft-Stil
- Ränge dynamisch aus Cloudflare D1
- **PayPal-Zahlung**
- **Kredit-/Debitkartenzahlung über PayPal Web SDK v6**
- globaler Kostenpuffer im **angezeigten Endpreis**
- derselbe Endpreis für PayPal und Karte; im Checkout kommt kein Zahlungsaufschlag mehr dazu
- Kartendaten werden direkt von PayPal verarbeitet und nicht im Shop gespeichert
- Bestellstatus
- geschütztes Adminpanel unter `/admin/`
- Ränge, Basis-/Zielpreise, Prefix, Farbe und Rechte verwalten
- Bestellungen ansehen und löschen
- Testkäufe ohne echtes Geld anlegen
- Fulfillment-API für AustriaShopBridge
- serverseitige LuckPerms-Rangprüfung vor Checkout und Testkauf
- Schutz vor gleichem Rang, Downgrades und konfigurierten Staff-Rängen
- `/api/health` zur Diagnose

## Neu in v4.5

Der Wert `products.price_cents` ist jetzt der **Basis-/Zielbetrag**, der nach dem angenommenen Zahlungsabwicklungs-Kostenmodell ungefähr bei dir übrig bleiben soll. Der Shop berechnet daraus bereits vor der Anzeige den Kunden-Endpreis.

Standardmäßig ist hinterlegt:

```text
PRICE_COST_PERCENT=3.4
PRICE_COST_FIXED_CENTS=35
```

Mit diesen Werten wird aus `1000` Cent Basispreis ein angezeigter und belasteter Endpreis von **10,72 €**. Die Berechnung wird auf volle Cent aufgerundet.

Die Werte sind absichtlich konfigurierbar, weil dein tatsächlicher PayPal-Tarif, internationale Zahlungen oder Sonderkonditionen abweichen können.

Für v4.5 ist **keine neue D1-Migration** nötig. `AustriaShopBridge v1.1.1` kann unverändert bleiben.

Details stehen in **START-HIER.md**, **PAYMENT-SETUP.md** und **UPDATE-v4.5.md**.
