# Austria-MC Shop v4.5 – Endpreis-Kostenpuffer

## Was geändert wurde

- `products.price_cents` bleibt ohne Datenbankänderung erhalten und dient als **Basis-/Zielpreis**.
- Der Shop berechnet daraus serverseitig einen Kunden-Endpreis.
- Standard: `3,4 % + 0,35 €`.
- Formel: `ceil((Basispreis + Fixkosten) / (1 - Prozentkosten))`.
- Derselbe Endpreis wird auf der Rangkarte, im Checkout und an PayPal verwendet.
- PayPal und Kredit-/Debitkarte haben **keinen unterschiedlichen Zahlungsaufschlag**.
- Der Adminbereich zeigt Basis-/Zielpreis und berechneten Kunden-Endpreis.
- Bestellungen speichern den tatsächlich belasteten Endpreis.
- Rangschutz v1.1.1 bleibt unverändert.

## Beispiel

Bei `price_cents = 1000` und den Standardwerten:

```text
Basis-/Zielpreis: 10,00 €
Kunden-Endpreis:  10,72 €
```

## Konfiguration

```text
PRICE_COST_PERCENT=3.4
PRICE_COST_FIXED_CENTS=35
```

Die Werte können geändert werden, falls dein tatsächlicher Händler-Tarif anders ist.

## Update

1. Vorherige Shop-Dateien sichern.
2. v4.5 über v4.4 kopieren.
3. Keine D1-Migration ausführen.
4. Kostenwerte in `wrangler.jsonc` bzw. Cloudflare prüfen.
5. Erst Sandbox testen, danach `PAYPAL_ENV=live`.
6. Deployen.

`AustriaShopBridge v1.1.1` muss für dieses Update nicht geändert werden.
