import { useState } from 'react'
import { api } from '../api'
import type { AppBootstrap } from '../types'
import Mascotte from '../Mascotte'

interface Props {
  boot: AppBootstrap
  onChanged: () => Promise<AppBootstrap>
  onEditOnboarding: () => void
}

export default function Reglages({ boot, onChanged, onEditOnboarding }: Props) {
  const [cle, setCle] = useState('')
  const [modele, setModele] = useState(boot.settings.model)
  const [gId, setGId] = useState(boot.settings.googleClientId)
  const [gSecret, setGSecret] = useState(boot.settings.googleClientSecret)
  const [msId, setMsId] = useState(boot.settings.msClientId)
  const [statut, setStatut] = useState<string | null>(null)
  const [autoActif, setAutoActif] = useState(boot.settings.autoEnabled)
  const [autoFreq, setAutoFreq] = useState(boot.settings.autoFrequency || 'jour')
  const [autoHeure, setAutoHeure] = useState(boot.settings.autoHour ?? 8)
  const [autoPortee, setAutoPortee] = useState(boot.settings.autoScope || 'lus')
  const [autoSpam, setAutoSpam] = useState(boot.settings.autoJunk)
  const [maintCompte, setMaintCompte] = useState(boot.accounts[0]?.id ?? '')
  const [maintArme, setMaintArme] = useState<'rangemail' | 'tous' | 'restaurer' | null>(null)
  const [maintOccupe, setMaintOccupe] = useState(false)
  const [maintResultat, setMaintResultat] = useState<string | null>(null)

  const supprimerLibelles = async () => {
    if (!maintArme || !maintCompte) return
    setMaintOccupe(true)
    setMaintResultat(null)
    try {
      if (maintArme === 'restaurer') {
        const res = await api.restoreInbox(maintCompte)
        setMaintResultat(
          `${res.restored} mails remis dans la boîte de réception, ${res.foldersDeleted} dossiers Médor supprimés.` +
            (res.errors.length > 0 ? ` ${res.errors.length} erreurs : ${res.errors[0]}` : '')
        )
      } else {
        const res = await api.deleteLabels(maintCompte, maintArme === 'rangemail')
        setMaintResultat(
          `${res.deleted} libellés supprimés.` +
            (res.errors.length > 0 ? ` ${res.errors.length} erreurs : ${res.errors[0]}` : '')
        )
      }
    } catch (e) {
      setMaintResultat(String(e))
    } finally {
      setMaintOccupe(false)
      setMaintArme(null)
    }
  }

  const enregistrer = async (patch: Parameters<typeof api.setSettings>[0], message: string) => {
    setStatut(null)
    await api.setSettings(patch)
    await onChanged()
    setStatut(message)
  }

  return (
    <div className="colonne etroite">
      <h1>
        <Mascotte taille={38} style={{ marginRight: 10, verticalAlign: -6 }} />
        Réglages
      </h1>
      <p className="sous-titre">
        Tout est stocké sur votre machine ; les clés et mots de passe vont dans le trousseau du
        système.
      </p>

      {statut && <div className="succes">{statut}</div>}

      <div className="carte">
        <h2>Préférences de rangement</h2>
        {boot.onboarding ? (
          <p className="aide" style={{ marginBottom: 12 }}>
            Usage {boot.onboarding.usage} · style{' '}
            {boot.onboarding.granularity === 'fin' ? 'détaillé (sous-dossiers)' : 'simple'} ·{' '}
            {boot.onboarding.horizonMonths === 0
              ? 'toute la boîte'
              : `${boot.onboarding.horizonMonths} derniers mois`}
            {boot.onboarding.notes.trim() !== '' && (
              <>
                <br />
                Vos consignes : « {boot.onboarding.notes.trim().slice(0, 140)}
                {boot.onboarding.notes.trim().length > 140 ? '…' : ''} »
              </>
            )}
          </p>
        ) : (
          <p className="aide" style={{ marginBottom: 12 }}>
            Le questionnaire n’a pas encore été rempli.
          </p>
        )}
        <button className="secondaire" onClick={onEditOnboarding}>
          Modifier mes réponses
        </button>
      </div>

      <div className="carte">
        <h2>Classement par IA (Claude)</h2>
        {boot.claudeCliAvailable && !boot.hasAnthropicKey && (
          <div className="succes">
            Claude Code est détecté sur cet ordinateur : le classement IA passe automatiquement
            par votre session Claude (votre abonnement), sans clé API ni coût supplémentaire.
          </div>
        )}
        <p className="aide" style={{ marginBottom: 12 }}>
          L’IA conçoit des libellés sur mesure à partir de vos réponses — seuls les noms
          d’expéditeurs et objets de mails sont envoyés, jamais le contenu.{' '}
          {boot.claudeCliAvailable
            ? 'Une clé API Anthropic (facultative) remplace la session Claude Code si vous préférez une facturation à l’usage.'
            : 'Sans Claude Code installé ni clé API, Médor applique un classement automatique plus simple.'}{' '}
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
        <h2>Volume d’analyse</h2>
        <p className="aide" style={{ marginBottom: 12 }}>
          Nombre maximal de mails traités par analyse (les plus récents d’abord). Astuce : après
          un rangement, relancer une analyse traite la tranche suivante — inutile de tout faire
          d’un coup.
        </p>
        <label className="champ" style={{ maxWidth: 340 }}>
          <span>Limite par analyse</span>
          <select
            value={boot.settings.scanLimit ?? 3000}
            onChange={(e) =>
              enregistrer({ scanLimit: Number(e.target.value) }, 'Limite d’analyse enregistrée.')
            }
          >
            <option value={1000}>1 000 mails — éclair</option>
            <option value={3000}>3 000 mails — recommandé</option>
            <option value={10000}>10 000 mails — grosse session</option>
            <option value={0}>Sans limite — toute la boîte d’un coup</option>
          </select>
        </label>
      </div>

      <div className="carte">
        <h2>Rangement automatique</h2>
        <p className="aide" style={{ marginBottom: 12 }}>
          Médor analyse et range les nouveaux mails tout seul, à la fréquence choisie, sur tous
          les comptes connectés, avec les mêmes règles que le rangement manuel (jamais de
          suppression). Une notification vous résume ce qui a été fait. Fermer la fenêtre ne
          quitte pas Médor : il continue depuis la <strong>barre de menus</strong> (quittez-le
          depuis son icône si besoin).
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={boot.autostartEnabled}
            onChange={async (e) => {
              await api.setAutostart(e.target.checked)
              await onChanged()
            }}
          />
          Lancer Médor à l’ouverture de session (recommandé)
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, cursor: 'pointer', fontWeight: 600 }}>
          <input type="checkbox" checked={autoActif} onChange={(e) => setAutoActif(e.target.checked)} />
          Activer le rangement automatique
        </label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label className="champ">
            <span>Fréquence</span>
            <select value={autoFreq} onChange={(e) => setAutoFreq(e.target.value)}>
              <option value="1h">Toutes les heures</option>
              <option value="6h">Toutes les 6 heures</option>
              <option value="jour">Une fois par jour</option>
            </select>
          </label>
          {autoFreq === 'jour' ? (
            <label className="champ">
              <span>À quelle heure</span>
              <select value={autoHeure} onChange={(e) => setAutoHeure(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')} h 00
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <span />
          )}
          <label className="champ">
            <span>Portée</span>
            <select value={autoPortee} onChange={(e) => setAutoPortee(e.target.value)}>
              <option value="lus">Mails déjà lus</option>
              <option value="nonlus">Mails non lus</option>
              <option value="tous">Toute la boîte</option>
            </select>
          </label>
          <label
            style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginTop: 18 }}
          >
            <input type="checkbox" checked={autoSpam} onChange={(e) => setAutoSpam(e.target.checked)} />
            Déplacer aussi les indésirables détectés
          </label>
        </div>
        <button
          className="principal"
          onClick={() =>
            enregistrer(
              {
                autoEnabled: autoActif,
                autoFrequency: autoFreq,
                autoHour: autoHeure,
                autoScope: autoPortee,
                autoJunk: autoSpam
              },
              autoActif ? 'Rangement automatique activé.' : 'Rangement automatique désactivé.'
            )
          }
        >
          Enregistrer
        </button>
        {boot.lastAuto && (
          <div className="info" style={{ marginTop: 12 }}>
            Dernier rangement automatique : {boot.lastAuto}
          </div>
        )}
      </div>

      <div className="carte">
        <h2>Maintenance des libellés</h2>
        <p className="aide" style={{ marginBottom: 12 }}>
          Supprime les libellés directement sur le serveur, sans toucher aux mails : sur Gmail,
          ils restent retrouvables dans « Tous les messages ». Pratique pour repartir de zéro.
        </p>
        {boot.accounts.length === 0 ? (
          <p className="aide">Connectez d’abord un compte.</p>
        ) : (
          <>
            <label className="champ" style={{ maxWidth: 340 }}>
              <span>Compte</span>
              <select value={maintCompte} onChange={(e) => setMaintCompte(e.target.value)}>
                {boot.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.email}
                  </option>
                ))}
              </select>
            </label>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                className="principal"
                disabled={maintOccupe}
                onClick={() => setMaintArme('restaurer')}
              >
                ↩︎ Annuler le rangement : tout remettre en boîte de réception
              </button>
              <button
                className="danger"
                disabled={maintOccupe}
                onClick={() => setMaintArme('rangemail')}
              >
                Supprimer les libellés créés par Médor
              </button>
              <button className="danger" disabled={maintOccupe} onClick={() => setMaintArme('tous')}>
                Supprimer TOUS les libellés
              </button>
            </div>
            {maintArme && (
              <div className="erreur" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span>
                  {maintArme === 'restaurer'
                    ? 'Vider tous les dossiers créés par Médor vers la boîte de réception, puis les supprimer ? Aucun mail n’est supprimé.'
                    : maintArme === 'tous'
                      ? 'Vraiment supprimer TOUS les libellés de ce compte, y compris ceux créés à la main ?'
                      : 'Supprimer les libellés créés par Médor sur ce compte ?'}
                </span>
                <button
                  className={maintArme === 'restaurer' ? 'principal' : 'danger'}
                  disabled={maintOccupe}
                  onClick={supprimerLibelles}
                >
                  {maintOccupe
                    ? 'En cours…'
                    : maintArme === 'restaurer'
                      ? 'Oui, tout remettre'
                      : 'Oui, supprimer'}
                </button>
                <button className="secondaire" disabled={maintOccupe} onClick={() => setMaintArme(null)}>
                  Annuler
                </button>
              </div>
            )}
            {maintResultat && <div className="info">{maintResultat}</div>}
          </>
        )}
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
