-- ============================================================
-- PokéStock — création de la base et de l'utilisateur MySQL
-- À exécuter une seule fois en tant que root (MySQL Workbench,
-- ou : mysql -u root -p < database/create-database.sql)
-- Pensez à changer le mot de passe et à le reporter dans
-- backend/appsettings.json (ConnectionStrings:Default).
-- ============================================================

CREATE DATABASE IF NOT EXISTS pokestock
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'pokestock'@'localhost' IDENTIFIED BY 'pokestock';
GRANT ALL PRIVILEGES ON pokestock.* TO 'pokestock'@'localhost';
FLUSH PRIVILEGES;
