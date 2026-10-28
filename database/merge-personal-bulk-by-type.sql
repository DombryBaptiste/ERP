-- Fusionne les lignes de stock "Bulk" provenant de la collection personnelle,
-- par nom de bulk (ex. Communes, Reverse).
--
-- MySQL 8. Faire une sauvegarde avant execution. Les couts historiques des
-- ventes restent sur sale_items.unit_cost, mais le cout du stock fusionne
-- devient un cout moyen pondere : le FIFO entre lots est donc perdu.
--
-- Lancer d'abord la requete de controle seule, puis le script complet si
-- les groupes affiches sont bien ceux a fusionner.

USE pokestock;

SELECT
    MIN(i.name) AS bulk_type,
    COUNT(*) AS lots,
    SUM(i.quantity) AS total_quantity,
    SUM(i.remaining_quantity) AS remaining_quantity
FROM inventory_items i
JOIN purchase_items pi ON pi.item_id = i.id
JOIN purchases p ON p.id = pi.purchase_id
WHERE i.type = 'Bulk'
  AND p.source = 'PersonalCollection'
GROUP BY BINARY i.name
HAVING COUNT(*) > 1
ORDER BY bulk_type;

-- Le script complet ci-dessous fusionne les lignes et conserve le lot ayant
-- le plus petit id comme ligne resultante.

DROP TEMPORARY TABLE IF EXISTS tmp_personal_bulk_groups;
CREATE TEMPORARY TABLE tmp_personal_bulk_groups AS
SELECT
    MIN(i.id) AS target_id,
    MIN(i.name) AS bulk_type,
    COUNT(*) AS lot_count,
    SUM(i.quantity) AS total_quantity,
    SUM(i.remaining_quantity) AS remaining_quantity,
    ROUND(SUM(i.purchase_price * i.quantity) / NULLIF(SUM(i.quantity), 0), 6) AS weighted_price,
    CASE
        WHEN COUNT(DISTINCT i.location) + (COUNT(*) > COUNT(i.location)) = 1
            THEN MIN(i.location)
        ELSE NULL
    END AS merged_location
FROM inventory_items i
JOIN purchase_items pi ON pi.item_id = i.id
JOIN purchases p ON p.id = pi.purchase_id
WHERE i.type = 'Bulk'
  AND p.source = 'PersonalCollection'
GROUP BY BINARY i.name
HAVING COUNT(*) > 1;

DROP TEMPORARY TABLE IF EXISTS tmp_personal_bulk_map;
CREATE TEMPORARY TABLE tmp_personal_bulk_map AS
SELECT
    i.id AS source_id,
    g.target_id
FROM inventory_items i
JOIN purchase_items pi ON pi.item_id = i.id
JOIN purchases p ON p.id = pi.purchase_id
JOIN tmp_personal_bulk_groups g ON BINARY g.bulk_type = BINARY i.name
WHERE i.type = 'Bulk'
  AND p.source = 'PersonalCollection'
  AND i.id <> g.target_id;

DROP TEMPORARY TABLE IF EXISTS tmp_personal_bulk_purchases;
CREATE TEMPORARY TABLE tmp_personal_bulk_purchases AS
SELECT DISTINCT pi.purchase_id
FROM purchase_items pi
JOIN tmp_personal_bulk_map m ON m.source_id = pi.item_id
UNION
SELECT DISTINCT pi.purchase_id
FROM purchase_items pi
JOIN tmp_personal_bulk_groups g ON g.target_id = pi.item_id;

START TRANSACTION;

-- Preserve sale and refund history by moving sale lines to the retained item.
UPDATE sale_items si
JOIN tmp_personal_bulk_map m ON m.source_id = si.inventory_item_id
SET si.inventory_item_id = m.target_id;

-- Keep attachments on the retained inventory item.
UPDATE attachments a
JOIN tmp_personal_bulk_map m ON m.source_id = a.owner_id
SET a.owner_id = m.target_id
WHERE a.owner_type = 'InventoryItem';

-- Remove the purchase links for duplicate stock items before deleting them.
DELETE pi
FROM purchase_items pi
JOIN tmp_personal_bulk_map m ON m.source_id = pi.item_id;

-- Consolidate quantities and use a weighted average for the remaining stock.
UPDATE inventory_items i
JOIN tmp_personal_bulk_groups g ON g.target_id = i.id
SET i.quantity = g.total_quantity,
    i.remaining_quantity = g.remaining_quantity,
    i.purchase_price = g.weighted_price,
    i.location = g.merged_location;

UPDATE purchase_items pi
JOIN tmp_personal_bulk_groups g ON g.target_id = pi.item_id
SET pi.quantity = g.total_quantity,
    pi.unit_price = g.weighted_price;

DELETE i
FROM inventory_items i
JOIN tmp_personal_bulk_map m ON m.source_id = i.id;

-- Keep every transfer header/number. Recalculate its total from the lines
-- that remain after the stock consolidation.
UPDATE purchases p
JOIN tmp_personal_bulk_purchases affected ON affected.purchase_id = p.id
LEFT JOIN (
    SELECT purchase_id, SUM(quantity * unit_price) AS lines_total
    FROM purchase_items
    GROUP BY purchase_id
) totals ON totals.purchase_id = p.id
SET p.total_amount = ROUND(
    COALESCE(totals.lines_total, 0) + p.platform_fees + p.shipping_fees,
    2
);

COMMIT;

SELECT
    g.bulk_type,
    g.target_id AS retained_inventory_item_id,
    g.lot_count AS merged_lots,
    g.total_quantity,
    g.remaining_quantity
FROM tmp_personal_bulk_groups g
ORDER BY g.bulk_type;

DROP TEMPORARY TABLE IF EXISTS tmp_personal_bulk_purchases;
DROP TEMPORARY TABLE IF EXISTS tmp_personal_bulk_map;
DROP TEMPORARY TABLE IF EXISTS tmp_personal_bulk_groups;
