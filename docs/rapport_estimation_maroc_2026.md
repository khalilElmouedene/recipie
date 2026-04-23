# Rapport d'estimation projet full-stack (Marché Maroc)

## 1. Introduction
Ce document présente une estimation freelance professionnelle du projet analysé (frontend + backend + historique Git), avec chiffrage en MAD selon trois scénarios de taux (600 / 900 / 1200 MAD / jour).

Périmètre inclus : développement, tests, débogage, stabilisation.
Périmètre exclu : hébergement et coûts API tiers (OpenAI, Midjourney, etc.).
## 2. Présentation du projet
Le produit est une plateforme SaaS de génération et publication de contenu orientée recettes, avec un moteur de production multi-canal : WordPress, Pinterest, Threads, Google Sheets, designer visuel avancé et orchestration de jobs.

### Données de volumétrie observées
- Commits Git : 404
- Fenêtre de développement observée : du 2026-02-24 au 2026-04-22
- Durée calendaire observée : 58 jours (42 jours ouvrés)
- Backend : 14 fichiers de routes API, 111 endpoints, 32 migrations Alembic
- Frontend : 31 pages App Router
- Taille code (lignes non vides approx.) : backend 11,617 + frontend 20,720
## 3. Stack technique
### Backend
- FastAPI (Python), SQLAlchemy Async, PostgreSQL, Alembic
- Workers/schedulers pour jobs longs (génération, publication, nettoyage)
- WebSocket pour logs en temps réel
- Sécurité : JWT, chiffrement credentials, rate limiting, headers de sécurité

### Frontend
- Next.js (App Router), React, TypeScript, Tailwind
- Fabric.js pour Template Designer / Pin Designer
- API client centralisé, pages projet/sites/jobs/pinterest/threads

### Intégrations
- OpenAI, Midjourney (Discord workflow), WordPress XML-RPC
- Pinterest API, Threads API
- Google Sheets API
## 4. Analyse globale
### Architecture
Le projet suit une architecture **monolithe modulaire** :
- couche API (`routes`)
- couche métier (services)
- couche persistance (db_models, migrations)
- orchestration asynchrone (workers, schedulers)
- couche UI moderne (Next.js + composants métier riches)

### Fonctionnalités couvertes
- Authentification (email + Google OAuth + reset/setup password)
- Gestion utilisateurs, projets, membres, rôles, permissions
- Gestion sites, recettes, prompts, credentials chiffrés
- Génération IA (texte + images), jobs et logs live
- Publication WordPress (single, batch, scheduler)
- Pinterest (OAuth, boards, pin publication)
- Pin Designer / Template Designer avancés
- Threads (projets, comptes, posts, planification)
- Spy Sheet, audit logs, nettoyage automatique médias
- Dashboard, responsive UI, pages légales, sécurité de base
## 5. Estimation du temps
### Historique réel vs effort estimé
- Début réel (1er commit) : **2026-02-24**
- Dernier commit analysé : **2026-04-22**
- Cadence observée : 404 commits en 58 jours calendaires

### Interprétation
- Le dépôt montre une livraison rapide de nombreuses fonctionnalités en parallèle.
- Pour un chiffrage freelance "client-ready" (avec stabilisation + tests + marge risque), l'effort réaliste est supérieur au simple temps calendaire observé.

### Hypothèse d'estimation
- Base estimée (sans buffer) : **214.2 jours**
- Buffer risque intégré : **20%**
- Estimation finale : **257 jours**
## 6. Tableau des User Stories
| # | Titre | Description | Features | Complexité | Jours | Prix Bas (MAD) | Prix Moyen (MAD) | Prix Haut (MAD) |
|---|---|---|---|---|---:|---:|---:|---:|
| 1 | Authentification email + JWT | Inscription, connexion et session sécurisée avec JWT pour accéder à l'application | Register/Login, JWT, guards frontend/backend | Medium | 6 | 3600 | 5400 | 7200 |
| 2 | Google OAuth | Connexion via Google avec callback et création/liaison de compte | OAuth flow, callback page, account binding | Medium | 5 | 3000 | 4500 | 6000 |
| 3 | Setup password & reset password | Mise en place et réinitialisation de mot de passe via email sécurisé | setup-password tokens, forgot/reset pages, email workflow | Medium | 5 | 3000 | 4500 | 6000 |
| 4 | Administration utilisateurs | Gestion des utilisateurs et invitations côté admin | users CRUD, invite, resend invite, status | Medium | 6 | 3600 | 5400 | 7200 |
| 5 | Profil utilisateur & sécurité compte | Edition du profil, changement de mot de passe et états de sécurité | profile page, password update, warnings | Low | 3 | 1800 | 2700 | 3600 |
| 6 | CRUD projets + duplication | Création, édition, suppression et duplication des projets | projects CRUD, duplicate project | Medium | 5 | 3000 | 4500 | 6000 |
| 7 | Membres projet & RBAC | Gestion des rôles membres et contrôle d'accès par projet | project_members, access checks, role guards | High | 6 | 3600 | 5400 | 7200 |
| 8 | Gestion des sites | Configuration complète des sites de publication | site CRUD, wp users, pinterest url, image mode, embed pin | Medium | 6 | 3600 | 5400 | 7200 |
| 9 | Identifiants chiffrés | Stockage sécurisé des credentials globaux et projet | encrypted credentials, fallback loader | Medium | 5 | 3000 | 4500 | 6000 |
| 10 | Gestion des prompts IA | Paramétrage des prompts système/utilisateur avec reset | prompts CRUD, reset defaults, ownership scope | Medium | 4 | 2400 | 3600 | 4800 |
| 11 | CRUD recettes & métadonnées | Gestion complète des recettes et champs SEO/Pin | recipe CRUD, status, pin fields, SEO fields | Medium | 6 | 3600 | 5400 | 7200 |
| 12 | Job génération article (single-site) | Lancement et suivi des jobs de génération pour un site | job type articles, queueing, state update | Medium | 6 | 3600 | 5400 | 7200 |
| 13 | Job génération multi-sites | Génération partagée sur tous les sites d'un projet | articles_all_sites flow, shared recipes | High | 7 | 4200 | 6300 | 8400 |
| 14 | Historique jobs + logs temps réel | Suivi opérationnel des jobs avec logs live | jobs history UI, WebSocket /ws/logs, stop/revert | High | 6 | 3600 | 5400 | 7200 |
| 15 | Pipeline IA OpenAI | Génération structurée article/JSON avec règles métier | openai service, parsing, normalization, prompts | High | 9 | 5400 | 8100 | 10800 |
| 16 | Liens internes via sitemap | Enrichissement SEO par extraction de liens internes | sitemap parser, fallbacks, article context links | Low | 3 | 1800 | 2700 | 3600 |
| 17 | Pipeline Midjourney | Génération d'images via Discord/Midjourney avec polling | message polling, upscale handling, timers | High | 9 | 5400 | 8100 | 10800 |
| 18 | Cache/normalisation des images | Stabilisation des URLs et cache local des assets | image cache, upload normalization, media helpers | Medium | 4 | 2400 | 3600 | 4800 |
| 19 | Publication WordPress unitaire | Publication d'article/medias/SEO vers WordPress | publisher service, XML-RPC integration, SEO tags | High | 7 | 4200 | 6300 | 8400 |
| 20 | Publication batch & streaming | Publication en masse avec retours de progression | publish-batch API, streaming responses, backdated options | High | 6 | 3600 | 5400 | 7200 |
| 21 | Planification publication | Scheduler de publication avec déclenchement immédiat | project publish schedules CRUD, start now | High | 7 | 4200 | 6300 | 8400 |
| 22 | Synchronisation Google Sheets | Ecriture des permaliens dans Google Sheets | sheets credentials + write-back | Low | 3 | 1800 | 2700 | 3600 |
| 23 | Pinterest OAuth & boards | Connexion Pinterest et chargement des boards | oauth flow, board listing endpoints | Medium | 4 | 2400 | 3600 | 4800 |
| 24 | Publication Pinterest single/bulk | Création et envoi d'épingles depuis recettes | create pin, bulk pin, status mapping | Medium | 6 | 3600 | 5400 | 7200 |
| 25 | Pin Designer runtime | Edition/application de design sur recettes et pages | fabric runtime, multi-page recipes, editing tools | High | 11 | 6600 | 9900 | 13200 |
| 26 | Template Designer avancé | Conception de templates avec règles d'édition avancées | constraints, shortcuts, layers, lock/align/transform | High | 11 | 6600 | 9900 | 13200 |
| 27 | Gestion templates (CRUD/clone/assign) | Cycle de vie des templates et affectation par projet | template API, clone, assignment, ownership scope | Medium | 6 | 3600 | 5400 | 7200 |
| 28 | Import/Export templates JSON | Partage et réimport de templates éditables | template export JSON, import validation | Medium | 4 | 2400 | 3600 | 4800 |
| 29 | Polices personnalisées | Gestion centralisée des fonts utilisateur | fonts settings API, loader/injection in designers | Medium | 4 | 2400 | 3600 | 4800 |
| 30 | Bibliothèque Elements réutilisables | Composants graphiques réutilisables dans le designer | custom pin elements storage/reuse | Medium | 6 | 3600 | 5400 | 7200 |
| 31 | Génération image Pin + upload | Rendu final des pins et upload vers médias | pin_generator, uploads, stable media URLs | Medium | 6 | 3600 | 5400 | 7200 |
| 32 | Pinterest Gallery + Worksheet | Vue galerie et mapping colonnes/tableau de travail | gallery filters, worksheet mapping, website grouping | High | 8 | 4800 | 7200 | 9600 |
| 33 | Spy Sheet | Tableur interne pour manipulation de données | grid editing, ranges, column resize, clipboard | High | 7 | 4200 | 6300 | 8400 |
| 34 | Threads: projets & comptes | Gestion des projets/comptes Threads avec OAuth | threads projects, accounts, callback | High | 7 | 4200 | 6300 | 8400 |
| 35 | Threads: posts & planification | Création, planification et publication de posts Threads | posts CRUD, scheduler, status updates | High | 8 | 4800 | 7200 | 9600 |
| 36 | Audit logs | Traçabilité des actions sensibles | audit middleware, API, listing UI | Medium | 4 | 2400 | 3600 | 4800 |
| 37 | Nettoyage automatique médias | Rétention images/médias et état système | cleanup config, retention scheduler, system state | Medium | 5 | 3000 | 4500 | 6000 |
| 38 | Dashboard & analytics | KPI globaux et navigation historique | dashboard API + cards/charts/history | Medium | 4 | 2400 | 3600 | 4800 |
| 39 | UI shell responsive | Layout, sidebar, header, responsive mobile | app shell, sidebar behavior, responsive fixes | Medium | 6 | 3600 | 5400 | 7200 |
| 40 | Sécurité applicative | Durcissement API et politiques de sécurité | rate limiting, security headers, CORS, SSRF safeguards | High | 6 | 3600 | 5400 | 7200 |
| 41 | DevOps & migrations | Dockerisation, migrations Alembic et configuration env | docker compose, alembic chain, env management | Medium | 5 | 3000 | 4500 | 6000 |
| 42 | QA, recette et stabilisation | Tests manuels, correctifs régression et préparation livraison | end-to-end validation, bugfix, handover | High | 15 | 9000 | 13500 | 18000 |
| **TOTAL** |  |  |  |  | **257** | **154200** | **231300** | **308400** |

## 7. Comparaison avec le marché marocain
### Références marché (avril 2026)
- Codeur (marché freelance francophone) : TJM développeur web relevé à **135 EUR/jour** (~1460 MAD/jour selon EUR/MAD autour de 10.8). Source : Codeur + historique EUR/MAD.
- WebSuccess Maroc :
  - Application web (SaaS) : **30 000 – 150 000+ MAD**
  - Freelance junior : **100–250 MAD/h**
  - Freelance expérimenté : **250–500 MAD/h**
- Amine.ma :
  - TJM freelance web Maroc : **800 – 2 500 MAD/jour**
  - Application web sur mesure : **30 000 – 150 000+ MAD**
- Upwork (benchmark international full-stack) : **16–35 USD/h**

### Positionnement de ce projet
- Type : **SaaS métier + IA + multi-intégrations + designer visuel**
- Niveau : **Complexe**
- Notre estimation moyenne : **231300 MAD**

### Verdict pricing
- Face aux fourchettes "site/app standard" (50k–150k+), ce projet est au-dessus du milieu de marché car il cumule :
  - workflow IA complet (texte + image),
  - orchestration jobs/schedulers,
  - multi-plateformes (WP, Pinterest, Threads, Sheets),
  - éditeur visuel avancé (Fabric.js).
- **Conclusion marché : Fairly priced ✅ (haut de fourchette complexe)** plutôt que sous-évalué.
## 8. Coût total (MAD)
- **Total jours estimés : 257 jours**
- **Scénario bas (600 MAD/jour) : 154200 MAD**
- **Scénario moyen (900 MAD/jour) : 231300 MAD**
- **Scénario haut (1200 MAD/jour) : 308400 MAD**

Lecture rapide :
- < 50k MAD : petit projet
- 50k–150k+ MAD : projet moyen/complexe classique
- > 150k MAD : produit métier complexe avec intégrations et logique avancée

Ce projet se positionne dans la dernière catégorie.
## 9. Conclusion
Le codebase analysé correspond à une plateforme riche et ambitieuse, avec un périmètre fonctionnel large.

### Notes qualité code
Points forts :
- Architecture modulaire cohérente
- Couverture fonctionnelle très large
- Bonne dynamique d'itération produit

Risques observés :
- Couverture de tests automatisés encore limitée
- Certaines parties frontend très volumineuses (complexité de maintenance)
- Historique de correctifs rapides (ex: migrations Alembic) indiquant un besoin de garde-fous CI supplémentaires

### Recommandations d'amélioration
1. Ajouter tests automatisés (API + e2e UI) sur les flux critiques.
2. Mettre une validation CI des migrations Alembic (upgrade/downgrade sur DB vierge).
3. Découper les gros composants frontend en modules testables.
4. Renforcer observabilité production (dashboards erreurs, alerting, tracing).

---
### Sources marché
- https://www.codeur.com/developpeur/web/tarif
- https://websuccess.ma/blog/cout-creation-site-web-maroc
- https://amine.ma/fr/articles/tarifs-developpeur-web-freelance-maroc-2026-guide-prix
- https://www.upwork.com/hire/full-stack-developers/cost/
- https://www.exchange-rates.org/exchange-rate-history/eur-mad-2026




## Annexe: Point de départ client (scripts initiaux)
Un comparatif détaillé entre les scripts initiaux fournis par le client et l'application finale est disponible ici:
- `docs/comparatif_script_client_vs_application.md`
