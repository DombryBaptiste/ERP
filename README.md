# PokéStock — gestion de stock et comptabilité simplifiée

Application web pour une micro-entreprise d'achat / revente de cartes Pokémon et de produits scellés :
achats, inventaire, ventes, chiffre d'affaires, bénéfices, statistiques et fiscalité (URSSAF, impôts, TVA).

| Couche | Technologie |
|---|---|
| Frontend | Angular 20 (composants standalone, signals) + Angular Material 3 + Chart.js |
| Backend | ASP.NET Core 8 (API REST) + Entity Framework Core |
| Base de données | MySQL 8 (fournisseur Pomelo) |

> **Usage local, sans authentification.** L'API n'écoute que sur `localhost` et, sous Docker, les ports
> ne sont ouverts que sur `127.0.0.1`. N'exposez pas l'application sur Internet ou sur un réseau partagé.

---

## 1. Prérequis (Windows)

| Outil | Version | Lien |
|---|---|---|
| .NET SDK | 8.0 | https://dotnet.microsoft.com/download/dotnet/8.0 |
| Node.js | 20.19+ ou 22 LTS | https://nodejs.org |
| MySQL Server | 8.0 ou 8.4 | https://dev.mysql.com/downloads/installer/ |

Vérification dans un terminal :

```bat
dotnet --version
node --version
npm --version
```

> Docker Desktop est facultatif (voir § 6).

---

## 2. Configuration MySQL

1. Installez MySQL Server (MySQL Installer → « Server only » suffit) et notez le mot de passe `root`.
2. Créez la base et l'utilisateur de l'application :

   ```bat
   mysql -u root -p < database\create-database.sql
   ```

   (ou ouvrez `database/create-database.sql` dans MySQL Workbench et exécutez-le).

   Cela crée la base `pokestock` et l'utilisateur `pokestock` / mot de passe `pokestock`.
   **Changez ce mot de passe** dans le script si la machine est accessible par d'autres personnes.

3. **Les tables sont créées automatiquement** au premier démarrage de l'API.
   Le script `database/schema.sql` contient le schéma équivalent, pour référence ou création manuelle.

### Schéma

```
app_settings     (setting_key, value JSON, updated_at)   ← paramètres fiscaux, périodes déclarées
purchases        (id, purchase_number, purchase_date, supplier, comment, total_amount, created_at)
purchase_items   (id, purchase_id → purchases, item_id → inventory_items, quantity, unit_price)
inventory_items  (id, name, category, type, condition, purchase_price, quantity,
                  remaining_quantity, location, purchase_date, created_at)
sales            (id, sale_number, sale_date, customer, platform, fees, comment,
                  total_amount, profit, created_at)
sale_items       (id, sale_id → sales, inventory_item_id → inventory_items,
                  quantity, sale_price, unit_cost)
```

Ajouts par rapport au cahier des charges, utiles en conditions réelles :
- `purchases.comment` : le commentaire du formulaire d'achat ;
- `sales.fees` : frais de vente (commission Cardmarket/eBay, envoi), **déduits du bénéfice** ;
- `sales.comment` : n° de suivi, remarque ;
- `sale_items.unit_cost` : coût d'achat figé au moment de la vente, pour que l'historique des bénéfices reste juste même si le prix d'achat d'un article est corrigé plus tard.

---

## 3. Variables d'environnement / configuration

La configuration de l'API se trouve dans `backend/appsettings.json` :

| Clé | Rôle | Valeur par défaut |
|---|---|---|
| `ConnectionStrings:Default` | Connexion MySQL | `Server=localhost;Port=3306;Database=pokestock;User=pokestock;Password=pokestock;` |
| `Cors:Origins` | Origines autorisées si le frontend est servi ailleurs | `http://localhost:4200` |

Chaque clé peut être remplacée par une **variable d'environnement** (`:` devient `__`), par exemple :

```bat
set ConnectionStrings__Default=Server=localhost;Port=3306;Database=pokestock;User=pokestock;Password=MonMotDePasse;
```

Les taux fiscaux ne sont pas dans ce fichier : ils se règlent dans l'application (Fiscalité → Paramètres).

Pour ne pas modifier le fichier suivi par Git, vous pouvez aussi créer `backend/appsettings.Development.json`
(ignoré par Git) avec seulement les clés à surcharger.

Le frontend n'a pas de configuration : en développement, `ng serve` relaie `/api` vers `http://localhost:5000`
(`frontend/proxy.conf.json`) ; sous Docker, c'est Nginx qui s'en charge.

---

## 4. Lancement du projet

### En un clic

Double-cliquez sur **`start.bat`** à la racine. Le script :
1. démarre l'API dans une fenêtre « PokeStock API » (http://localhost:5000) ;
2. installe les dépendances npm au premier lancement, puis démarre Angular dans une fenêtre « PokeStock Web » ;
3. attend la fin de la compilation et ouvre **http://localhost:4200**.

Pour arrêter l'application, fermez les deux fenêtres.

### Manuellement (deux terminaux)

```bat
cd backend
dotnet run
```

```bat
cd frontend
npm install
npm start
```

Ouvrez ensuite http://localhost:4200.

### Premier lancement

Aucune connexion n'est demandée. Commencez par **Fiscalité → Paramètres** : date de début d'activité,
fréquence de déclaration URSSAF (mensuelle ou trimestrielle), versement libératoire, ACRE et montant de CFE.

La documentation interactive de l'API (Swagger) est disponible en développement sur http://localhost:5000/swagger.

---

## 5. Fonctionnement

### Achats
- Numéro généré automatiquement : `A` + année + séquence (`A2026001`, `A2026002`…), remis à zéro chaque année.
- Un achat contient plusieurs lignes (nom, catégorie/série, type, état, quantité, prix unitaire, localisation).
  **Chaque ligne crée un article dans l'inventaire.** Le montant total est calculé automatiquement.
- Modification : on ne peut pas retirer une ligne déjà vendue, ni descendre sous la quantité vendue.
- Suppression impossible si un article de l'achat a déjà été vendu.

### Paiements, remboursements et factures
- **Mode de paiement** obligatoire sur chaque vente (proposé selon la plateforme) et sur chaque achat :
  il figure dans le livre des recettes et le registre des achats.
- **Remboursements** (bouton « Rembourser / retour » d'une vente) : total ou partiel, avec retour des articles
  en stock ou non (article abîmé, colis perdu). Le montant est déduit du CA à déclarer **pour la période du
  remboursement**, et le bénéfice est recalculé. Une vente remboursée garde ses lignes figées ; annuler le
  remboursement les rend de nouveau modifiables.
- **Factures PDF** : renseignez vos coordonnées dans **Paramètres** (nom, SIRET, adresse), puis « Éditer une facture »
  sur la vente. Numéro définitif et continu (`F2026001`…), mentions « EI », « TVA non applicable, art. 293 B du CGI »,
  mode de règlement, et mentions B2B (pénalités, indemnité de 40 €) quand le SIREN du client est renseigné.
  Une vente facturée ne peut plus être supprimée : enregistrez un remboursement.
  PDF générés avec [QuestPDF](https://www.questpdf.com) (licence Community gratuite sous 1 M$ de CA annuel).

### Valeur de marché et alertes
- Chaque article peut recevoir une **valeur de marché estimée** (colonne « Valeur marché » de l'inventaire,
  ou fiche de l'article, avec un lien de recherche Cardmarket). Saisie manuelle : aucune donnée n'est récupérée automatiquement.
- Le tableau de bord et l'inventaire affichent la **valeur de marché du stock** et la **plus-value latente**.
- Onglet **Alertes** :
  - *Prennent de la valeur* : plus-value ≥ 30 % par rapport au prix d'achat, ou hausse ≥ 15 % depuis l'estimation précédente.
  - *Stock qui dort* : en stock depuis plus de 90 jours (« à baisser ») ou 180 jours (« à liquider »), avec un conseil de prix.
  - Seuils modifiables dans **Paramètres**.

### Photos et justificatifs
- Photos des cartes (vignette dans l'inventaire), tickets et factures d'achat, captures d'annonces, preuves d'origine
  des cartes de collection : images (JPG, PNG, WEBP, GIF) ou PDF, 10 Mo maximum.
- Les fichiers sont stockés dans `backend/data/uploads` (volume `uploads` sous Docker). Ce dossier est hors Git :
  **sauvegardez-le avec la base** (justificatifs à conserver 10 ans).

### Registres comptables (onglet Registres)
- **Livre des recettes** et **registre des achats** par année, en **Excel** ou **PDF**.
- Les remboursements apparaissent en négatif dans le livre des recettes. Les transferts de collection figurent
  à part dans le registre des achats.

### Bulk (cartes en vrac)
Onglet **Bulk** : les communes, peu communes, reverses, etc. se gèrent **au nombre de cartes**, sans fiche par carte.
- **Catégories** réglables (communes / peu communes, reverses, holos, V / ex / GX, dresseurs, énergies…), chacune avec
  un **prix conseillé par carte**. Chaque catégorie est un produit de type « Bulk » dans l'inventaire.
- **Ajouter du bulk** : nombre de cartes **ou poids** (≈ 1,8 g par carte, réglable) et coût total.
  Cela crée un achat (A…) ou un transfert de collection (C…, 0 €), avec un coût par carte (ex. 30 € / 3 000 = 0,01 €).
- **Vendre un lot** : catégorie, nombre de cartes (ou poids), prix du lot proposé d'après le prix conseillé.
  Les cartes les plus anciennes partent en premier (FIFO) ; coût réel, bénéfice et marge sont affichés avant de valider.
  C'est une vente normale : CA, URSSAF, livre des recettes et statistiques sont à jour.
- Calculatrice « compter au poids », historique des ajouts et des ventes de bulk.
- Les prix unitaires sont stockés avec 6 décimales (0,133333 € la carte), pour que le total d'un lot tombe juste au centime.

### Cartes de votre collection personnelle
- **Achats → « Depuis ma collection »** (aussi depuis l'Inventaire) : transfert de cartes de la collection perso vers le stock
  professionnel, **sans prix d'achat** (valeur retenue à 0 €, ou le prix payé à l'époque pour suivre le vrai bénéfice).
- Numérotation distincte `C2026001`… ; ces transferts **ne comptent pas dans le total des achats**.
- Les ventes de ces articles sont des ventes professionnelles : elles entrent dans le CA déclaré à l'URSSAF
  (la Fiscalité affiche la part du CA qui en provient). En micro-entreprise, le prix d'achat n'influe pas sur les cotisations :
  un coût de 0 € est donc sans incidence fiscale.
- Alternative légale, hors application : vendre une carte comme particulier (vente occasionnelle d'un bien personnel,
  sans impôt jusqu'à 5 000 € par objet). Le guide de l'onglet Fiscalité détaille les deux options.

### Inventaire
- Liste complète avec recherche instantanée et filtres (catégorie, type, état, origine, en stock / vendu).
- **Regroupement par produit** : chaque ligne d'achat crée un *lot* avec son propre prix (indispensable pour le
  registre des achats et un bénéfice exact). Les lots d'un même produit (même nom, sans tenir compte des
  accents ni des majuscules, même type, même état) sont affichés sur **une seule ligne** :
  - quantité totale, **coût unitaire moyen pondéré** (CUMP) du stock restant, valeur du stock et de marché ;
  - flèche pour déplier le détail des lots (date, n° d'achat, prix, restant, localisation) ;
  - la valeur de marché saisie sur le produit s'applique à tous ses lots.
- **Ventes en FIFO** : on vend un produit, et les lots les plus anciens partent en premier. Le bénéfice
  utilise le prix réel de chaque lot (ex. 2 unités à 4,50 € + 1 à 6,00 €).
- À la saisie d'un achat, le nom propose les produits déjà en stock et reprend leur type et leur état,
  pour que le nouveau lot rejoigne bien le même produit.
- Un article peut être ajouté manuellement (sans achat), par exemple une carte de votre collection personnelle.
- Bouton **Vendre** sur une ligne : ouvre une nouvelle vente avec l'article déjà sélectionné.

### Ventes
- Numéro généré automatiquement : `V2026001`…
- Plusieurs articles par vente, recherchés dans le stock disponible. Pour chaque ligne : quantité et prix de vente unitaire.
- Calculs automatiques : **montant total**, **bénéfice** = total − coût d'achat − frais, **marge** = bénéfice / total.
- **Le stock est décrémenté automatiquement.** Modifier une vente réajuste le stock ; supprimer une vente remet les articles en stock.
- Historique avec filtres par période, plateforme et client, et totaux des lignes filtrées.

### Tableau de bord et statistiques
- Tableau de bord : articles en stock, valeur du stock, ventes / CA / bénéfice du mois, total des achats,
  évolution du CA et des bénéfices sur 12 mois, répartition cartes / scellés, dernières ventes.
- Statistiques par année : CA et bénéfice annuels et mensuels, valeur du stock, CA et bénéfices par mois,
  meilleures ventes, produits les plus rentables, récapitulatif mensuel.

### Fiscalité (onglet dédié)

Calculs tirés automatiquement de vos ventes. **Tous les taux et seuils sont modifiables** (barème 2026 par défaut) :

| Élément | Valeur 2026 par défaut (vente de marchandises) |
|---|---|
| Cotisations sociales | 12,3 % du CA encaissé |
| Formation professionnelle (CFP) | 0,1 % |
| Taxe pour frais de chambre (CCI) | 0,015 % |
| Versement libératoire de l'IR (option) | 1 % (sinon abattement de 71 % et imposition au barème) |
| ACRE | -50 % sur les cotisations sociales (création avant le 01/07/2026), -25 % ensuite |
| Plafond micro | 203 100 € |
| Franchise de TVA / seuil majoré | 85 000 € / 93 500 € |

- **Synthèse** : prochaine déclaration (montant, échéance, lien vers l'URSSAF), pourcentage à mettre de côté,
  répartition de chaque euro encaissé, jauges des seuils avec projection sur l'année, seuils DAC7 par plateforme.
- **Déclarations** : chaque mois ou trimestre avec le CA à déclarer (copiable en un clic), le détail des cotisations,
  l'échéance et une case « déclarée » pour le suivi.
- **Simulateur** : ce qu'il reste réellement sur une vente, et prix de vente à fixer pour gagner un montant net donné.
- **Paramètres** : préréglages par activité (vente, services BIC, BNC), ACRE calculée depuis la date de création, CFE…
- **Guide** : le statut expliqué simplement (déclarations, impôt, TVA et régime de la marge, CFE, obligations, DAC7).

Les montants sont des estimations : l'URSSAF et l'administration fiscale font foi.

### API REST

| Méthode | Route | Description |
|---|---|---|
| GET / POST | `/api/purchases` | Liste (`?search=&from=&to=`) / création |
| GET / PUT / DELETE | `/api/purchases/:id` | Détail / modification / suppression |
| GET / POST | `/api/inventory` | Liste (`?search=&category=&type=&condition=&status=instock\|sold`) / création |
| GET | `/api/inventory/categories` | Catégories déjà utilisées |
| GET / PUT / DELETE | `/api/inventory/:id` | Détail / modification / suppression |
| GET / POST | `/api/sales` | Liste (`?from=&to=&platform=&customer=`) / création |
| GET / PUT / DELETE | `/api/sales/:id` | Détail / modification / suppression |
| GET | `/api/dashboard` | Indicateurs du tableau de bord |
| GET | `/api/statistics?year=2026` | Statistiques annuelles |
| GET | `/api/tax/summary?year=2026` | Synthèse fiscale : périodes, cotisations, impôt, seuils, DAC7 |
| GET / PUT | `/api/tax/settings` | Paramètres fiscaux |
| PUT | `/api/tax/declarations/:periodKey` | Marque une période (`2026-T3`, `2026-M09`) comme déclarée : `{ "declared": true }` |
| POST | `/api/sales/:id/refunds` | Remboursement `{ refundDate, amount, reason, restock, items: [{ saleItemId, quantity }] }` |
| DELETE | `/api/sales/:id/refunds/:refundId` | Annulation d'un remboursement |
| POST / GET | `/api/sales/:id/invoice` | Émission du numéro de facture / PDF de la facture (`?download=true`) |
| PUT | `/api/inventory/:id/market-value` | Valeur de marché estimée `{ value }` |
| GET / POST | `/api/attachments` | Liste (`?ownerType=InventoryItem\|Purchase\|Sale&ownerId=`) / envoi (multipart : `ownerType`, `ownerId`, `kind`, `file`) |
| GET / DELETE | `/api/attachments/:id/file`, `/api/attachments/:id` | Contenu du fichier / suppression |
| GET | `/api/alerts` | Valeur de marché en hausse et stock dormant |
| GET | `/api/exports/receipts?year=&format=xlsx\|pdf` | Livre des recettes |
| GET | `/api/exports/purchases?year=&format=xlsx\|pdf` | Registre des achats |
| GET / PUT | `/api/settings` | Préférences (entreprise, seuils d'alerte) |
| GET | `/api/health` | État de l'API |

Valeurs des énumérations (JSON) :
- `type` : `RawCard`, `GradedCard`, `Booster`, `Blister`, `Etb`, `Box` (coffret), `Display`, `Other`
- `condition` : `New`, `Excellent`, `VeryGood`, `Good`, `Fair`
- `platform` : `Cardmarket`, `Ebay`, `Vinted`, `Leboncoin`, `FacebookMarketplace`, `InPerson`, `Other`

---

## 6. Lancement avec Docker (facultatif)

```bat
copy .env.example .env
docker compose up -d --build
```

- Application : http://localhost:8080 (accessible uniquement depuis ce PC)
- MySQL est accessible depuis ce PC sur le port **3307** (données dans le volume `db-data`).
- Modifiez les mots de passe dans `.env` avant la première mise en route.

---

## 7. Structure du projet

```
ERP/
├── start.bat                 Lancement en un clic
├── docker-compose.yml        MySQL + API + frontend Nginx
├── database/
│   ├── create-database.sql   Création de la base et de l'utilisateur
│   └── schema.sql            Schéma des tables (référence)
├── backend/                  API ASP.NET Core 8
│   ├── Program.cs            Configuration (EF Core, JWT, CORS, Swagger)
│   ├── Models/               Entités et énumérations
│   ├── Data/                 DbContext + initialisation du schéma
│   ├── Dtos/                 Objets échangés avec le frontend
│   ├── Services/             Règles métier (achats, stock, ventes, statistiques)
│   ├── Controllers/          Endpoints REST
│   └── Middleware/           Gestion centralisée des erreurs
└── frontend/                 Application Angular
    └── src/app/
        ├── core/             Modèles, services API, authentification, i18n
        ├── layout/           Menu latéral + barre supérieure
        ├── shared/           Graphiques, cartes KPI, dialogues, pipes
        └── features/         dashboard, purchases, inventory, sales, statistics, tax
```

---

## 8. Sauvegarde et évolutions

- **Sauvegarde** : copiez aussi le dossier `backend/data/uploads` (photos et justificatifs). Pensez à exporter régulièrement la base, par exemple
  `mysqldump -u pokestock -p pokestock > sauvegarde-2026-09-30.sql` (planifiable avec le Planificateur de tâches Windows).
- **Évolution du schéma** : le schéma est créé par `EnsureCreated`, qui ne modifie pas une base existante.
  Pour faire évoluer les tables sans perdre de données, passez aux migrations EF Core
  (`dotnet tool install --global dotnet-ef`, puis `dotnet ef migrations add ...`).
- **Mise à jour d'Angular** : `npx ng update @angular/core @angular/cli @angular/material`.
- **Mise à jour de .NET** : le support de .NET 8 se termine en novembre 2026. Le passage à .NET 10 (LTS)
  se fait en changeant `TargetFramework` et les versions de paquets dans `backend/PokeStock.Api.csproj`.
