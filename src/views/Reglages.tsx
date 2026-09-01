import { useState } from 'react'
import { api } from '../api'
import type { AppBootstrap } from '../types'

interface Props {
  boot: AppBootstrap
  onChanged: () => Promise<AppBootstrap>
}

export default function Reglages({ boot, onChanged }: Props) {
  const [cle, setCle] = useState('')
  const [modele, setModele] = useState(boot.settings.model)
  const [gId, setGId] = useState(boot.settings.googleClientId)
  const [gSecret, setGSecret] = useState(boot.settings.googleClientSecret)
  const [msId, setMsId] = useState(boot.settings.msClientId)
  const [statut, setStatut] = useState<string | null>(null)

  const enregistrer = async (patch: Parameters<typeof api.setSettings>[0], message: string) => {
    setStatut(null)
    await api.setSettings(patch)
    await onChanged()
    setStatut(message)
  }

  return (
    <div className="colonne etroite">
      <h1>Réglages</h1>
      <p className="sous-titre">
        Tout est stocké sur votre machine ; les clés et mots de passe vont dans le trousseau du
        système.
      </p>

      {statut && <div className="succes">{statut}</div>}

      <div className="carte">
        <h2>Classement par IA (Claude)</h2>
        <p className="aide" style={{ marginBottom: 12 }}>
          Avec une clé API Anthropic, les libellés sont conçus sur mesure à partir de vos réponses
          — seuls les noms d’expéditeurs et objets de mails sont envoyés, jamais le contenu. Sans
          clé, Rangemail applique un classement automatique plus simple.{' '}
          <button className="lien" onClick={() => api.openUrl('https://console.anthropic.com/settings/keys')}>
            Obtenir une clé
          </button>
        </p>
        <label className="champ">
          <span>{boot.hasAnthropicKey ? 'Clé API (une clé est déjà enregistrée)' : 'Clé API'}</span>
          <input
            type="password"
            value={cle}
            onChange={(e) => setCle(e.target.value)}
            placeholder={boot.hasAnthropicKey ? '••••••••  (laisser vide pour conserver)' : 'sk-ant-…'}
          />
        </label>
        <label className="champ">
          <span>Modèle</span>
          <select value={modele} onChange={(e) => setModele(e.target.value)}>
            <option value="claude-opus-5">Claude Opus 5 — qualité maximale (défaut)</option>
            <option value="claude-sonnet-5">Claude Sonnet 5 — rapide et précis</option>
            <option value="claude-haiku-4-5">Claude Haiku 4.5 — le plus économique</option>
          </select>
        </label>
        <div style={{ display: 'flex', gap: 10 }}>
          <button
            className="principal"
            onClick={() =>
              enregistrer(
                cle.trim() ? { model: modele, anthropicKey: cle.trim() } : { model: modele },
                'Réglages IA enregistrés.'
              ).then(() => setCle(''))
            }
          >
            Enregistrer
          </button>
          {boot.hasAnthropicKey && (
            <button
              className="danger"
              onClick={() => enregistrer({ anthropicKey: '' }, 'Clé API supprimée.')}
            >
              Supprimer la clé
            </button>
          )}
        </div>
      </div>

      <div className="carte">
        <h2>Réglages avancés — identifiants OAuth</h2>
        <p className="aide">
          Les boutons « Se connecter avec Google / Microsoft » utilisent normalement les
          identifiants OAuth <strong>embarqués dans l’app</strong> : les utilisateurs n’ont rien à
          configurer ici.{' '}
          {boot.googleOauthReady && boot.msOauthReady
            ? 'Les deux connexions sont prêtes.'
            : boot.googleOauthReady
              ? 'La connexion Google est prête ; Microsoft ne l’est pas encore.'
              : boot.msOauthReady
                ? 'La connexion Microsoft est prête ; Google ne l’est pas encore.'
                : 'Aucun identifiant n’est encore embarqué dans cette version.'}{' '}
          Cette section ne sert qu’à en fournir manuellement (ou à remplacer ceux embarqués).
        </p>
        <details className="guide" style={{ marginTop: 12 }}>
          <summary>Google (Gmail) — fournir un identifiant manuellement</summary>
          <ol>
            <li>
              Ouvrez{' '}
              <button className="lien" onClick={() => api.openUrl('https://console.cloud.google.com/apis/credentials')}>
                console.cloud.google.com/apis/credentials
              </button>{' '}
              et créez un projet (n’importe quel nom).
            </li>
            <li>Activez l’API Gmail : « API et services » → « Bibliothèque » → Gmail API → Activer.</li>
            <li>« Écran de consentement OAuth » : type Externe, ajoutez votre adresse comme utilisateur test.</li>
            <li>« Identifiants » → « Créer des identifiants » → « ID client OAuth » → type « Application de bureau ».</li>
            <li>Copiez l’ID client et le secret ci-dessous.</li>
          </ol>
          <div style={{ marginTop: 14 }}>
          <label className="champ">
            <span>ID client</span>
            <input
              type="text"
              value={gId}
              onChange={(e) => setGId(e.target.value)}
              placeholder="xxxxx.apps.googleusercontent.com"
            />
          </label>
          <label className="champ">
            <span>Secret client</span>
            <input
              type="password"
              value={gSecret}
              onChange={(e) => setGSecret(e.target.value)}
              placeholder="GOCSPX-…"
            />
          </label>
          <button
            className="principal"
            onClick={() =>
              enregistrer(
                { googleClientId: gId, googleClientSecret: gSecret },
                'Identifiants Google enregistrés.'
              )
            }
          >
            Enregistrer
          </button>
          </div>
        </details>

        <details className="guide" style={{ marginTop: 10 }}>
          <summary>Microsoft (Outlook / Hotmail) — fournir un identifiant manuellement</summary>
          <ol>
            <li>
              Ouvrez{' '}
              <button
                className="lien"
                onClick={() =>
                  api.openUrl(
                    'https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'
                  )
                }
              >
                portal.azure.com → Inscriptions d’applications
              </button>{' '}
              → « Nouvelle inscription ».
            </li>
            <li>Comptes pris en charge : « Comptes personnels Microsoft et professionnels ».</li>
            <li>Dans « Authentification », activez « Autoriser les flux de clients publics ».</li>
            <li>Copiez l’« ID d’application (client) » ci-dessous.</li>
          </ol>
          <div style={{ marginTop: 14 }}>
          <label className="champ">
            <span>ID d’application (client)</span>
            <input
              type="text"
              value={msId}
              onChange={(e) => setMsId(e.target.value)}
              placeholder="00000000-0000-0000-0000-000000000000"
            />
          </label>
          <button
            className="principal"
            onClick={() => enregistrer({ msClientId: msId }, 'Identifiant Microsoft enregistré.')}
          >
            Enregistrer
          </button>
          </div>
        </details>
      </div>

      <div className="carte">
        <h2>Comptes connectés</h2>
        {boot.accounts.length === 0 && <p className="aide">Aucun compte pour le moment.</p>}
        {boot.accounts.map((a) => (
          <div className="ligne-compte" key={a.id}>
            <span className="email">{a.email}</span>
            <span className="type">
              {a.provider} · {a.authKind === 'password' ? 'mot de passe' : 'OAuth'}
            </span>
            <button
              className="danger"
              onClick={async () => {
                await api.removeAccount(a.id)
                await onChanged()
              }}
            >
              Retirer
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
