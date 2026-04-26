# Comparatif: Script initial client vs Application actuelle

## Contexte
Le client a fourni avant démarrage deux scripts Python:
- `Articles_Writing_Winsome.py`
- `Articles_Publishing_Winsome.py`

## Ce que faisaient les scripts (point de départ)
### Script 1 - Writing
- Lecture d'une Google Sheet (`Sheet1!A:Z`)
- Génération IA (article, SEO title, meta description, pin title/description, keywords)
- Intégration Midjourney via API Discord (polling/upscale)
- Génération d'un JSON recette
- Ecriture des colonnes A..O dans Sheet1
- Copie vers feuilles `wordpress`, `pinterest`, `pinterest_bulk_cnv`

### Script 2 - Publishing
- Lecture des lignes prêtes à publier
- Upload d'images WordPress
- Création article WP + taxonomies + Yoast metadata
- Insertion shortcode WPRM
- Ecriture du permalink publié dans la feuille

## Limites techniques du script initial
- Architecture monolithique en scripts (pas d'API, pas de frontend)
- Pas de base de données applicative ni historique structuré
- Pas de multi-utilisateur réel (RBAC, permissions fines)
- Orchestration fragile (sleep/polling fixe, pas de queue robuste)
- Pas d'observabilité temps réel standardisée (dashboard/jobs/logs persistants)
- Faible maintenabilité (logique dense, peu modularisée)

## Valeur ajoutée de l'application actuelle
- Backend structuré (FastAPI + SQLAlchemy + Alembic + workers/schedulers)
- Frontend complet (Next.js + pages métier + UX responsive)
- Multi-tenant projet/site/membres avec contrôle d'accès
- Historique jobs, suivi, logs websocket, arrêt/reprise
- Pin Designer + Template Designer avancés (édition visuelle riche)
- Intégrations consolidées: WordPress, Pinterest, Threads, Google Sheets, OpenAI, Midjourney
- Modules admin/paramètres/audit/cleanup/sécurité

## Impact estimation
Le script client constitue un **MVP automatisé orienté batch**, alors que l'application livrée est une **plateforme SaaS complète**.

- Échelle relative d'effort: l'application actuelle est environ **3x à 6x** plus large qu'un simple refactoring des scripts initiaux.
- L'estimation globale (257 jours) reste cohérente avec ce saut de complexité (produit industrialisable vs script opérationnel).

## Alerte sécurité critique observée dans les scripts initiaux
Données sensibles détectées en clair dans les scripts:
- Clé OpenAI hardcodée
- Credentials WordPress hardcodés
- IDs/credentials Google Sheets et service account
- Token d'autorisation Discord/Midjourney (utilisé directement)

Recommandations immédiates:
1. Révoquer/rotater toutes les clés exposées.
2. Passer les secrets en variables d'environnement/secret manager.
3. Nettoyer l'historique Git contenant les secrets si ces scripts ont été versionnés.
