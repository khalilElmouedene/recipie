# RAPPORT D'ESTIMATION PROFESSIONNELLE
## Recipe Automation Platform — SaaS Full-Stack
**Date** : 22 avril 2026 | **Préparé par** : Développeur Freelance | **Marché** : Maroc

---

## 1. INTRODUCTION

Ce document présente une estimation professionnelle et détaillée du projet **Recipe Automation Platform**, une plateforme SaaS complète développée de zéro à partir d'un ensemble de scripts Python fournis par le client comme cahier des charges fonctionnel.

Le client exploite un blog culinaire WordPress (`winsomerecipes.com`) et utilisait initialement deux scripts Python manuels :
- `Articles_Writing_Winsome.py` — génération d'articles via OpenAI + images Midjourney
- `Articles_Publishing_Winsome.py` — publication WordPress via XMLRPC

L'objectif du projet était de **transformer ces scripts en une plateforme SaaS multi-tenant**, sécurisée, évolutive, avec interface web complète.

> **Note importante** : Le développeur ne travaille pas en continu (temps partiel / sessions espacées). Les jours estimés représentent des **jours-homme de travail effectif** (1 jour = 8 heures de travail réel), et non des jours calendaires.

---

## 2. PRÉSENTATION DU PROJET

| Paramètre | Valeur |
|-----------|--------|
| **Nom** | Recipe Automation Platform |
| **Type** | SaaS Full-Stack Web Application |
| **Version** | 2.0.0 |
| **Client** | Winsomerecipes.com (food blog) |
| **Point de départ** | 2 scripts Python clients |
| **Livrable final** | Plateforme SaaS complète + BDD + API + UI |

### Ce que le client avait (scripts Python) → Ce qui a été livré (SaaS)

| Scripts clients | Plateforme livrée |
|-----------------|------------------|
| Scripts locaux, exécution manuelle | Application web accessible depuis navigateur |
| Pas d'authentification | Auth complète JWT + Google OAuth |
| Données en Google Sheets | Base de données PostgreSQL structurée |
| Un seul blog géré | Multi-projets, multi-sites WordPress |
| Aucune gestion d'équipe | Rôles owner/admin/member par projet |
| Pas d'interface | Dashboard, designer visuel, galerie |
| Aucune sécurité | Chiffrement, audit log, rate limiting, CSP |
| Exécution bloquante | Jobs asynchrones avec logs temps réel |

---

## 3. STACK TECHNIQUE

### Backend
| Composant | Technologie |
|-----------|-------------|
| Framework API | FastAPI (Python 3.12+) |
| Base de données | PostgreSQL |
| ORM | SQLAlchemy (async) |
| Migrations | Alembic (33 fichiers de migration) |
| Auth | JWT (python-jose) + Google OAuth 2.0 |
| Chiffrement | Fernet (cryptography) |
| Rate limiting | SlowAPI |
| Email | Service email intégré |
| WebSocket | Logs temps réel (starlette/websockets) |
| Conteneurisation | Docker + Docker Compose |
| Déploiement | Railway (railway.toml) |
| CI/CD | GitHub Actions |

### Services / Intégrations externes
| Service | Usage |
|---------|-------|
| OpenAI GPT-4 | Génération articles, SEO, Pinterest, JSON recette |
| Midjourney (Discord API) | Génération d'images culinaires |
| WordPress XMLRPC | Publication articles, images, recettes |
| Rank Math SEO | Métadonnées SEO via API WordPress |
| WPRM (Recipe Plugin) | Cartes de recettes structurées |
| Pinterest API v5 | OAuth, boards, création de pins |
| Meta Threads API | OAuth, publication, scheduling |
| Google Sheets API | Lecture/écriture données recettes |
| Cloudinary | CDN et gestion d'images |

### Frontend
| Composant | Technologie |
|-----------|-------------|
| Framework | Next.js 15 (App Router) |
| UI Library | React 19 |
| Langage | TypeScript 5.7 |
| Styling | Tailwind CSS 3.4 + @tailwindcss/forms |
| Canvas Editor | Fabric.js v6 |
| State Management | Zustand 5 |
| Icons | Lucide React |
| Export | XLSX (Excel) |
| Sécurité XSS | DOMPurify |

---

## 4. ANALYSE GLOBALE

### Architecture
- **Pattern** : Modular Monolith avec séparation claire routes/services/models
- **Multi-tenancy** : Isolation complète par owner → projets → sites → recettes
- **Async-first** : Toutes les opérations lourdes en tâches de fond
- **Sécurité** : Défense en profondeur (encryption + auth + rate limit + headers + audit)

### Complexité technique identifiée
| Dimension | Niveau |
|-----------|--------|
| Nombre de tables BDD | 20 tables + 33 migrations |
| Nombre d'API routes | 14 routers, ~80+ endpoints |
| Nombre de pages frontend | 30 pages |
| Intégrations tierces | 9 services externes |
| Schedulers background | 5 tâches asynchrones |
| Lignes de code (estimation) | ~15,000–20,000 lignes |

### Comparatif script client vs application livrée
Le fichier `docs/comparatif_script_client_vs_application.md` documente point par point les 47 améliorations apportées au-delà du périmètre des scripts originaux.

---

## 5. ESTIMATION DU TEMPS PAR USER STORY

### Méthodologie
- **1 jour = 8 heures** de travail effectif
- Chaque estimation inclut : développement + tests + débogage
- Buffer de **20%** appliqué sur le total
- Complexité : **Low** | **Medium** | **High** | **Very High**

---

## 6. TABLEAU DES USER STORIES

| # | Titre | Description | Complexité | Jours | Low (MAD) | Avg (MAD) | High (MAD) |
|---|-------|-------------|-----------|-------|-----------|-----------|------------|
| US-01 | Authentification & gestion utilisateurs | JWT login/register, Google OAuth 2.0, reset mot de passe, flow d'invitation, profil utilisateur, rôles owner/admin/member | High | 5 | 3 000 | 4 500 | 6 000 |
| US-02 | Gestion multi-projets | CRUD projets, renommage, membres, rôles par projet, isolation données | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-03 | Gestion des sites WordPress | CRUD sites, multi-comptes WP, modes image, URL Pinterest, embed pin dans article | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-04 | Intégration Google Sheets | Connexion service account/OAuth, lecture recettes, écriture résultats + permalink, vue Spy Sheet | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-05 | Moteur de génération d'articles IA | OpenAI : réécriture recette, article HTML, SEO (titre/meta/slug/keyprase), Pin (titre/desc/mots-clés/board), JSON WPRM, liens internes sitemap, prompts configurables | High | 6 | 3 600 | 5 400 | 7 200 |
| US-06 | Génération d'images Midjourney | Discord API wrapper, /imagine, polling résultats, clic U1-U4, download & cache local, verrou par canal, wait configurable, stop interruptible | High | 5 | 3 000 | 4 500 | 6 000 |
| US-07 | Système de jobs asynchrones + WebSocket | Création/tracking jobs, worker background, types (articles/publisher/all-sites), stop/cancel, WebSocket logs temps réel, reconciliation stale jobs | High | 5 | 3 000 | 4 500 | 6 000 |
| US-08 | Publication WordPress | XMLRPC publishing, upload image WebP, featured image + injection inline, catégories/tags, recette WPRM, Rank Math SEO, rotation multi-comptes, date publication aléatoire | High | 5 | 3 000 | 4 500 | 6 000 |
| US-09 | Intégration Pinterest (OAuth + API) | OAuth 2.0 Pinterest, listing boards, création pins, tracking URL pin, callback page | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-10 | Scheduleur de publication automatique | Tâche background, intervalle configurable (minutes), enable/disable par projet, next/last run, gestion erreurs | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-11 | Pin Designer — éditeur canvas Fabric.js | Éditeur visuel 1000×1500px, texte (police/couleur/taille/graisse), zones image cover+clip, bandes décoratives, cadres (solid/dashed/dotted), panel layers, toolbar flottant, zoom CSS, undo/redo, export PNG | Very High | 8 | 4 800 | 7 200 | 9 600 |
| US-12 | Templates de Pin Designer | CRUD templates, galerie, assignation projets, éléments personnalisés, canvas_width/height configurables | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-13 | Génération multi-sites (all-sites) | Job cross-sites, progression par site, type all_sites, vue résultats par job | Medium | 2 | 1 200 | 1 800 | 2 400 |
| US-14 | Intégration Meta Threads | OAuth 2.0 Threads, config app (app_id/secret), comptes liés, création posts (texte+image), scheduling, scheduler background, cleanup médias | High | 5 | 3 000 | 4 500 | 6 000 |
| US-15 | Rétention et nettoyage des images | Scheduler cleanup images /uploads, retention_days configurable, cleanup system-wide + par owner, état singleton | Low | 2 | 1 200 | 1 800 | 2 400 |
| US-16 | Architecture BDD & Modularisation | Conception 20 tables, UUID PKs, relations, contraintes, 33 migrations Alembic, isolation multi-tenant, schema prompts configurables | High | 5 | 3 000 | 4 500 | 6 000 |
| US-17 | Sécurité & durcissement | Fernet encryption credentials, bcrypt passwords, rate limiting, security headers (CSP/HSTS/X-Frame), audit middleware, CORS, pipeline GitHub Actions | High | 4 | 2 400 | 3 600 | 4 800 |
| US-18 | Paramètres utilisateur & credentials | Gestion clés API (OpenAI, MJ, Google), prompts IA par projet, polices custom, éléments pin custom, timer Midjourney | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-19 | Audit logs & Dashboard stats | Capture audit (CREATE/UPDATE/DELETE toutes tables), masquage champs sensibles, viewer frontend, stats dashboard | Medium | 2 | 1 200 | 1 800 | 2 400 |
| US-20 | Infrastructure & DevOps | Dockerfile frontend+backend, docker-compose, Railway config, variables env, CI/CD GitHub Actions security | Medium | 2 | 1 200 | 1 800 | 2 400 |
| US-21 | Frontend Shell & UX | AppShell, Sidebar navigation, dark/light theme, toast notifications, guards routes protégées, design responsive | Medium | 3 | 1 800 | 2 700 | 3 600 |
| US-22 | Export Excel & Spy Sheet | Export recettes en Excel (openpyxl), vue Google Sheets par projet (spy sheet) | Low | 2 | 1 200 | 1 800 | 2 400 |
| — | **SOUS-TOTAL** | | | **83** | **49 800** | **74 700** | **99 600** |
| — | **Buffer 20%** | Imprévus, itérations client, debugging avancé | | **17** | **10 200** | **15 300** | **20 400** |
| — | **🔢 TOTAL FINAL** | | | **100** | **60 000** | **90 000** | **120 000** |

---

## 7. COMPARAISON AVEC LE MARCHÉ MAROCAIN

### Positionnement du projet

Ce projet est une **plateforme SaaS complexe de niveau professionnel**. Elle dépasse largement les catégories standard de projets freelance.

| Catégorie marché Maroc | Fourchette prix | Ce projet |
|------------------------|-----------------|-----------|
| Application simple (CRUD, landing) | 3 000 – 15 000 MAD | ❌ Bien en dessous |
| Application moyenne (backend + front + auth) | 20 000 – 50 000 MAD | ❌ Pas assez |
| Système complexe (SaaS, multi-tenant, IA) | 50 000 – 150 000+ MAD | ✅ **Correspond** |

### Détail du positionnement

```
Prix estimé (Average) : 90 000 MAD
─────────────────────────────────────────────────────────
Marché Maroc - Systèmes complexes : 50 000 – 150 000 MAD
                                         ↑
                                   [90 000 MAD]
                                   Fourchette basse-milieu
                                   du segment "complexe"
```

### Taux journaliers de référence (Maroc, 2024–2026)

| Profil | Taux jour (MAD) | Taux heure (MAD) |
|--------|----------------|-----------------|
| Junior / Low | 600 | 75 |
| Confirmé / Average | 900 | 113 |
| Senior / High | 1 200 | 150 |
| Expert IA/SaaS (marché réel) | 1 500 – 2 500 | 190 – 315 |

> **Note** : Pour un profil ayant livré une intégration Midjourney + OpenAI + Pinterest + Threads + Fabric.js Canvas + architecture SaaS sécurisée, le taux **900–1200 MAD/jour est conservateur**. Sur le marché international (Upwork/Malt), ce type de projet vaut 2x–3x ces montants.

### Verdict de positionnement

| Critère | Évaluation |
|---------|-----------|
| Prix Low (60 000 MAD) | ⚠️ **Sous-évalué** — en dessous des standards marché pour ce niveau |
| Prix Average (90 000 MAD) | ✅ **Juste prix** — correct pour le marché marocain freelance confirmé |
| Prix High (120 000 MAD) | ✅ **Prix senior** — justifié par la complexité et les intégrations IA |

### Justification de la complexité

Ce projet se distingue par :

1. **Intégrations IA avancées** — OpenAI (prompts multi-étapes) + Midjourney (Discord API non officielle, gestion asynchrone, polling, upscaling)
2. **9 services tiers intégrés** — chacun avec son propre OAuth, rate-limit, gestion d'erreurs
3. **Éditeur canvas custom** — Fabric.js v6, undo/redo, layers, templates, export PNG (rare compétence)
4. **SaaS multi-tenant robuste** — isolation, rôles, chiffrement, audit
5. **20 tables BDD + 33 migrations** — schéma évolué au fil de 33 itérations
6. **5 background schedulers** — tasks asynchrones, stale job reconciliation
7. **WebSocket real-time** — logs streaming en direct
8. **Sécurité production-grade** — rare dans les projets freelance standard

---

## 8. COÛT TOTAL (MAD)

### Récapitulatif financier

| Scénario | Jours | Coût MAD | Positionnement |
|----------|-------|----------|---------------|
| **Low** (600 MAD/j) | 100 | **60 000 MAD** | ⚠️ Sous-évalué |
| **Average** (900 MAD/j) | 100 | **90 000 MAD** | ✅ Prix juste marché |
| **High** (1 200 MAD/j) | 100 | **120 000 MAD** | ✅ Senior justifié |

### Décomposition des grandes catégories

| Catégorie | Jours | % du total |
|-----------|-------|------------|
| Core IA & génération (US-05, US-06) | 11 | 11% |
| Publication & intégrations (US-08, US-09, US-14) | 13 | 13% |
| Frontend & UX (US-11, US-12, US-21) | 14 | 14% |
| Backend API & jobs (US-07, US-10, US-13) | 10 | 10% |
| Auth, users, projets (US-01, US-02, US-03) | 11 | 11% |
| Data & BDD (US-04, US-16, US-22) | 10 | 10% |
| Sécurité & infra (US-17, US-19, US-20) | 8 | 8% |
| Settings & credentials (US-15, US-18) | 5 | 5% |
| **Buffer 20%** | 17 | 17% |
| **Total** | **100** | **100%** |

---

## 9. QUALITÉ DU CODE & RECOMMANDATIONS

### Points forts observés
- Architecture modulaire claire (routes / services / models)
- Chiffrement Fernet pour toutes les credentials sensibles
- Async SQLAlchemy + Alembic pour migrations versionnées
- Séparation des responsabilités respectée
- Gestion propre des locks Midjourney par canal Discord
- Audit logging automatique via SQLAlchemy events
- Middleware security headers production-grade

### Notes qualité
- Code TypeScript strict côté frontend
- Zustand bien utilisé (ref Fabric hors store pour éviter re-renders)
- DOMPurify pour la protection XSS
- 33 migrations = preuve d'un développement itératif sérieux

### Recommandations futures
1. **Tests unitaires** — à ajouter (non présents actuellement)
2. **Rate limiting par user** — aujourd'hui par IP uniquement
3. **Queue Redis** — pour remplacer les background tasks asyncio en production haute charge
4. **Monitoring** — Sentry ou équivalent pour la production

---

## 10. CONCLUSION

Le projet **Recipe Automation Platform** est une **application SaaS de complexité élevée**, construite from scratch à partir de deux scripts Python clients. Il intègre une stack moderne complète (FastAPI, Next.js 15, PostgreSQL, 9 APIs externes, éditeur canvas Fabric.js) avec une sécurité et une architecture de niveau professionnel.

L'estimation de **100 jours-homme** (83 jours + 20% buffer) aboutit à une fourchette de prix de :

| | Montant |
|--|---------|
| **Minimum** | **60 000 MAD** |
| **Recommandé** | **90 000 MAD** |
| **Senior** | **120 000 MAD** |

Le prix recommandé de **90 000 MAD** est **justifié et correctement positionné** dans le marché marocain des systèmes complexes (50 000 – 150 000+ MAD), et reste **conservateur** par rapport aux standards internationaux pour ce niveau de complexité.

---

*Document généré le 22 avril 2026 — Analyse complète du code source et de l'historique git du projet.*
