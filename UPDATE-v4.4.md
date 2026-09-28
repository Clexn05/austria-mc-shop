# Austria-MC Shop v4.4 – PayPal + Card

## Geändert

- Öffentlicher Checkout auf **PayPal + Kredit-/Debitkarte** umgestellt.
- Kartenzahlungen laufen über **PayPal Web SDK v6 Card Fields**.
- Neue serverseitige Route für einen browser-sicheren PayPal Client Token.
- Neue serverseitige PayPal-Order- und Capture-Routen für Kartenzahlungen.
- PayPal-Webhook erkennt jetzt sowohl `paypal` als auch `paypal-card`.
- Card Fields werden nur angeboten, wenn PayPal `advanced_cards` für den Händler als verfügbar meldet.
- Kartendaten werden nicht an Austria-MC übertragen oder in D1 gespeichert.
- Der sichtbare Produktpreis wird unverändert an PayPal übergeben; es gibt keinen zusätzlichen Zahlungsaufschlag.
- Bestehender v4.3-Rangschutz bleibt vor PayPal- und Kartenzahlungen aktiv.

## Keine Migration erforderlich

Die bestehende D1-Constraint für `payment_method` bleibt kompatibel. Kartenbestellungen werden mit `payment_method = paypal` und `provider_name = paypal-card` gespeichert.

## Plugin

`AustriaShopBridge v1.1.1` bleibt unverändert und muss für dieses Update nicht ersetzt werden.
