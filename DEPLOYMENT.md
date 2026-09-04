# Guide de déploiement — CEDIF Saint-Antoine

Ce document détaille le déploiement sur **Railway** ainsi que les opérations courantes
(migrations, sauvegarde, restauration, dépannage).

## 1. Prérequis

- Un compte [Railway](https://railway.app).
- Ce dépôt poussé sur GitHub.

## 2. Créer le projet et la base PostgreSQL

1. Sur Railway : **New Project → Deploy from GitHub repo** et sélectionnez ce dépôt.
2. Dans le projet : **New → Database → Add PostgreSQL**.

Railway crée alors une base PostgreSQL persistante et expose ses variables
(`PGHOST`, `PGUSER`, `DATABASE_URL`, etc.).

## 3. Configurer le service applicatif

Railway détecte automatiquement `railway.json` et construit l'image via le `Dockerfile`.

Dans l'onglet **Variables** du service applicatif, ajoutez :

| Variable         | Valeur                                   |
|------------------|------------------------------------------|
| `DATABASE_URL`   | `${{Postgres.DATABASE_URL}}`             |
| `JWT_SECRET`     | une longue chaîne aléatoire              |
| `ADMIN_USERNAME` | ex. `direction`                          |
| `ADMIN_PASSWORD` | un mot de passe fort                     |
| `NODE_ENV`       | `production`                             |

> `PORT` est injecté automatiquement par Railway — ne pas le définir manuellement.
> Le référencement `${{Postgres.DATABASE_URL}}` relie le service au plugin PostgreSQL.

## 4. Déployer

Lancez le déploiement. Séquence au démarrage du conteneur :

1. `migrate()` applique le schéma (`001_init.sql`) — **idempotent**.
2. `seed()` crée le compte admin, la configuration par défaut et l'équipe (Yassine, Rose,
   Jennyfer, Noussia) **uniquement si les tables sont vides**.
3. Le serveur écoute sur `$PORT` et sert l'API + l'interface.

Le **healthcheck** `/api/health` vérifie la connexion à la base.

Ouvrez l'URL publique générée par Railway et connectez-vous avec le compte admin.

## 5. Persistance des données

- Toutes les données vivent dans PostgreSQL (plugin Railway) : elles **survivent** aux
  redéploiements, mises à jour et redémarrages.
- Le seed ne réinsère jamais par-dessus des données existantes.
- Rien n'est stocké uniquement dans le navigateur (`localStorage`).

## 6. Migrations ultérieures

Pour faire évoluer le schéma, ajoutez un fichier `server/src/migrations/002_xxx.sql`
(numéroté, idempotent avec `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE ... IF NOT EXISTS`).
Il sera appliqué automatiquement au prochain démarrage.

Exécution manuelle possible :

```bash
railway run npm --prefix server run migrate
```

## 7. Sauvegarde / restauration

```bash
# Récupérer l'URL de connexion
railway variables    # ou onglet Postgres → Connect

# Sauvegarde
pg_dump "$DATABASE_URL" > backup_$(date +%F).sql

# Restauration
psql "$DATABASE_URL" < backup_2026-09-01.sql
```

Le plugin PostgreSQL de Railway propose aussi des sauvegardes automatiques.

## 8. Dépannage

- **`/api/health` renvoie 500** : vérifiez `DATABASE_URL` et que le plugin Postgres est bien
  référencé. Les logs du service indiquent l'erreur de connexion.
- **Écran de connexion en boucle** : vérifiez `JWT_SECRET` et que `NODE_ENV=production` (cookie
  sécurisé) est bien servi en HTTPS (c'est le cas sur Railway).
- **SSL local** : pour un PostgreSQL local sans SSL, ajoutez `PGSSL=disable`.
- **Réinitialiser l'admin** : supprimez la ligne dans la table `users` puis redémarrez (le seed
  recrée le compte à partir des variables d'environnement).

## 9. Déploiement hors Railway (Docker générique)

```bash
docker build -t cedif-planning .
docker run -p 8080:8080 \
  -e DATABASE_URL="postgresql://user:pass@host:5432/cedif" \
  -e JWT_SECRET="..." \
  -e ADMIN_PASSWORD="..." \
  -e NODE_ENV=production \
  cedif-planning
```
