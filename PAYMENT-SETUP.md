# Austria-MC Shop v4.5 – PayPal + Karte + Endpreis-Kostenpuffer

Der öffentliche Checkout bietet zwei Zahlungsarten:

- **PayPal** – Weiterleitung zum PayPal-Checkout.
- **Kredit-/Debitkarte** – Kartenfelder werden direkt von PayPal gehostet; die Zahlung läuft ebenfalls über dein PayPal-Händlerkonto.

Der Shop speichert **keine Kartennummer, kein Ablaufdatum und keinen CVC**.

## 1. Cloudflare-Secrets

Im Worker `austria-mc-shop` unter **Settings → Variables and Secrets**:

```text
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET
PAYPAL_WEBHOOK_ID
FULFILLMENT_TOKEN
```

Die Kartenzahlung verwendet dieselbe PayPal REST App.

## 2. Sandbox / Live

In `wrangler.jsonc` steht zunächst:

```text
PAYPAL_ENV = sandbox
```

Für echte Zahlungen auf `live` stellen und neu deployen.

## 3. Kostenpuffer / Endpreis

In v4.5 wird **kein zahlungsartabhängiger Zuschlag im Checkout** erhoben. Stattdessen wird der für den Kunden sichtbare Produkt-Endpreis bereits vorher aus dem Basis-/Zielpreis berechnet. PayPal und Karte haben denselben Endpreis.

Konfiguration:

```text
PRICE_COST_PERCENT=3.4
PRICE_COST_FIXED_CENTS=35
```

Die Berechnung ist eine Gross-up-Berechnung:

```text
Endpreis = aufrunden((Basispreis + Fixkosten) / (1 - Prozentkosten))
```

Beispiel mit den Standardwerten:

```text
Basis-/Zielpreis: 10,00 €
Kostenmodell:     3,4 % + 0,35 €
Kunden-Endpreis:  10,72 €
```

Wenn PayPal auf 10,72 € tatsächlich 3,4 % + 0,35 € berechnet, verbleiben ungefähr 10,00 €. Durch das Aufrunden können wenige Bruchteile eines Cents mehr verbleiben.

**Wichtig:** Der tatsächliche PayPal-Abzug kann abweichen, z. B. bei internationalen Transaktionen oder individuellen Händlerkonditionen. Deshalb sind beide Werte konfigurierbar und werden nicht automatisch aus deinem PayPal-Konto ausgelesen.

Ändere die Werte in Cloudflare bzw. `wrangler.jsonc`, wenn dein echter Tarif anders ist.

## 4. Adminbereich

Im Adminbereich heißt das Preisfeld jetzt **Basis-/Zielpreis in Cent**. Direkt darunter wird der daraus berechnete **Kunden-Endpreis** angezeigt.

Beispiel:

```text
Basis-/Zielpreis: 1000 Cent
Kunden-Endpreis:  10,72 €
```

Bestellungen speichern in `shop_orders.price_cents` den tatsächlich berechneten und an PayPal gesendeten Kunden-Endpreis.

## 5. PayPal-Webhook

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

## 6. Kartenzahlung

Der Shop prüft über das PayPal Web SDK, ob **Advanced Cards** für dein PayPal-Händlerkonto verfügbar ist. Ist es nicht freigeschaltet, wird die Kartenoption automatisch deaktiviert.

## 7. D1 / Migration

Für v4.5 ist **keine neue D1-Migration nötig**.

Kartenbestellungen werden aus Kompatibilitätsgründen weiterhin mit `payment_method = paypal` gespeichert; `provider_name = paypal-card` kennzeichnet die Kartenabwicklung.

## 8. Rangschutz

PayPal und Karte führen vor dem Erstellen der Zahlung weiterhin die serverseitige Rangprüfung über AustriaShopBridge aus. Blockierte Downgrades und geschützte Staff-Ränge gelangen nicht bis zur Zahlung.

## 9. Rechtlicher Hinweis für Österreich / B2C

Diese Version verwendet absichtlich **denselben, vorab angezeigten Endpreis** für PayPal und Karte und erhebt keinen separaten Zahlungsart-Zuschlag. Für Webshops mit Verbrauchern gelten in Österreich/EU strenge Regeln zu Entgelten für Zahlungsmittel. Prüfe deine konkrete Preisgestaltung bei Bedarf mit WKO bzw. Rechtsberatung.
