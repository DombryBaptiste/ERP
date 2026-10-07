-- ============================================================================
-- PokéStock — base de TEST avec des données d'exemple
--
-- Crée la base `pokestock_test` (elle est SUPPRIMÉE puis recréée à chaque exécution),
-- son schéma complet et un an d'activité fictive (octobre 2025 → septembre 2026) :
--   - 8 achats + 2 transferts depuis la collection personnelle, 18 articles (dont 2 catégories de bulk)
--   - 20 ventes (dont une facturée à un pro et 2 lots de bulk), 2 remboursements (dont un retour remis en stock)
--   - des valeurs de marché (alertes « prennent de la valeur ») et du stock dormant
--   - les paramètres fiscaux (ACRE, déclaration trimestrielle) et les infos d'entreprise (factures)
--
-- Exécution (en root) :
--   mysql -u root -p < database\seed-test.sql
-- Puis, dans backend/appsettings.json :
--   "Default": "Server=localhost;Port=3306;Database=pokestock_test;User=pokestock;Password=pokestock;"
--
-- Toutes les personnes, adresses et numéros (SIRET, SIREN) sont fictifs.
-- ============================================================================

SET NAMES utf8mb4;

DROP DATABASE IF EXISTS pokestock_test;
CREATE DATABASE pokestock_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'pokestock'@'localhost' IDENTIFIED BY 'pokestock';
GRANT ALL PRIVILEGES ON pokestock_test.* TO 'pokestock'@'localhost';
FLUSH PRIVILEGES;

USE pokestock_test;

-- ----------------------------------------------------------------------------
-- Schéma (identique à celui créé par l'application)
-- ----------------------------------------------------------------------------

CREATE TABLE app_settings (
  setting_key VARCHAR(100) NOT NULL,
  value       LONGTEXT     NOT NULL,
  updated_at  DATETIME(6)  NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE inventory_items (
  id                      INT           NOT NULL AUTO_INCREMENT,
  name                    VARCHAR(200)  NOT NULL,
  category                VARCHAR(100)  NULL,
  language                VARCHAR(50)   NULL,
  is_listed_on_cardmarket TINYINT(1)    NOT NULL DEFAULT 0,
  type                    VARCHAR(30)   NOT NULL,
  `condition`             VARCHAR(30)   NOT NULL,
  purchase_price          DECIMAL(14,6) NOT NULL,
  quantity                INT           NOT NULL,
  remaining_quantity      INT           NOT NULL,
  location                VARCHAR(100)  NULL,
  purchase_date           DATE          NOT NULL,
  market_value            DECIMAL(10,2) NULL,
  previous_market_value   DECIMAL(10,2) NULL,
  market_value_updated_at DATETIME(6)   NULL,
  created_at              DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  KEY IX_inventory_items_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE purchases (
  id              INT           NOT NULL AUTO_INCREMENT,
  purchase_number VARCHAR(20)   NOT NULL,
  source          VARCHAR(30)   NOT NULL DEFAULT 'Supplier',
  purchase_date   DATE          NOT NULL,
  supplier        VARCHAR(150)  NOT NULL,
  payment_method  VARCHAR(30)   NULL,
  comment         VARCHAR(1000) NULL,
  total_amount    DECIMAL(10,2) NOT NULL,
  created_at      DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY IX_purchases_purchase_number (purchase_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE purchase_items (
  id          INT           NOT NULL AUTO_INCREMENT,
  purchase_id INT           NOT NULL,
  item_id     INT           NOT NULL,
  quantity    INT           NOT NULL,
  unit_price  DECIMAL(14,6) NOT NULL,
  PRIMARY KEY (id),
  KEY IX_purchase_items_purchase_id (purchase_id),
  UNIQUE KEY IX_purchase_items_item_id (item_id),
  CONSTRAINT FK_purchase_items_purchases_purchase_id FOREIGN KEY (purchase_id) REFERENCES purchases (id) ON DELETE CASCADE,
  CONSTRAINT FK_purchase_items_inventory_items_item_id FOREIGN KEY (item_id) REFERENCES inventory_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sales (
  id               INT           NOT NULL AUTO_INCREMENT,
  sale_number      VARCHAR(20)   NOT NULL,
  sale_date        DATE          NOT NULL,
  customer         VARCHAR(150)  NULL,
  platform         VARCHAR(30)   NOT NULL,
  payment_method   VARCHAR(30)   NOT NULL DEFAULT 'Platform',
  fees             DECIMAL(10,2) NOT NULL,
  comment          VARCHAR(1000) NULL,
  total_amount     DECIMAL(10,2) NOT NULL,
  refunded_amount  DECIMAL(10,2) NOT NULL DEFAULT 0,
  profit           DECIMAL(10,2) NOT NULL,
  customer_address VARCHAR(500)  NULL,
  customer_siren   VARCHAR(20)   NULL,
  invoice_number   VARCHAR(20)   NULL,
  invoice_date     DATE          NULL,
  created_at       DATETIME(6)   NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY IX_sales_sale_number (sale_number),
  KEY IX_sales_sale_date (sale_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sale_items (
  id                INT           NOT NULL AUTO_INCREMENT,
  sale_id           INT           NOT NULL,
  inventory_item_id INT           NOT NULL,
  quantity          INT           NOT NULL,
  sale_price        DECIMAL(14,6) NOT NULL,
  unit_cost         DECIMAL(14,6) NOT NULL,
  PRIMARY KEY (id),
  KEY IX_sale_items_sale_id (sale_id),
  KEY IX_sale_items_inventory_item_id (inventory_item_id),
  CONSTRAINT FK_sale_items_sales_sale_id FOREIGN KEY (sale_id) REFERENCES sales (id) ON DELETE CASCADE,
  CONSTRAINT FK_sale_items_inventory_items_inventory_item_id FOREIGN KEY (inventory_item_id) REFERENCES inventory_items (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE sale_refunds (
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

CREATE TABLE sale_refund_items (
  id           INT        NOT NULL AUTO_INCREMENT,
  refund_id    INT        NOT NULL,
  sale_item_id INT        NOT NULL,
  quantity     INT        NOT NULL,
  restocked    TINYINT(1) NOT NULL,
  PRIMARY KEY (id),
  KEY IX_sale_refund_items_refund_id (refund_id),
  KEY IX_sale_refund_items_sale_item_id (sale_item_id),
  CONSTRAINT FK_sale_refund_items_sale_refunds_refund_id FOREIGN KEY (refund_id) REFERENCES sale_refunds (id) ON DELETE CASCADE,
  CONSTRAINT FK_sale_refund_items_sale_items_sale_item_id FOREIGN KEY (sale_item_id) REFERENCES sale_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE attachments (
  id           INT          NOT NULL AUTO_INCREMENT,
  owner_type   VARCHAR(30)  NOT NULL,
  owner_id     INT          NOT NULL,
  kind         VARCHAR(30)  NOT NULL,
  file_name    VARCHAR(255) NOT NULL,
  stored_name  VARCHAR(100) NOT NULL,
  content_type VARCHAR(100) NOT NULL,
  size         BIGINT       NOT NULL,
  sort_order   INT          NOT NULL DEFAULT 0,
  uploaded_at  DATETIME(6)  NOT NULL,
  PRIMARY KEY (id),
  KEY IX_attachments_owner_type_owner_id (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ----------------------------------------------------------------------------
-- Paramètres : fiscalité (ACRE à 50 %, trimestriel), entreprise (factures), alertes
-- ----------------------------------------------------------------------------

INSERT INTO app_settings (setting_key, value, updated_at) VALUES
('tax.settings',
 '{"activity":"Sales","creationDate":"2025-09-15T00:00:00","frequency":"Quarterly","socialRate":12.3,"trainingRate":0.1,"chamberTaxRate":0.015,"liberatoryIncomeTax":false,"liberatoryIncomeTaxRate":1,"flatAllowanceRate":71,"marginalTaxRate":11,"acreEnabled":true,"acreReductionRate":50,"acreStart":"2025-09-15T00:00:00","acreEnd":"2026-09-14T00:00:00","revenueCeiling":203100,"vatThreshold":85000,"vatThresholdIncreased":93500,"cfeAnnualAmount":0,"safetyMarginRate":2}',
 NOW(6)),
-- Trimestres déjà déclarés : le 3e trimestre 2026 reste « à déclarer » (échéance 31/10/2026).
('tax.declared', '["2025-T3","2025-T4","2026-T1","2026-T2"]', NOW(6)),
('app.preferences',
 '{"company":{"fullName":"Camille Martin","tradeName":"PokéStock Test","siret":"12345678900012","address":"12 rue des Dresseurs\\n59000 Lille","email":"contact@example.com","phone":"06 00 00 00 00","iban":null,"vatMention":"TVA non applicable, art. 293 B du CGI","invoiceFooter":"Merci pour votre achat !"},"alerts":{"dormantWarningDays":90,"dormantCriticalDays":180,"marketGainThreshold":30,"marketRiseThreshold":15}}',
 NOW(6));

-- ----------------------------------------------------------------------------
-- Inventaire
-- (remaining_quantity = quantité achetée − vendue + retours remis en stock)
-- ----------------------------------------------------------------------------

INSERT INTO inventory_items
  (id, name, category, type, `condition`, purchase_price, quantity, remaining_quantity, location, purchase_date,
   market_value, previous_market_value, market_value_updated_at, created_at) VALUES
( 1, 'Booster Étincelles Déferlantes',            'EV08 Étincelles Déferlantes', 'Booster', 'NM',       4.50, 20,  0, 'Étagère A',         '2025-10-04', NULL,   NULL,   NULL,                  NOW(6)),
( 2, 'ETB Étincelles Déferlantes',                'EV08 Étincelles Déferlantes', 'Etb', 'NM',      45.00,  3,  1, 'Étagère A',         '2025-10-04', 62.00,  55.00, '2026-09-20 10:00:00', NOW(6)),
( 3, 'Dracaufeu ex 199/165 SIR',                  'EV3.5 Écarlate et Violet 151','RawCard',    'EXC',85.00,  1,  0, 'Classeur 1 p.3',    '2025-11-15', NULL,   NULL,   NULL,                  NOW(6)),
( 4, 'Mew ex 205/165 SIR',                        'EV3.5 Écarlate et Violet 151','RawCard',    'GOOD', 35.00,  1,  0, 'Classeur 1 p.3',    '2025-11-15', NULL,   NULL,   NULL,                  NOW(6)),
( 5, 'Display Aventures Ensemble (36 boosters)',  'EV09 Aventures Ensemble',     'Display',    'NM',     150.00,  2,  1, 'Étagère B',         '2025-12-02', 185.00, 160.00, '2026-09-25 18:30:00', NOW(6)),
( 6, 'Pikachu ex 238/191 PSA 10',                 'EV08 Étincelles Déferlantes', 'GradedCard', 'EXC', 120.00, 1,  0, 'Boîte gradées',     '2025-12-02', NULL,   NULL,   NULL,                  NOW(6)),
( 7, 'Coffret Collection Premium Dracaufeu ex',   'Coffrets',                    'Box',        'NM',      39.99,  4,  1, 'Étagère C',         '2026-01-20', 45.00,  NULL,   '2026-08-01 09:00:00', NOW(6)),
( 8, 'Booster Évolutions Prismatiques',           'EV8.5 Évolutions Prismatiques','Booster',   'NM',       7.00, 30,  4, 'Étagère A',         '2026-01-20', 9.50,   9.00,   '2026-09-10 14:00:00', NOW(6)),
( 9, 'Lugia V 186/195 Alt Art PSA 9',             'EB12 Tempête Argentée',       'GradedCard', 'EXC',180.00, 1,  0, 'Boîte gradées',     '2026-03-08', NULL,   NULL,   NULL,                  NOW(6)),
(10, 'Ectoplasma VMAX 271/264',                   'EB08 Poing de Fusion',        'RawCard',    'LP',     25.00,  1,  0, 'Classeur 2 p.7',    '2026-03-08', NULL,   NULL,   NULL,                  NOW(6)),
(11, 'ETB Évolutions Prismatiques',               'EV8.5 Évolutions Prismatiques','Etb',       'NM',      60.00,  4,  1, 'Étagère B',         '2026-05-12', 72.00,  70.00,  '2026-09-12 11:00:00', NOW(6)),
(12, 'Display Rivalités Destinées (36 boosters)', 'EV10 Rivalités Destinées',    'Display',    'NM',     165.00,  1,  1, 'Étagère B',         '2026-08-22', 230.00, 190.00, '2026-09-28 20:00:00', NOW(6)),
(13, 'Noctali ex 217/131 SIR',                    'EV8.5 Évolutions Prismatiques','RawCard',   'EXC',140.00, 1,  1, 'Classeur 1 p.12',   '2026-08-22', 128.00, 150.00, '2026-09-28 20:05:00', NOW(6)),
(14, 'Dracaufeu 4/102 Set de Base (1999)',        'Set de Base',                 'RawCard',    'LP',      0.00,  1,  0, 'Classeur vintage',  '2026-02-01', NULL,   NULL,   NULL,                  NOW(6)),
(15, 'Florizarre 15/102 Set de Base',             'Set de Base',                 'RawCard',    'PL',      0.00,  1,  0, 'Classeur vintage',  '2026-02-01', NULL,   NULL,   NULL,                  NOW(6)),
(16, 'Lot de 100 cartes communes Écarlate et Violet','Lots',                     'Other',      'GOOD',  0.00,  1,  0, 'Boîte à lots',      '2026-02-01', NULL,   NULL,   NULL,                  NOW(6)),
(17, 'Bulk communes / peu communes',              NULL,                          'Bulk',       'EXC', 0.010000, 3000, 2500, 'Boîte à bulk 1', '2026-09-02', NULL, NULL, NULL, NOW(6)),
(18, 'Bulk reverses',                             NULL,                          'Bulk',       'EXC', 0.000000,  400,  300, 'Boîte à bulk 2', '2026-09-05', NULL, NULL, NULL, NOW(6));

-- ----------------------------------------------------------------------------
-- Achats (A…) et transfert depuis la collection personnelle (C…)
-- ----------------------------------------------------------------------------

INSERT INTO purchases (id, purchase_number, source, purchase_date, supplier, payment_method, comment, total_amount, created_at) VALUES
(1, 'A2025001', 'Supplier',           '2025-10-04', 'Leclerc Lille',                'Card',     NULL,                                     225.00, NOW(6)),
(2, 'A2025002', 'Supplier',           '2025-11-15', 'Particulier (Leboncoin)',      'Cash',     'Rachat de deux cartes, remise en main propre', 120.00, NOW(6)),
(3, 'A2025003', 'Supplier',           '2025-12-02', 'Cardmarket - SpeedyCards',     'Platform', NULL,                                     420.00, NOW(6)),
(4, 'A2026001', 'Supplier',           '2026-01-20', 'Auchan Englos',                'Card',     'Promo coffrets',                         369.96, NOW(6)),
(5, 'A2026002', 'Supplier',           '2026-03-08', 'Salon TCG Lille',              'Cash',     NULL,                                     205.00, NOW(6)),
(6, 'A2026003', 'Supplier',           '2026-05-12', 'Micromania Lille',             'Card',     NULL,                                     240.00, NOW(6)),
(7, 'A2026004', 'Supplier',           '2026-08-22', 'Cardmarket - PokéDeals',       'PayPal',   NULL,                                     305.00, NOW(6)),
(8, 'C2026001', 'PersonalCollection', '2026-02-01', 'Collection personnelle',       NULL,       'Cartes de mon ancienne collection (classeur 1999-2001), photos du classeur conservées', 0.00, NOW(6)),
(9,  'A2026005', 'Supplier',           '2026-09-02', 'Particulier (Vinted)',         'PayPal',   'Lot de bulk 3 000 cartes (5,4 kg)',      30.00, NOW(6)),
(10, 'C2026002', 'PersonalCollection', '2026-09-05', 'Collection personnelle',       NULL,       'Reverses de mes anciennes ouvertures',  0.00, NOW(6));

INSERT INTO purchase_items (id, purchase_id, item_id, quantity, unit_price) VALUES
( 1, 1,  1, 20,   4.50),
( 2, 1,  2,  3,  45.00),
( 3, 2,  3,  1,  85.00),
( 4, 2,  4,  1,  35.00),
( 5, 3,  5,  2, 150.00),
( 6, 3,  6,  1, 120.00),
( 7, 4,  7,  4,  39.99),
( 8, 4,  8, 30,   7.00),
( 9, 5,  9,  1, 180.00),
(10, 5, 10,  1,  25.00),
(11, 6, 11,  4,  60.00),
(12, 7, 12,  1, 165.00),
(13, 7, 13,  1, 140.00),
(14, 8, 14,  1,   0.00),
(15, 8, 15,  1,   0.00),
(16, 8, 16,  1,   0.00),
(17, 9, 17, 3000, 0.010000),
(18,10, 18,  400, 0.000000);

-- ----------------------------------------------------------------------------
-- Ventes
-- profit = total − remboursements − coût des articles non remis en stock − frais
-- ----------------------------------------------------------------------------

INSERT INTO sales
  (id, sale_number, sale_date, customer, platform, payment_method, fees, comment, total_amount, refunded_amount, profit,
   customer_address, customer_siren, invoice_number, invoice_date, created_at) VALUES
( 1, 'V2025001', '2025-10-18', 'dresseur59',          'Vinted',              'Platform',     0.00, NULL,                         42.00,  0.00,  15.00, NULL, NULL, NULL, NULL, NOW(6)),
( 2, 'V2025002', '2025-11-03', 'Kevin M.',            'InPerson',            'Cash',         0.00, 'Remise au salon du jeu',     65.00,  0.00,  20.00, NULL, NULL, NULL, NULL, NOW(6)),
( 3, 'V2025003', '2025-12-10', 'TCG_Collector',       'Cardmarket',          'Platform',     8.20, 'Envoi suivi',               129.90,  0.00,  36.70, NULL, NULL, NULL, NULL, NOW(6)),
( 4, 'V2025004', '2025-12-20', 'maman_de_lucas',      'Leboncoin',           'Cash',         0.00, 'Cadeau de Noël',            135.00,  0.00,  45.00, NULL, NULL, NULL, NULL, NOW(6)),
( 5, 'V2026001', '2026-01-15', 'pkmn_fr',             'Ebay',                'Platform',    12.40, NULL,                        175.00,  0.00,  42.60, NULL, NULL, NULL, NULL, NOW(6)),
( 6, 'V2026002', '2026-02-14', 'Le Repaire du Joueur','InPerson',            'BankTransfer', 0.00, 'Vente à une boutique',      210.00,  0.00,  60.00,
  'Le Repaire du Joueur SARL\n8 place du Jeu\n59800 Lille', '812345678', 'F2026001', '2026-02-14', NOW(6)),
( 7, 'V2026003', '2026-02-28', 'Lucie D.',            'Vinted',              'Platform',     0.00, NULL,                        110.00,  0.00,  30.02, NULL, NULL, NULL, NULL, NOW(6)),
( 8, 'V2026004', '2026-03-22', 'Sammy',               'Cardmarket',          'Platform',     9.50, 'Carte de ma collection',    190.00,  0.00, 180.50, NULL, NULL, NULL, NULL, NOW(6)),
( 9, 'V2026005', '2026-04-05', 'Arnaud P.',           'FacebookMarketplace', 'Cash',         0.00, NULL,                        120.00,  0.00,  36.00, NULL, NULL, NULL, NULL, NOW(6)),
(10, 'V2026006', '2026-04-27', 'cardlover33',         'Ebay',                'Platform',     4.10, NULL,                         38.00,  5.00,   3.90, NULL, NULL, NULL, NULL, NOW(6)),
(11, 'V2026007', '2026-05-30', 'Julien R.',           'Vinted',              'Platform',     0.00, NULL,                        132.00,  0.00,  30.00, NULL, NULL, NULL, NULL, NOW(6)),
(12, 'V2026008', '2026-06-18', 'nico_tcg',            'Cardmarket',          'Platform',     6.00, NULL,                        114.00, 52.00,  21.00, NULL, NULL, NULL, NULL, NOW(6)),
(13, 'V2026009', '2026-07-09', 'Marie T.',            'InPerson',            'Cash',         0.00, 'Carte de ma collection',     45.00,  0.00,  45.00, NULL, NULL, NULL, NULL, NOW(6)),
(14, 'V2026010', '2026-07-26', 'pokefan_lyon',        'Cardmarket',          'Platform',    15.20, 'Envoi assuré',              260.00,  0.00,  64.80, NULL, NULL, NULL, NULL, NOW(6)),
(15, 'V2026011', '2026-08-14', 'Thomas B.',           'Vinted',              'Platform',     0.00, NULL,                         96.00,  0.00,  22.00, NULL, NULL, NULL, NULL, NOW(6)),
(16, 'V2026012', '2026-09-06', 'Léa K.',              'Leboncoin',           'PayPal',       0.00, NULL,                        156.00,  0.00,  36.00, NULL, NULL, NULL, NULL, NOW(6)),
(17, 'V2026013', '2026-09-21', 'drakkar_cards',       'Cardmarket',          'Platform',     3.80, NULL,                         25.00,  0.00,  21.20, NULL, NULL, NULL, NULL, NOW(6)),
(18, 'V2026014', '2026-09-28', 'Hugo',                'InPerson',            'Card',         0.00, NULL,                         54.99,  0.00,  15.00, NULL, NULL, NULL, NULL, NOW(6)),
(19, 'V2026015', '2026-09-30', 'collecbulk',          'Vinted',              'Platform',     0.00, 'Lot de 500 cartes (Bulk communes / peu communes)', 10.00, 0.00, 5.00, NULL, NULL, NULL, NULL, NOW(6)),
(20, 'V2026016', '2026-10-03', 'Enzo',                'InPerson',            'Cash',         0.00, 'Lot de 100 cartes (Bulk reverses)',  8.00,  0.00,  8.00, NULL, NULL, NULL, NULL, NOW(6));

INSERT INTO sale_items (id, sale_id, inventory_item_id, quantity, sale_price, unit_cost) VALUES
( 1,  1,  1,  6,   7.00,   4.50),
( 2,  2,  2,  1,  65.00,  45.00),
( 3,  3,  3,  1, 129.90,  85.00),
( 4,  4,  1, 10,   6.50,   4.50),
( 5,  4,  2,  1,  70.00,  45.00),
( 6,  5,  6,  1, 175.00, 120.00),
( 7,  6,  5,  1, 210.00, 150.00),
( 8,  7,  7,  2,  55.00,  39.99),
( 9,  8, 14,  1, 190.00,   0.00),
(10,  9,  8, 12,  10.00,   7.00),
(11, 10, 10,  1,  38.00,  25.00),
(12, 11, 11,  1,  75.00,  60.00),
(13, 11,  8,  6,   9.50,   7.00),
(14, 12,  4,  1,  62.00,  35.00),
(15, 12,  7,  1,  52.00,  39.99),
(16, 13, 15,  1,  45.00,   0.00),
(17, 14,  9,  1, 260.00, 180.00),
(18, 15,  1,  4,   6.00,   4.50),
(19, 15,  8,  8,   9.00,   7.00),
(20, 16, 11,  2,  78.00,  60.00),
(21, 17, 16,  1,  25.00,   0.00),
(22, 18,  7,  1,  54.99,  39.99),
(23, 19, 17, 500,  0.020000, 0.010000),
(24, 20, 18, 100,  0.080000, 0.000000);

-- ----------------------------------------------------------------------------
-- Remboursements
--  1. V2026008 : retour du coffret (remis en stock), remboursé 52 €
--  2. V2026006 : geste commercial de 5 €, sans retour
-- ----------------------------------------------------------------------------

INSERT INTO sale_refunds (id, sale_id, refund_date, amount, reason, created_at) VALUES
(1, 12, '2026-06-25', 52.00, 'Retour : l''acheteur s''est trompé de produit', NOW(6)),
(2, 10, '2026-05-02',  5.00, 'Geste commercial : léger défaut de centrage non signalé', NOW(6));

INSERT INTO sale_refund_items (id, refund_id, sale_item_id, quantity, restocked) VALUES
(1, 1, 15, 1, 1);

-- ----------------------------------------------------------------------------
-- Vérification rapide
-- ----------------------------------------------------------------------------
SELECT 'Articles' AS element, COUNT(*) AS nombre FROM inventory_items
UNION ALL SELECT 'Achats et transferts', COUNT(*) FROM purchases
UNION ALL SELECT 'Ventes', COUNT(*) FROM sales
UNION ALL SELECT 'Remboursements', COUNT(*) FROM sale_refunds;
