-- Austria-MC: einmalige Migration von Mollie-Feldern auf direkte Zahlungsanbieter.
-- Diese Datei genau EINMAL gegen die bestehende D1-Datenbank ausführen.

ALTER TABLE shop_orders ADD COLUMN provider_name TEXT;
ALTER TABLE shop_orders ADD COLUMN provider_payment_id TEXT;
ALTER TABLE shop_orders ADD COLUMN provider_session_id TEXT;
ALTER TABLE shop_orders ADD COLUMN provider_order_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_shop_provider_payment
ON shop_orders(provider_name, provider_payment_id)
WHERE provider_payment_id IS NOT NULL;

UPDATE products
SET accent_hex = '#6B7280', updated_at = CURRENT_TIMESTAMP
WHERE id = 'builder';
