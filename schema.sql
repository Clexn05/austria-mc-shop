PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  luckperms_group TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  prefix_legacy TEXT NOT NULL,
  accent_hex TEXT NOT NULL,
  description TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS product_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id TEXT NOT NULL,
  permission_node TEXT NOT NULL,
  command_hint TEXT,
  benefit_label TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  UNIQUE(product_id, permission_node),
  FOREIGN KEY(product_id) REFERENCES products(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS shop_orders (
  id TEXT PRIMARY KEY,
  minecraft_name TEXT NOT NULL,
  product_id TEXT NOT NULL,
  luckperms_group TEXT NOT NULL,
  price_cents INTEGER NOT NULL CHECK(price_cents >= 0),
  currency TEXT NOT NULL DEFAULT 'EUR',
  payment_method TEXT NOT NULL CHECK(payment_method IN ('paypal','paysafecard','klarna')),
  payment_status TEXT NOT NULL DEFAULT 'CREATED'
    CHECK(payment_status IN ('CREATED','OPEN','PENDING','AUTHORIZED','PAID','FAILED','CANCELED','EXPIRED')),
  fulfillment_status TEXT NOT NULL DEFAULT 'WAITING_PAYMENT'
    CHECK(fulfillment_status IN ('WAITING_PAYMENT','PENDING','PROCESSING','FULFILLED','FAILED')),
  mollie_payment_id TEXT UNIQUE,
  customer_email TEXT NOT NULL,
  given_name TEXT NOT NULL,
  family_name TEXT NOT NULL,
  street_and_number TEXT NOT NULL,
  postal_code TEXT NOT NULL,
  city TEXT NOT NULL,
  country TEXT NOT NULL,
  fulfillment_message TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  paid_at TEXT,
  fulfilled_at TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_fulfillment
  ON shop_orders(payment_status, fulfillment_status);

INSERT INTO products
(id, display_name, luckperms_group, price_cents, prefix_legacy, accent_hex, description, display_order, active)
VALUES
('spuela-plus', 'Spüla+', 'spüla+', 500, '&7[&aSpüla&4+&7]  &f', '#52d273', 'Mehr Komfort, Fly und zusätzliche Plot-Rechte.', 10, 1),
('vip', 'VIP', 'vip', 1000, '&7[&eVIP&7]  &e', '#f4c542', 'Komfort-Befehle, Nick-Funktionen und mehr Plot-Rechte.', 20, 1),
('vip-plus', 'VIP+', 'vip+', 1200, '&7[&eVIP&4+&7]  &e', '#ff9d24', 'Alle VIP-Vorteile plus zusätzliche Komfort- und Nick-Befehle.', 30, 1),
('builder', 'Builder', 'builder', 2500, '&7[&fBuilder&7]  &7', '#e8edf2', 'Builder-Rechte mit WorldEdit-Funktionen und 8 Plot-Slots.', 40, 1)
ON CONFLICT(id) DO UPDATE SET
  display_name=excluded.display_name,
  luckperms_group=excluded.luckperms_group,
  price_cents=excluded.price_cents,
  prefix_legacy=excluded.prefix_legacy,
  accent_hex=excluded.accent_hex,
  description=excluded.description,
  display_order=excluded.display_order,
  active=excluded.active,
  updated_at=CURRENT_TIMESTAMP;

DELETE FROM product_permissions
WHERE product_id IN ('spuela-plus','vip','vip-plus','builder');

INSERT INTO product_permissions
(product_id, permission_node, command_hint, benefit_label, display_order)
VALUES
('spuela-plus','group.default',NULL,'Enthält alle Rechte der Standardgruppe',10),
('spuela-plus','essentials.enderchest','/enderchest','Enderchest überall öffnen',20),
('spuela-plus','essentials.fly','/fly','Fliegen aktivieren/deaktivieren',30),
('spuela-plus','plots.plot.4',NULL,'Bis zu 4 Plots',40),

('vip','group.spüla+',NULL,'Enthält alle Spüla+-Rechte',10),
('vip','essentials.hat','/hat','Item als Hut tragen',20),
('vip','essentials.nick','/nick','Eigenen Nickname setzen',30),
('vip','essentials.nick.color','/nick','Farben im Nickname verwenden',40),
('vip','essentials.ptime','/ptime','Eigene Tageszeit einstellen',50),
('vip','essentials.anvil','/anvil','Amboss-Menü öffnen',60),
('vip','essentials.pweather','/pweather','Eigenes Wetter einstellen',70),
('vip','essentials.workbench','/workbench','Werkbank-Menü öffnen',80),
('vip','essentials.smithingtable','/smithingtable','Schmiedetisch-Menü öffnen',90),
('vip','MyPet.shop.access.monster',NULL,'Zugriff auf Monster im MyPet-Shop',100),
('vip','plots.plot.6',NULL,'Bis zu 6 Plots',110),

('vip-plus','group.vip',NULL,'Enthält alle VIP-Rechte',10),
('vip-plus','essentials.top','/top','Zur höchsten sicheren Position teleportieren',20),
('vip-plus','essentials.feed','/feed','Hunger auffüllen',30),
('vip-plus','essentials.nick.format','/nick','Formatierungen im Nickname verwenden',40),
('vip-plus','essentials.nick.magic','/nick','Magic-Format im Nickname verwenden',50),
('vip-plus','essentials.depth','/depth','Aktuelle Höhe/Tiefe anzeigen',60),
('vip-plus','essentials.getpos','/getpos','Aktuelle Position anzeigen',70),

('builder','group.vip+',NULL,'Enthält alle VIP+-Rechte',10),
('builder','essentials.speed','/speed','Bewegungsgeschwindigkeit ändern',20),
('builder','essentials.speed.fly','/speed fly','Fluggeschwindigkeit ändern',30),
('builder','essentials.speed.walk','/speed walk','Laufgeschwindigkeit ändern',40),
('builder','worldedit.wand','//wand','WorldEdit-Axt erhalten',50),
('builder','worldedit.selection.pos','//pos1, //pos2','WorldEdit-Auswahl per Position setzen',60),
('builder','worldedit.selection.hpos','//hpos1, //hpos2','WorldEdit-Auswahl per Blick setzen',70),
('builder','worldedit.clipboard.copy','//copy','WorldEdit-Auswahl kopieren',80),
('builder','worldedit.clipboard.cut','//cut','WorldEdit-Auswahl ausschneiden',90),
('builder','worldedit.clipboard.paste','//paste','WorldEdit-Zwischenablage einfügen',100),
('builder','worldedit.clipboard.rotate','//rotate','WorldEdit-Zwischenablage drehen',110),
('builder','worldedit.clipboard.flip','//flip','WorldEdit-Zwischenablage spiegeln',120),
('builder','worldedit.history.undo','//undo','WorldEdit-Aktion rückgängig machen',130),
('builder','worldedit.history.redo','//redo','WorldEdit-Aktion wiederholen',140),
('builder','worldedit.region.walls','//walls','WorldEdit-Wände erzeugen',150),
('builder','worldedit.region.move','//move','WorldEdit-Auswahl verschieben',160),
('builder','worldedit.region.replace','//replace','Blöcke in einer Auswahl ersetzen',170),
('builder','worldedit.region.set','//set','WorldEdit-Auswahl setzen',180),
('builder','plots.clear','/plot clear','Eigenen Plot leeren',190),
('builder','plots.merge','/plot merge','Plots zusammenführen',200),
('builder','plots.set.biome','/plot set biome','Plot-Biom ändern',210),
('builder','plots.plot.8',NULL,'Bis zu 8 Plots',220),
('builder','MyPet.shop.access.spezielle',NULL,'Zugriff auf spezielle MyPet-Shop-Inhalte',230);
