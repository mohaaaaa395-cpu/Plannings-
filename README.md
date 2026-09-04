# CEDIF Saint-Antoine — Générateur de plannings

Application web complète et professionnelle de **génération automatique de plannings**
pour le magasin CEDIF Saint-Antoine (70 rue Saint-Antoine, 75004 Paris).

Ce n'est pas une maquette : c'est une véritable application de production, avec une base de
données PostgreSQL persistante, un moteur d'optimisation à mémoire, une gestion des
disponibilités/absences, un historique versionné, des statistiques d'équité sur le long terme,
l'export Excel / impression, l'authentification et un déploiement Railway clé en main.

---

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Le moteur de génération (« cerveau »)](#le-moteur-de-génération--cerveau-)
- [Schéma de la base de données](#schéma-de-la-base-de-données)
- [Développement local](#développement-local)
- [Déploiement sur Railway](#déploiement-sur-railway)
- [Variables d'environnement](#variables-denvironnement)
- [Sauvegarde / restauration](#sauvegarde--restauration)
- [Règles métier appliquées](#règles-métier-appliquées)

---

## Fonctionnalités

- **Couverture continue garantie (contrainte dure)** : le magasin n'est jamais vide pendant les
  heures d'ouverture. Le moteur construit les horaires et positionne les pauses pour qu'au moins
  une personne soit toujours présente (une pause n'est placée que si un collègue couvre ce créneau).
  Un indicateur visuel (🟢 / 🔴) confirme la couverture, jour par jour.
- **Indisponibilités des salariés (contrainte dure)** : indisponibilité à une date précise ou
  récurrente (jour de semaine), toute la journée ou sur une plage horaire (ex. 09:50–14:00). Le
  moteur ne planifie jamais quelqu'un pendant son indisponibilité et réorganise les autres pour
  maintenir la couverture. Section dédiée « Indisponibilités » (ajout / modification / suppression).
- **Génération automatique sur 3 semaines** à partir d'une simple date de début. Les dates
  (semaines, mois, année, années bissextiles) sont calculées automatiquement, jamais codées en dur.
- **Moteur d'optimisation à mémoire** : chaque planning validé est enregistré et sert
  d'historique pour améliorer la **rotation** et l'**équité** des générations suivantes
  (samedis, dimanches, ouvertures, fermetures, heures…).
- **Score de planning** : plusieurs candidats sont générés puis notés ; le meilleur est retenu.
  Les poids du score sont entièrement configurables.
- **Format de planning** JOUR / MATIN / APRÈS-MIDI / TOTAL, avec calcul automatique des durées
  (la pause déjeuner n'est pas comptée), total hebdomadaire et comparaison au contrat.
- **Modification manuelle** de chaque journée, enregistrée et jamais écrasée silencieusement.
- **Gestion de l'équipe**, des **contrats**, des **disponibilités** (contraintes obligatoires vs
  préférences) et des **absences / congés**.
- **Tableau de bord**, **alertes** claires, **statistiques d'équité** sur 7 semaines / 12 semaines /
  3 mois / 6 mois / depuis le début.
- **Historique** des plannings : consulter, modifier, dupliquer, archiver, supprimer + **versions**.
- **Détection d'impossibilité** : si les contraintes ne peuvent pas être respectées, le moteur
  n'invente rien et explique précisément le problème.
- **Impression** (feuille de style dédiée) et **export Excel** propre et professionnel.
- **Responsive** : parfaitement utilisable sur smartphone (vues par semaine, globale, par salarié).
- **Authentification** (session par cookie JWT) pour protéger les données.

## Architecture

```
Plannings-
├── Dockerfile              # image unique (build client + run serveur)
├── railway.json            # configuration de déploiement Railway
├── client/                 # frontend React + Vite (JSX)
│   └── src/
│       ├── pages/          # Dashboard, Generate, ScheduleView, History, Team,
│       │                   #   Absences, Statistics, Settings, Login
│       ├── components/      # ScheduleDisplay, ShiftEditor, Modal, Alerts
│       ├── lib/format.js    # formatage dates / heures (FR)
│       ├── api.js           # client HTTP
│       └── styles.css       # design system (responsive + impression)
└── server/                 # backend Node.js + Express + PostgreSQL
    └── src/
        ├── index.js         # serveur (API + service du SPA)
        ├── db.js            # pool PostgreSQL
        ├── migrate.js       # migrations (exécutées au démarrage)
        ├── seed.js          # données initiales (équipe, config, admin)
        ├── config.js        # configuration par défaut + chargement fusionné
        ├── time.js/dates.js # utilitaires heures & dates (UTC, bissextiles)
        ├── engine/          # MOTEUR : generator, scorer, equity, shifts
        ├── services/        # schedules (persistance), analysis, stats
        ├── routes/          # auth, employees, absences, schedules, settings, stats
        └── migrations/      # 001_init.sql
```

Le serveur Express expose l'API sous `/api/*` et sert le SPA React compilé (`server/public`).
Un seul service à déployer.

## Le moteur de génération (« cerveau »)

Fichiers : `server/src/engine/`.

1. **Contexte** (`services/schedules.js` → `buildContext`) : charge la configuration, l'équipe et
   ses contrats, les disponibilités, les absences, calcule les 3 semaines, et charge l'**historique
   pondéré** depuis `equity_statistics`.
2. **Analyse de faisabilité** (`generator.js` → `analyzeFeasibility`) : détecte en amont les
   impossibilités **dures** (aucun salarié disponible un jour d'ouverture, aucun responsable
   disponible le mardi) et **souples** (heures contractuelles non atteignables).
3. **Génération de candidats** : pour chaque candidat, sélection des jours travaillés par salarié
   (biaisée par l'équité + aléatoire pour la diversité), réparation de la couverture
   (ouverture/fermeture garanties chaque jour), garantie du responsable de commande le mardi
   matin, répartition des heures pour coller aux contrats, construction des créneaux (matin/
   après-midi avec pause non travaillée).
4. **Score** (`scorer.js`) : pénalise dépassements/manques d'heures, absence d'ouverture/fermeture,
   absence de responsable mardi, déséquilibres de rotation (pondérés par la capacité réelle de
   chacun — Noussia, en week-end uniquement, n'est pas désavantagée), journées trop longues,
   enchaînements pénibles, préférences non respectées. Le meilleur score est retenu.
5. **Mémoire** : à la validation, `equity_statistics` est (re)construit à partir des créneaux réels,
   alimentant l'équité long terme des générations futures.

L'**équité intelligente** compare les salariés selon leurs possibilités réelles (contrat,
disponibilités, contraintes), avec une **décroissance temporelle** configurable (l'historique
récent compte davantage).

## Schéma de la base de données

Tables : `users`, `employees`, `contracts`, `availability`, `absences`, `unavailabilities`,
`schedules`, `schedule_weeks`, `schedule_days`, `schedule_shifts`, `manual_changes`, `orders`,
`deliveries`, `equity_statistics`, `settings`.

Voir `server/src/migrations/` (`001_init.sql`, `002_unavailabilities.sql`). Les migrations sont **idempotentes** et exécutées
automatiquement au démarrage ; le seed initial n'insère les données que si les tables sont vides,
donc les données **survivent** aux redéploiements et redémarrages.

## Développement local

Prérequis : Node.js ≥ 20 et un PostgreSQL accessible.

```bash
# 1. Base de données locale (exemple)
createdb cedif

# 2. Variables d'environnement
cp .env.example .env
#   puis renseigner DATABASE_URL, JWT_SECRET, ADMIN_PASSWORD…
#   (pour un Postgres local, ajoutez PGSSL=disable)

# 3. Backend
cd server
npm install
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cedif PGSSL=disable npm start
#   -> migre, seed, écoute sur :8080 (ou $PORT)

# 4. Frontend (dev, hot reload) dans un autre terminal
cd client
npm install
npm run dev            # http://localhost:5173 (proxy /api -> :8080)
```

Compte par défaut : **admin / cedif2026** (modifiable dans `.env` puis dans l'app).

Test du moteur (sans base) :

```bash
cd server && node test/engine.test.mjs
```

## Déploiement sur Railway

1. Créez un projet Railway et **ajoutez un plugin PostgreSQL**.
2. Ajoutez un service à partir de ce dépôt GitHub. Railway détecte `railway.json` et construit via
   le `Dockerfile`.
3. Dans les **Variables** du service, définissez :
   - `DATABASE_URL = ${{Postgres.DATABASE_URL}}` (référence au plugin Postgres)
   - `JWT_SECRET = <chaîne aléatoire longue>`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD` (compte initial)
   - `NODE_ENV = production`
   - (`PORT` est fourni automatiquement par Railway)
4. Déployez. Au démarrage, l'application exécute les migrations et le seed initial.
   Le healthcheck `/api/health` confirme que tout est prêt.

Aucune modification du code n'est nécessaire après déploiement. Voir `DEPLOYMENT.md` pour le détail.

## Variables d'environnement

| Variable         | Rôle                                              | Par défaut        |
|------------------|---------------------------------------------------|-------------------|
| `DATABASE_URL`   | Chaîne de connexion PostgreSQL                    | —                 |
| `JWT_SECRET`     | Secret de signature des sessions                  | (à définir)       |
| `ADMIN_USERNAME` | Identifiant admin créé au premier démarrage       | `admin`           |
| `ADMIN_PASSWORD` | Mot de passe admin initial                        | `cedif2026`       |
| `PORT`           | Port d'écoute                                      | `8080`            |
| `NODE_ENV`       | `production` en prod (active le cookie sécurisé)  | —                 |
| `PGSSL`          | `disable` pour un Postgres local sans SSL         | (SSL activé)      |

## Sauvegarde / restauration

La base PostgreSQL est la seule source de vérité (rien n'est stocké uniquement dans le navigateur).

```bash
# Sauvegarde
pg_dump "$DATABASE_URL" > backup_cedif_$(date +%F).sql

# Restauration
psql "$DATABASE_URL" < backup_cedif_2026-09-01.sql
```

Sur Railway, le plugin PostgreSQL fournit également des sauvegardes gérées.

## Règles métier appliquées

- Horaires magasin : **lun–sam 09:50 → 19:40**, **dimanche 10:50 → 19:10** (configurables).
- Au moins **1 personne à l'ouverture** et **1 à la fermeture** chaque jour ; les **4 salariés ont
  les clés** et peuvent donc ouvrir/fermer.
- **Noussia** travaille **uniquement le samedi et le dimanche** (contrainte dure), 15 h réparties
  intelligemment entre les deux jours.
- **Commande le mardi avant 12:00**, obligatoirement par **Yassine ou Rose**.
- **Livraisons le jeudi et le vendredi** (affichées et prises en compte).
- Contrats respectés : Yassine 35 h, Rose 35 h, Jennyfer 25 h, Noussia 15 h.
- Rotation & équité des samedis, dimanches, ouvertures et fermetures sur le **long terme**.
- Si une contrainte est impossible, le moteur **n'invente pas** : il explique le blocage.

---

_Application développée pour CEDIF Saint-Antoine._
