import { useState } from 'react'
import { api } from '../api'
import type { AccountConfig, AppBootstrap, MsDeviceCodeInfo, ProviderId } from '../types'

interface Props {
  boot: AppBootstrap
  onAccountAdded: (account: AccountConfig) => void
  onOpenSettings: () => void
}

const FOURNISSEURS: { id: ProviderId; nom: string; detail: string; couleur: string; initiale: string }[] = [
  {
    id: 'gmail',
    nom: 'Gmail',
    detail: 'Connexion Google, ou mot de passe d’application',
    couleur: '#c34a3e',
    initiale: 'G'
  },
  {
    id: 'outlook',
    nom: 'Outlook / Hotmail',
    detail: 'Connexion Microsoft par code d’appareil',
    couleur: '#27519f',
    initiale: 'O'
  },
  {
    id: 'icloud',
    nom: 'iCloud Mail',
    detail: 'Mot de passe d’application Apple',
    couleur: '#75808b',
    initiale: 'i'
  },
  {
    id: 'imap',
    nom: 'Autre boîte (IMAP)',
    detail: 'OVH, Proton (bridge), Free, La Poste…',
    couleur: '#2e7d5b',
    initiale: '@'
  }
]

export default function Accueil({ boot, onAccountAdded, onOpenSettings }: Props) {
  const [panneau, setPanneau] = useState<ProviderId | null>(null)
  const premiere = boot.accounts.length === 0

  return (
    <div className="colonne etroite">
      {premiere && (
        <div className="heros">
          <div className="timbre">R</div>
          <h1>Rangez votre boîte mail</h1>
          <p className="sous-titre">
            Connectez votre boîte, répondez à quelques questions, et Rangemail crée des libellés
            sur mesure, archive les mails déjà lus, liste vos newsletters et vous aide à vous
            désabonner. Rien n’est supprimé, tout reste retrouvable.
          </p>
        </div>
      )}
      {!premiere && (
        <>
          <h1>Comptes</h1>
          <p className="sous-titre">Ajoutez une autre boîte mail ou gérez celles déjà connectées.</p>
          {boot.accounts.length > 0 && (
            <div className="carte" style={{ marginBottom: 20 }}>
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
                      location.reload()
                    }}
                  >
                    Retirer
                  </button>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {panneau === null ? (
        <div className="grille-fournisseurs">
          {FOURNISSEURS.map((f) => (
            <button key={f.id} className="fournisseur" onClick={() => setPanneau(f.id)}>
              <span className="pastille" style={{ background: f.couleur }}>
                {f.initiale}
              </span>
              <span className="nom">{f.nom}</span>
              <span className="detail">{f.detail}</span>
            </button>
          ))}
        </div>
      ) : (
        <PanneauConnexion
          provider={panneau}
          boot={boot}
          onBack={() => setPanneau(null)}
          onAccountAdded={onAccountAdded}
          onOpenSettings={onOpenSettings}
        />
      )}
    </div>
  )
}

function PanneauConnexion({
  provider,
  boot,
  onBack,
  onAccountAdded,
  onOpenSettings
}: {
  provider: ProviderId
  boot: AppBootstrap
  onBack: () => void
  onAccountAdded: (a: AccountConfig) => void
  onOpenSettings: () => void
}) {
  const [email, setEmail] = useState('')
  const [motDePasse, setMotDePasse] = useState('')
  const [host, setHost] = useState('')
  const [port, setPort] = useState('993')
  const [occupe, setOccupe] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [codeMs, setCodeMs] = useState<MsDeviceCodeInfo | null>(null)

  const nom = FOURNISSEURS.find((f) => f.id === provider)?.nom ?? provider

  const connecterMotDePasse = async () => {
    setOccupe(true)
    setErreur(null)
    try {
      const compte = await api.addAccount({
        provider,
        email,
        authKind: 'password',
        password: motDePasse,
        imap: provider === 'imap' ? { host, port: Number(port) || 993 } : undefined
      })
      onAccountAdded(compte)
    } catch (e) {
      setErreur(String(e))
    } finally {
      setOccupe(false)
    }
  }

  const connecterGoogle = async () => {
    setOccupe(true)
    setErreur(null)
    try {
      const compte = await api.googleConnect()
      onAccountAdded(compte)
    } catch (e) {
      setErreur(String(e))
    } finally {
      setOccupe(false)
    }
  }

  const connecterMicrosoft = async () => {
    setOccupe(true)
    setErreur(null)
    try {
      const info = await api.msDeviceStart()
      setCodeMs(info)
      await api.openUrl(info.verificationUri)
      const compte = await api.msDeviceFinish()
      onAccountAdded(compte)
    } catch (e) {
      setErreur(String(e))
      setCodeMs(null)
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="carte ombre">
      <button className="discret" onClick={onBack} disabled={occupe}>
        ← Autres fournisseurs
      </button>
      <h2 style={{ marginTop: 10 }}>Connecter {nom}</h2>

      {erreur && <div className="erreur">{erreur}</div>}

      {provider === 'gmail' && (
        <>
          <div style={{ margin: '16px 0' }}>
            <button
              className="principal large"
              onClick={connecterGoogle}
              disabled={occupe || !boot.googleOauthReady}
            >
              {occupe ? 'Connexion en cours…' : 'Se connecter avec Google'}
            </button>
            <p className="aide" style={{ marginTop: 8 }}>
              Votre navigateur s’ouvre, vous autorisez Rangemail, c’est tout. Aucune clé à saisir.
            </p>
            {!boot.googleOauthReady && (
              <div className="info">
                Cette version de l’app n’embarque pas encore d’identifiant OAuth Google : le
                mainteneur doit en intégrer un (voir README), ou vous pouvez en renseigner un dans{' '}
                <button className="lien" onClick={onOpenSettings}>
                  les réglages avancés
                </button>
                . En attendant, le mot de passe d’application ci-dessous fonctionne.
              </div>
            )}
          </div>
          <details className="guide">
            <summary>Autre option : mot de passe d’application</summary>
            <p className="aide" style={{ margin: '10px 0 12px' }}>
              Activez la validation en deux étapes sur votre compte Google, puis créez un mot de
              passe d’application sur{' '}
              <button className="lien" onClick={() => api.openUrl('https://myaccount.google.com/apppasswords')}>
                myaccount.google.com/apppasswords
              </button>
              .
            </p>
            <FormulaireMotDePasse
              email={email}
              setEmail={setEmail}
              motDePasse={motDePasse}
              setMotDePasse={setMotDePasse}
              placeholder="mot de passe d’application (16 lettres)"
              occupe={occupe}
              onSubmit={connecterMotDePasse}
            />
          </details>
        </>
      )}

      {provider === 'outlook' && (
        <>
          {!boot.msOauthReady && (
            <div className="info">
              Cette version de l’app n’embarque pas encore d’identifiant OAuth Microsoft : le
              mainteneur doit en intégrer un (voir README), ou vous pouvez en renseigner un dans{' '}
              <button className="lien" onClick={onOpenSettings}>
                les réglages avancés
              </button>
              .
            </div>
          )}
          {codeMs ? (
            <div style={{ margin: '16px 0' }}>
              <p>
                Saisissez ce code sur{' '}
                <button className="lien" onClick={() => api.openUrl(codeMs.verificationUri)}>
                  {codeMs.verificationUri.replace('https://', '')}
                </button>{' '}
                :
              </p>
              <div className="code-appareil">{codeMs.userCode}</div>
              <p className="aide">En attente de la validation dans votre navigateur…</p>
            </div>
          ) : (
            <div style={{ margin: '16px 0' }}>
              <button
                className="principal large"
                onClick={connecterMicrosoft}
                disabled={occupe || !boot.msOauthReady}
              >
                {occupe ? 'Connexion en cours…' : 'Se connecter avec Microsoft'}
              </button>
              <p className="aide" style={{ marginTop: 8 }}>
                Un code s’affichera ici, à saisir dans votre navigateur pour autoriser Rangemail.
                Aucune clé à saisir.
              </p>
            </div>
          )}
        </>
      )}

      {provider === 'icloud' && (
        <>
          <p className="aide" style={{ margin: '10px 0 14px' }}>
            iCloud demande un mot de passe d’application : créez-en un sur{' '}
            <button className="lien" onClick={() => api.openUrl('https://account.apple.com/account/manage')}>
              account.apple.com
            </button>{' '}
            (rubrique « Mots de passe d’application »), puis utilisez-le ici avec votre adresse
            iCloud.
          </p>
          <FormulaireMotDePasse
            email={email}
            setEmail={setEmail}
            motDePasse={motDePasse}
            setMotDePasse={setMotDePasse}
            placeholder="mot de passe d’application"
            occupe={occupe}
            onSubmit={connecterMotDePasse}
          />
        </>
      )}

      {provider === 'imap' && (
        <>
          <p className="aide" style={{ margin: '10px 0 14px' }}>
            Renseignez le serveur IMAP de votre fournisseur (souvent indiqué dans son aide en
            ligne). La connexion est chiffrée (SSL).
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
            <label className="champ">
              <span>Serveur IMAP</span>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="imap.exemple.fr"
              />
            </label>
            <label className="champ">
              <span>Port</span>
              <input type="number" value={port} onChange={(e) => setPort(e.target.value)} />
            </label>
          </div>
          <FormulaireMotDePasse
            email={email}
            setEmail={setEmail}
            motDePasse={motDePasse}
            setMotDePasse={setMotDePasse}
            placeholder="mot de passe"
            occupe={occupe}
            onSubmit={connecterMotDePasse}
          />
        </>
      )}
    </div>
  )
}

function FormulaireMotDePasse({
  email,
  setEmail,
  motDePasse,
  setMotDePasse,
  placeholder,
  occupe,
  onSubmit
}: {
  email: string
  setEmail: (v: string) => void
  motDePasse: string
  setMotDePasse: (v: string) => void
  placeholder: string
  occupe: boolean
  onSubmit: () => void
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      <label className="champ">
        <span>Adresse e-mail</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="vous@exemple.fr"
          required
        />
      </label>
      <label className="champ">
        <span>Mot de passe</span>
        <input
          type="password"
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          placeholder={placeholder}
          required
        />
      </label>
      <button className="principal" type="submit" disabled={occupe}>
        {occupe ? 'Vérification de la connexion…' : 'Connecter cette boîte'}
      </button>
    </form>
  )
}
