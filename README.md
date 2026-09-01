# Rangemail

Application de bureau (Tauri + React) qui range votre boîte mail automatiquement :

- **Connexion multi-comptes** : Gmail (OAuth Google ou mot de passe d'application), Outlook/Hotmail (OAuth Microsoft par code d'appareil), iCloud (mot de passe d'application), et toute boîte IMAP.
- **Onboarding** : quelques questions (usage, catégories, style de rangement, ancienneté) pour personnaliser le classement.
- **Plan de rangement** : analyse des en-têtes de la boîte de réception (jamais le contenu complet), création de libellés détaillés, et **archivage des mails déjà lus** dans ces libellés — les non-lus restent dans la boîte de réception.
- **Newsletters** : liste complète avec taux de lecture, désabonnement **en un clic** (RFC 8058) quand l'expéditeur le permet, sinon ouverture du lien de désabonnement.
- **Indésirables** : repérage des expéditeurs jamais lus à gros volume, déplacement vers le dossier spam sur validation.
- **Classement par IA** (optionnel) : avec une clé API Anthropic, Claude conçoit des libellés sur mesure à partir de vos réponses. Sans clé, un classement heuristique s'applique.

Rien n'est supprimé : les mails sont déplacés dans des dossiers/libellés IMAP, toujours retrouvables.

## Prérequis

- Node.js ≥ 20 et npm
- Rust (via [rustup](https://rustup.rs)) — requis par Tauri
- macOS : rien d'autre. Linux : dépendances webkit2gtk de Tauri.

## Démarrer

```bash
npm install
npm run dev        # lance l'app en mode développement
```

Autres commandes :

```bash
npm run typecheck  # vérification TypeScript
npm run build      # build de production + bundle (.app / .dmg)
```

## Connexion des comptes

| Fournisseur | Méthode | Côté utilisateur |
|---|---|---|
| Gmail | OAuth Google (bouton « Se connecter avec Google ») | Rien à configurer : le navigateur s'ouvre, on autorise, c'est fini. Secours : mot de passe d'application ([myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)). |
| Outlook / Hotmail | OAuth Microsoft (code d'appareil) | Rien à configurer : un code s'affiche, on le saisit dans le navigateur. |
| iCloud | Mot de passe d'application | À créer sur [account.apple.com](https://account.apple.com/account/manage) — Apple ne propose pas d'OAuth pour les clients IMAP tiers. |
| Autre (IMAP) | Mot de passe | Serveur IMAP + port (993 en général). |

Aucune donnée ne transite par un serveur tiers : l'app parle directement à Google/Microsoft puis à l'IMAP.

## Intégrer les identifiants OAuth (mainteneur, une seule fois)

Pour que les boutons « Se connecter avec Google / Microsoft » fonctionnent sans aucune
configuration côté utilisateur, l'app embarque des identifiants OAuth « développeur » —
exactement comme Thunderbird ou tout client mail de bureau. À faire une seule fois :

1. **Google** : sur [console.cloud.google.com/apis/credentials](https://console.cloud.google.com/apis/credentials),
   créez un projet, activez l'API Gmail, configurez l'écran de consentement, puis créez un
   ID client OAuth de type **« Application de bureau »**. (Le « secret » d'une application
   installée n'est pas confidentiel au sens strict — c'est documenté par Google.)
2. **Microsoft** : sur [portal.azure.com](https://portal.azure.com) → Inscriptions
   d'applications → Nouvelle inscription (comptes personnels + professionnels), activez
   « Autoriser les flux de clients publics », copiez l'ID d'application.
3. Fournissez-les à la compilation, au choix :
   - **Recommandé** : copiez `src-tauri/oauth.local.json.example` vers
     `src-tauri/oauth.local.json` et remplissez-le. Ce fichier est ignoré par git
     (aucun secret dans le dépôt) et lu automatiquement à la compilation.
   - Ou par variables d'environnement :

```bash
RANGEMAIL_GOOGLE_CLIENT_ID="xxx.apps.googleusercontent.com" \
RANGEMAIL_GOOGLE_CLIENT_SECRET="GOCSPX-…" \
RANGEMAIL_MS_CLIENT_ID="00000000-0000-…" \
npm run build
```

En attendant, l'app reste utilisable : **Réglages → Réglages avancés** permet de renseigner
ces identifiants manuellement (ils priment sur ceux embarqués), et Gmail/iCloud fonctionnent
avec un mot de passe d'application.

## Classement par IA

Dans **Réglages → Classement par IA**, collez une clé API Anthropic
([console.anthropic.com](https://console.anthropic.com/settings/keys)). Seuls les noms
d'expéditeurs, domaines et objets de mails sont envoyés à l'API — jamais le corps des messages.
Modèle par défaut : Claude Opus 5 (modifiable).

## Sécurité & stockage

- Mots de passe, jetons OAuth et clé API : **trousseau du système** (Keychain macOS) via `keyring` ; repli chiffré en base64 dans le dossier de données de l'app si le trousseau est indisponible.
- Configuration (comptes, réponses d'onboarding, réglages) : `config.json` dans le dossier de données de l'app.
- Connexions IMAP en TLS ; OAuth Google avec PKCE ; OAuth Microsoft en device code flow.

## Architecture

```
src/                 Frontend React (Vite) — vues Accueil, Onboarding, Tableau de bord, Réglages
src-tauri/src/
  lib.rs             Point d'entrée Tauri, enregistrement des commandes
  commands.rs        Commandes exposées au frontend (scan, apply, oauth, comptes…)
  types.rs           Structures partagées (serde camelCase)
  store.rs           Config JSON + secrets (trousseau système)
  oauth.rs           OAuth Google (boucle locale + PKCE) et Microsoft (device code)
  mail/
    mod.rs           Connexion IMAP (mot de passe ou XOAUTH2)
    scanner.rs       Scan de la boîte de réception (en-têtes uniquement, 3 000 mails max)
    classify.rs      Regroupement par expéditeur + classement heuristique + détection newsletters/spam
    ai.rs            Classement par l'API Claude (HTTP direct, prompt caching, effort low)
    organizer.rs     Création des libellés + déplacements IMAP (MOVE, repli COPY+DELETE)
```
