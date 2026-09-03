# Politique de confidentialité — Médor

*Dernière mise à jour : 3 septembre 2026*

Médor est une application de bureau qui aide à ranger votre boîte mail (création de
libellés, archivage des messages déjà lus, repérage des newsletters et des indésirables).

## Le principe : tout reste sur votre machine

Médor **ne possède aucun serveur**. L'application s'exécute entièrement sur votre
ordinateur et parle **directement** aux services que vous connectez :

- votre fournisseur de messagerie (Google, Microsoft, Apple ou tout serveur IMAP), via une
  connexion chiffrée TLS ;
- optionnellement, l'API Claude d'Anthropic si vous activez le classement par IA.

Aucune donnée n'est envoyée au développeur de Médor ni à un quelconque intermédiaire.

## Données traitées

- **Identifiants et jetons d'accès** (OAuth, mots de passe d'application) : stockés
  localement dans le trousseau sécurisé de votre système (Keychain sur macOS). Ils ne
  quittent jamais votre machine, sauf vers le fournisseur de messagerie concerné pour
  s'authentifier.
- **En-têtes de vos e-mails** (expéditeur, objet, date, statut lu/non-lu, en-têtes de
  désabonnement) : lus pour analyser la boîte. Le **corps des messages n'est jamais lu**.

## Utilisation de l'accès Gmail / Outlook / IMAP

L'accès à votre messagerie sert exclusivement à :

1. lire les en-têtes des messages de la boîte de réception pour proposer un plan de
   rangement ;
2. créer des libellés/dossiers et y déplacer des messages, **uniquement après votre
   validation explicite** dans l'application ;
3. déplacer vers le dossier indésirables les expéditeurs que vous cochez ;
4. effectuer les demandes de désabonnement que vous déclenchez.

Aucun message n'est supprimé. Aucun e-mail n'est envoyé en votre nom.

## Classement par IA (optionnel)

Si — et seulement si — vous activez l'IA (votre clé API Anthropic, ou votre abonnement
Claude Code déjà installé), Médor envoie à Claude, pour classement : nom d'expéditeur,
adresse, domaine, quelques objets de messages et des statistiques de volume. Jamais le
corps des messages, jamais vos identifiants. Sans IA, un classement local s'applique et
rien ne sort de votre machine.

## Partage et conservation

- Aucune donnée n'est collectée, vendue, partagée ni transférée à des tiers.
- Aucune statistique d'usage, aucun traqueur, aucune télémétrie.
- Supprimer un compte dans l'application efface immédiatement ses identifiants du trousseau
  et sa configuration locale. Désinstaller l'application supprime toutes les données
  restantes.

## L'utilisation des données reçues des API Google

L'utilisation par Médor des informations reçues des API Google respecte la
[Politique relative aux données utilisateur des services d'API Google](https://developers.google.com/terms/api-services-user-data-policy),
y compris ses exigences d'utilisation limitée (« Limited Use »).

## Contact

Pour toute question : t.aubert.dev@outlook.com
