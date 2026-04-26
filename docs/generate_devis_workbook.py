"""Génère docs/Devis_user_stories_et_estimation.xlsx (2 feuilles).
Exécuter depuis la racine du repo :
  pip install openpyxl
  python docs/generate_devis_workbook.py
"""
from __future__ import annotations

import csv
import io
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Font
from openpyxl.utils import get_column_letter

HERE = Path(__file__).resolve().parent
OUT = HERE / "Devis_user_stories_et_estimation.xlsx"

USER_STORIES_CSV = r"""ID,Epic,User_story_fr,Notes_perimetre,Heures
US-01,Authentification,"En tant qu'utilisateur, je veux m'inscrire et me connecter (email/mot de passe) pour accéder au tableau de bord.",Inscription connexion JWT,10
US-02,Authentification,"En tant qu'utilisateur, je veux me connecter avec Google.",OAuth Google URL + callback,14
US-03,Authentification,"En tant qu'utilisateur invité, je veux définir mon mot de passe via un lien sécurisé.",Flux setup-password jetons,10
US-04,Authentification,"En tant qu'utilisateur, je veux consulter et modifier mon profil.",PATCH /me + interface profil,6
US-05,Utilisateurs,"En tant qu'administrateur plateforme, je veux créer modifier et supprimer des utilisateurs.",API utilisateurs + interface admin,16
US-06,Utilisateurs,"En tant qu'administrateur plateforme, je veux renvoyer une invitation à un utilisateur.",resend-invite,4
US-07,Projets,"En tant que propriétaire, je veux créer modifier et supprimer des projets.",CRUD projets,12
US-08,Projets,"En tant que propriétaire, je veux dupliquer un projet pour répliquer la structure.",Endpoint duplicate,10
US-09,Membres,"En tant que propriétaire, je veux ajouter et retirer des membres de projet avec des rôles.",ProjectMember admin/membre,14
US-10,Contrôle d'accès,"En tant que système, je dois appliquer un accès par projet et un contrôle des rôles (RBAC).",check_project_access dépendances,18
US-11,Identifiants,"En tant que propriétaire, je veux stocker les clés API par projet de façon chiffrée.",ProjectCredential + crypto,16
US-12,Identifiants,"En tant qu'utilisateur, je veux des identifiants globaux avec repli sur le projet.",UserCredential + credentials_loader,12
US-13,Prompts IA,"En tant que propriétaire, je veux éditer les prompts pour la génération IA.",Paramètres prompts + valeurs par défaut,20
US-14,Sites,"En tant qu'éditeur, je veux gérer les sites (domaine URL WP IDs Sheets URL Pinterest).",CRUD sites,16
US-15,Sites,"En tant qu'éditeur, je veux envoyer des médias vers WordPress depuis un fichier ou une URL.",upload-media upload-from-url,18
US-16,Recettes,"En tant qu'éditeur, je veux un CRUD complet des recettes par site.",API recettes + interface,24
US-17,Recettes,"En tant qu'éditeur, je veux publier un article généré sur WordPress.",publish-article,14
US-18,Jobs,"En tant qu'éditeur, je veux lancer un job « articles » pour la génération IA en masse.",JobType articles thread worker,22
US-19,Jobs,"En tant qu'éditeur, je veux lancer un job « publisher » pour pousser vers WordPress.",JobType publisher,18
US-20,Jobs,"En tant qu'éditeur, je veux l'historique des jobs le détail et les journaux en temps réel.",REST jobs + WebSocket ws/logs,20
US-21,Jobs,"En tant qu'éditeur, je veux arrêter un job et remettre les recettes « generating » en pending.",stop + revert_generating,12
US-22,Génération IA,"En tant que système, je dois générer (OpenAI) recette complète JSON WPRM article HTML meta catégorie mot-clé.",article_generator openai_service,45
US-23,Génération IA,"En tant que système, je dois enrichir l'article avec des liens internes depuis le sitemap du site.",get_sitemap_links,10
US-24,Midjourney,"En tant que système, je dois générer des images via Discord/Midjourney avec sérialisation globale.",midjourney lock polling,40
US-25,Midjourney,"En tant que système, je dois mettre en cache les images Discord CDN vers des fichiers locaux /uploads.",_cache_image,8
US-26,Multi-sites,"En tant qu'éditeur, je veux une génération entrée partagée pour plusieurs sites.",articles_all_sites job_manager,35
US-27,Planification,"En tant que propriétaire, je veux planifier la publication automatique et la rétention des images.",ProjectPublishSchedule planificateur,28
US-28,Planification,"En tant que propriétaire, je veux déclencher immédiatement une exécution planifiée.",start-now,4
US-29,Publication lot,"En tant que propriétaire, je veux une publication par lot contrôlée.",publish-batch,14
US-30,WordPress,"En tant que système, je dois publier sur WordPress avec prise en charge multi-comptes.",publisher service wordpress,40
US-31,Google Sheets,"En tant que système, je dois écrire le permalien dans la feuille Google lorsque c'est configuré.",gspread flux wordpress,12
US-32,Pinterest,"En tant qu'éditeur, je veux connecter Pinterest (OAuth) et voir le statut.",routes pinterest + interface,22
US-33,Pinterest,"En tant qu'éditeur, je veux créer des épingles depuis les recettes y compris en masse.",create-pin bulk,18
US-34,Pinterest,"En tant qu'éditeur, je veux lister les tableaux Pinterest.",endpoints boards,8
US-35,Pin designer,"En tant qu'éditeur, je veux générer une image Pin à partir d'un modèle et de champs.",generate-pin pin_generator,25
US-36,Pin designer,"En tant qu'utilisateur, je veux créer modifier supprimer des modèles Pin (canvas Fabric JSON).",pin_designer_templates + interface designer,45
US-37,Pin designer,"En tant qu'éditeur, je veux générer des Pins en masse pour un site ou un job.",pages bulk pins,20
US-38,Export,"En tant que propriétaire, je veux exporter en Excel le projet le site ou les recettes.",routes excel_export,14
US-39,Import tableaux,"En tant qu'utilisateur, je veux importer une liste de tableaux depuis un modèle Excel.",paramètres import boards,8
US-40,Polices,"En tant qu'utilisateur, je veux gérer des polices personnalisées pour les visuels.",API polices + profil,10
US-41,Rétention images,"En tant que propriétaire, je veux le nettoyage selon la rétention et une exécution manuelle.",planificateurs + image-cleanup,14
US-42,Fiabilité,"En tant qu'exploitant, je veux réconcilier les jobs « bloqués » après redémarrage.",stale_job_reconciler,8
US-43,Tableau de bord,"En tant qu'utilisateur, je veux un tableau de bord avec statistiques projets sites recettes jobs.",API dashboard + page d'accueil,10
US-44,Interface,"En tant qu'utilisateur, je veux une navigation cohérente et une interface sombre type dashboard.",layout routage,25
US-45,Légal,"En tant qu'entreprise, je veux des pages Conditions et Confidentialité.",pages statiques,4
US-46,Threads,"En tant qu'utilisateur, je veux gérer des projets Threads et des comptes liés (OAuth).",threads_projects comptes,35
US-47,Threads,"En tant qu'utilisateur, je veux créer planifier publier des posts Threads y compris par lot.",API posts Threads + planificateur,50
US-48,Threads,"En tant que système, je dois uploader les médias Threads et nettoyer les médias expirés.",upload + planificateur nettoyage,18
US-49,Infrastructure,"En tant qu'exploitant, je veux Docker Compose et une configuration par variables d'environnement.",docker-compose env,12
US-50,Sécurité,"En tant que système, j'applique CORS en-têtes de sécurité et masque l'OpenAPI en production.",middleware FastAPI,6
US-51,QA et finitions,"En tant que client, je veux recette manuelle corrections bugs et UX sur les flux critiques.",tests polish tampon,45
"""

ESTIMATION_CSV = r"""Feuille_2_Estimation,,,,,
,,,,,
Synthèse par épopée (efforts),,,,,
Epopee,Description_synthese,Heures,,,
Authentification,Inscription connexion Google setup-password profil,40,,,
Utilisateurs,Administration comptes invitations,20,,,
Projets,CRUD duplication,22,,,
Membres et accès,Membres projet + RBAC,32,,,
Identifiants,Clés projet/utilisateur chiffrement,28,,,
Prompts IA,Édition prompts génération,20,,,
Sites,Configuration WP Sheets Pinterest uploads,34,,,
Recettes,CRUD publication article unitaire,38,,,
Jobs,Fichiers génération publisher logs WebSocket arrêt,72,,,
Génération IA OpenAI,Pipeline texte sitemap liens internes,55,,,
Midjourney Discord,Images lock global cache disque,48,,,
Multi-sites,Génération entrée partagée multi sites,35,,,
Planification et lots,Scheduler publication batch start-now,46,,,
WordPress et Sheets,Publication multi-compte permaliens feuilles,52,,,
Pinterest,OAuth épingles boards,48,,,
Pin designer,Modèles canvas génération bulk,90,,,
Export et import,Excel export import boards,22,,,
Polices et rétention,Polices personnalisées nettoyage images,24,,,
Fiabilité et sécurité,Jobs stale headers CORS,14,,,
Tableau de bord et interface,Stats navigation thème,35,,,
Légal,CGU confidentialité,4,,,
Threads,Projets comptes posts planificateur médias,103,,,
Infrastructure,Docker configuration déploiement,12,,,
QA et finitions,Recette corrections UX,45,,,
TOTAL_GENERAL,,939,,,
,,,,,
Scénarios de prix (MAD / DH marocains),,,,,
Scenario,Hypothese,Heures_retenues,Taux_DH_h,Montant_MAD,Notes
Bas,Scope réduit ou réutilisation forte (référence),650,300,195000,Développement seul ; voir section charges client
Réaliste,Développement équivalent au périmètre actuel du dépôt,939,380,356820,Freelance expérimenté solo
Freelance senior individuel (recommandé dépôt),Périmètre complet une seule personne senior,939,600,563400,Taux senior solo indicatif ; ajustable 550–700 DH/h
Freelance senior + marge projet,Heures 939 + 12% imprévus livraison,1052,600,631200,Buffer intégration recette client
Haut,Petite agence / équipe,939,500,469500,Coordination documentation
Forfait cle en main (référence),Heures majorées + 2 cycles recette,1080,400,432000,Comparable fourchette forfait ancienne ligne
,,,,,
À la charge du CLIENT (pas du développeur),,,,,
Poste_client,Exemples de coûts récurrents ou à l_usage,,,,
Hebergement,Serveur API + DB PostgreSQL (Railway Render VPS etc.) — abonnement mensuel,,,,
Hebergement front,Hébergement Next.js (Vercel Netlify etc.) si séparé,,,,
OpenAI,Clé API et facturation usage tokens (pay as you go ou crédits),,,,
Midjourney Discord,Abonnement Midjourney + compte Discord adapté si applicable,,,,
Google,Sheets API / compte de service / quotas si facturés,,,,
WordPress,Hébergement WP du client (déjà chez lui en général),,,,
Domaine_SSL,Nom de domaine certificat (souvent inclus hébergeur),,,,
Pinterest_Threads,Quotas API si un jour facturés ; comptes business côté client,,,,
,,,,,
Prestataire développeur (senior solo) — périmètre typique,,,,,
Inclus_dev,Livraison code configuration Docker doc déploiement mise en prod assistée,,,,
Inclus_dev,Intégration des flux : le client crée ses comptes clés API et les saisit dans lapp,,,,
Non_inclus_dev,Paiement des factures hébergeurs et OpenAI Midjourney au nom du client,,,,
,,,,,
Autres clauses,,,,,
À préciser,Nombre de tours de modifications après livraison,,,,
Option,Maintenance mensuelle forfaitaire ou au temps passé (développement seul),,,,
"""


def _csv_rows(text: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(text.strip()))
    return [row for row in reader]


def _write_sheet(ws, rows: list[list[str]], header_bold: bool = True) -> None:
    for r, row in enumerate(rows, start=1):
        for c, val in enumerate(row, start=1):
            cell = ws.cell(row=r, column=c, value=val)
            if header_bold and r == 1 and val:
                cell.font = Font(bold=True)
    # auto column width (cap)
    for c in range(1, max((len(x) for x in rows), default=0) + 1):
        maxlen = 0
        for row in rows:
            if c <= len(row) and row[c - 1]:
                maxlen = max(maxlen, min(len(str(row[c - 1])), 80))
        ws.column_dimensions[get_column_letter(c)].width = min(max(maxlen + 2, 10), 60)


def main() -> None:
    wb = Workbook()
    ws1 = wb.active
    ws1.title = "User stories"
    _write_sheet(ws1, _csv_rows(USER_STORIES_CSV))

    ws2 = wb.create_sheet("Estimation")
    _write_sheet(ws2, _csv_rows(ESTIMATION_CSV), header_bold=False)

    wb.save(OUT)
    print("Écrit:", OUT)


if __name__ == "__main__":
    main()
