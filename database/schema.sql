-- ============================================================
-- PokéStock — schéma MySQL 8
-- Ce script est FACULTATIF : l'API crée automatiquement les tables
-- au premier démarrage (EF Core EnsureCreated). Il sert de référence
-- ou pour créer la base à la main.
-- Les tables doivent être créées toutes ensemble : si elles existent déjà,
-- l'API ne les modifie pas.
-- ============================================================

USE pokestock;

-- Paramètres de l'application (JSON) : paramètres fiscaux, périodes déclarées...
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) NOT NULL,          -- ex. tax.settings, tax.declared
  value       LONGTEXT     NOT NULL,
  updated_at  DATETIME(6)  NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_items (
  id                 INT           NOT NULL AUTO_INCREMENT,
  name               VARCHAR(200)  NOT NULL,
  category           VARCHAR(100)  NULL,
  language           VARCHAR(50)   NULL,
  is_listed_on_cardmarket TINYINT(1) NOT NULL DEFAULT 0,
  type               VARCHAR(30)   NOT NULL,  -- RawCard, GradedCard, Booster, Blister, Etb, Box, Display, MiniTin, Pokebox, Bundle, Bulk, Other
  `condition`        VARCHAR(30)   NOT NULL,  -- NM, EXC, GOOD, LP, PL, PO (comme sur Cardmarket)
  purchase_price     DECIMAL(14,6) NOT NULL,  -- prix d'achat unitaire
  quantity           INT           NOT NULL,  -- quantité achetée
  remaining_quantity INT           NOT NULL,  -- quantité restante en stock
  location           VARCHAR(100)  NULL,
  purchase_date      DATE          NOT NULL,
  market_value       DECIMAL(10,2) NULL,      -- valeur de marché unitaire estimée
  previous_market_value DECIMAL(10,2) NULL,
  market_value_updated_at DATETIME(6) NULL,
  catalog_card_id    INT           NULL,      -- carte du catalogue (card_catalog) : sa cote met à jour market_value
  created_at         DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  KEY IX_inventory_items_name (name),
  KEY IX_inventory_items_catalog_card_id (catalog_card_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchases (
  id              INT           NOT NULL AUTO_INCREMENT,
  purchase_number VARCHAR(20)   NOT NULL,     -- ex. A2026001 (achat) ou C2026001 (transfert de collection)
  source          VARCHAR(30)   NOT NULL DEFAULT 'Supplier',  -- Supplier | PersonalCollection
  platform        VARCHAR(30)   NULL,         -- plateforme d'achat (Cardmarket, Ebay...)
  purchase_date   DATE          NOT NULL,
  supplier        VARCHAR(150)  NOT NULL,
  platform_fees   DECIMAL(10,2) NOT NULL DEFAULT 0,
  shipping_fees   DECIMAL(10,2) NOT NULL DEFAULT 0,
  tracking_number VARCHAR(100) NULL,          -- numéro de suivi fourni par le vendeur ou la plateforme
  payment_method  VARCHAR(30)   NULL,         -- mode de règlement (registre des achats)
  comment         VARCHAR(1000) NULL,
  total_amount    DECIMAL(10,2) NOT NULL,
  created_at      DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY IX_purchases_purchase_number (purchase_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS purchase_items (
  id          INT           NOT NULL AUTO_INCREMENT,
  purchase_id INT           NOT NULL,
  item_id     INT           NOT NULL,
  quantity    INT           NOT NULL,
  unit_price  DECIMAL(14,6) NOT NULL,
  PRIMARY KEY (id),
  KEY IX_purchase_items_purchase_id (purchase_id),
  UNIQUE KEY IX_purchase_items_item_id (item_id),
  CONSTRAINT FK_purchase_items_purchases_purchase_id
    FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
  CONSTRAINT FK_purchase_items_inventory_items_item_id
    FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sales (
  id           INT           NOT NULL AUTO_INCREMENT,
  sale_number  VARCHAR(20)   NOT NULL,        -- ex. V2026001
  sale_date    DATE          NOT NULL,
  customer     VARCHAR(150)  NULL,
  platform     VARCHAR(30)   NOT NULL,        -- Cardmarket, Ebay, Vinted, Leboncoin, FacebookMarketplace, InPerson, Other
  payment_method VARCHAR(30) NOT NULL DEFAULT 'Platform', -- Platform, BankTransfer, PayPal, Card, Cash, Check, Other
  fees         DECIMAL(10,2) NOT NULL,        -- frais (commission, envoi)
  comment      VARCHAR(1000) NULL,
  amount_paid  DECIMAL(10,2) NOT NULL DEFAULT 0, -- montant reçu du client
  tracking_number VARCHAR(100) NULL,       -- numéro fourni par la plateforme ou le transporteur
  carrier      VARCHAR(30)   NULL,          -- LaPoste, Colissimo, MondialRelay, RelaisColis, Chronopost, VintedGo, Ups, HandDelivery, Other
  shipping_cost DECIMAL(10,2) NOT NULL DEFAULT 0, -- coût réel de l'envoi (fournitures consommées)
  total_amount DECIMAL(10,2) NOT NULL,
  refunded_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit       DECIMAL(10,2) NOT NULL,
  customer_address VARCHAR(500) NULL,
  customer_siren   VARCHAR(20)  NULL,
  invoice_number   VARCHAR(20)  NULL,          -- ex. F2026001
  invoice_date     DATE         NULL,
  created_at   DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY IX_sales_sale_number (sale_number),
  KEY IX_sales_sale_date (sale_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sale_items (
  id                INT           NOT NULL AUTO_INCREMENT,
  sale_id           INT           NOT NULL,
  inventory_item_id INT           NOT NULL,
  quantity          INT           NOT NULL,
  sale_price        DECIMAL(14,6) NOT NULL,   -- prix de vente unitaire
  unit_cost         DECIMAL(14,6) NOT NULL,   -- coût d'achat unitaire figé à la vente
  PRIMARY KEY (id),
  KEY IX_sale_items_sale_id (sale_id),
  KEY IX_sale_items_inventory_item_id (inventory_item_id),
  CONSTRAINT FK_sale_items_sales_sale_id
    FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT FK_sale_items_inventory_items_inventory_item_id
    FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sale_refunds (
  id          INT           NOT NULL AUTO_INCREMENT,
  sale_id     INT           NOT NULL,
  refund_date DATE          NOT NULL,
  amount      DECIMAL(10,2) NOT NULL,
  reason      VARCHAR(500)  NULL,
  created_at  DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  KEY IX_sale_refunds_sale_id (sale_id),
  CONSTRAINT FK_sale_refunds_sales_sale_id FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS sale_refund_items (
  id           INT        NOT NULL AUTO_INCREMENT,
  refund_id    INT        NOT NULL,
  sale_item_id INT        NOT NULL,
  quantity     INT        NOT NULL,
  restocked    TINYINT(1) NOT NULL,             -- 1 = article remis en stock
  PRIMARY KEY (id),
  KEY IX_sale_refund_items_refund_id (refund_id),
  KEY IX_sale_refund_items_sale_item_id (sale_item_id),
  CONSTRAINT FK_sale_refund_items_sale_refunds_refund_id FOREIGN KEY (refund_id) REFERENCES sale_refunds (id) ON DELETE CASCADE,
  CONSTRAINT FK_sale_refund_items_sale_items_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Fichiers joints (le contenu est stocké sur disque, dans backend/data/uploads)
CREATE TABLE IF NOT EXISTS attachments (
  id           INT          NOT NULL AUTO_INCREMENT,
  owner_type   VARCHAR(30)  NOT NULL,           -- InventoryItem, Purchase, Sale
  owner_id     INT          NOT NULL,
  kind         VARCHAR(30)  NOT NULL,           -- Photo, Receipt, Listing, OriginProof, Other
  file_name    VARCHAR(255) NOT NULL,
  stored_name  VARCHAR(100) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size         BIGINT       NOT NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  uploaded_at  DATETIME(6)  NOT NULL,
  PRIMARY KEY (id),
  KEY IX_attachments_owner_type_owner_id (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
-- Frais d'envoi : achats de fournitures (E2026001…), consommées en FIFO par les envois des ventes
CREATE TABLE IF NOT EXISTS shipping_supplies (
  id                 INT           NOT NULL AUTO_INCREMENT,
  supply_number      VARCHAR(20)   NOT NULL,     -- ex. E2026001
  purchase_date      DATE          NOT NULL,
  kind               VARCHAR(30)   NOT NULL,     -- Stamp, Label, Envelope, Protection, Box, Other
  carrier            VARCHAR(30)   NULL,
  name               VARCHAR(200)  NOT NULL,     -- ex. Timbre Lettre verte 20 g
  quantity           INT           NOT NULL,
  remaining_quantity INT           NOT NULL,
  total_amount       DECIMAL(10,2) NOT NULL,
  unit_cost          DECIMAL(14,6) NOT NULL,
  supplier           VARCHAR(150)  NULL,
  payment_method     VARCHAR(30)   NULL,
  comment            VARCHAR(1000) NULL,
  created_at         DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY IX_shipping_supplies_supply_number (supply_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS shipping_usages (
  id        INT           NOT NULL AUTO_INCREMENT,
  sale_id   INT           NOT NULL,
  supply_id INT           NOT NULL,
  quantity  INT           NOT NULL,
  unit_cost DECIMAL(14,6) NOT NULL,              -- coût unitaire figé au moment de l'envoi
  PRIMARY KEY (id),
  KEY IX_shipping_usages_sale_id (sale_id),
  KEY IX_shipping_usages_supply_id (supply_id),
  CONSTRAINT FK_shipping_usages_sales_sale_id FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT FK_shipping_usages_shipping_supplies_supply_id FOREIGN KEY (supply_id) REFERENCES shipping_supplies (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Catalogue des cartes importé depuis TCGdex : cote saisie à la main, estimation de collections.
CREATE TABLE IF NOT EXISTS card_catalog (
  id               INT           NOT NULL AUTO_INCREMENT,
  tcgdex_id        VARCHAR(50)   NOT NULL,  -- ex. me02-095
  set_id           VARCHAR(30)   NOT NULL,  -- ex. me02
  set_code         VARCHAR(20)   NULL,      -- ex. PFL
  set_name         VARCHAR(150)  NOT NULL,
  serie_name       VARCHAR(100)  NULL,      -- bloc, ex. Méga-Évolution
  release_date     DATE          NULL,
  number           VARCHAR(20)   NOT NULL,
  sort_order       INT           NOT NULL,
  name             VARCHAR(200)  NOT NULL,
  rarity           VARCHAR(60)   NULL,
  image_url        VARCHAR(300)  NULL,      -- sans extension (+ /low.webp ou /high.webp)
  cardmarket_id    BIGINT        NULL,      -- idProduct Cardmarket
  quote            DECIMAL(10,2) NULL,      -- cote saisie à la main (prix FR NM)
  quote_updated_at DATETIME(6)   NULL,
  created_at       DATETIME(6)   NOT NULL,
  updated_at       DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY IX_card_catalog_tcgdex_id (tcgdex_id),
  KEY IX_card_catalog_set_id (set_id),
  KEY IX_card_catalog_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
