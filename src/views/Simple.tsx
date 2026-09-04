import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { AppBootstrap, ApplyProgress, JournalEntry, Plan, SenderGroup } from '../types'
import { Newsletters } from './Dashboard'
import Mascotte from '../Mascotte'

/**
 * L'écran principal du Médor simple : un gros bouton qui range tout seul
 * (mails lus uniquement — les non-lus restent visibles dans la boîte de
 * réception), et la liste des newsletters juste en dessous. Rien d'autre.
 */
export default function Simple({
  boot,
  accountId,
  occupe,
  actif,
  onSelectAccount,
  onAddAccount,
  onOuvrirAvance
}: {
  boot: AppBootstrap
  accountId: string
  occupe: boolean
  actif: boolean
  onSelectAccount: (id: string) => void
  onAddAccount: () => void
  onOuvrirAvance: () => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [dernier, setDernier] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const occupePrec = useRef(occupe)

  const noop: React.Dispatch<React.SetStateAction<ApplyProgress | null>> = () => {}

  const recharger = async () => {
    try {
      const [p, journal] = await Promise.all([api.getLastPlan(accountId), api.getJournal()])
      setPlan(p)
      const passage = journal.find(
        (e: JournalEntry) =>
          e.accountId === accountId && (e.kind === 'rangement' || e.kind === 'auto')
      )
      setDernier(
        passage
          ? `${new Date(passage.ts * 1000).toLocaleString('fr-FR', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit'
            })} — ${passage.archived.toLocaleString('fr-FR')} mails rangés`
          : null
      )
    } catch {
      /* silencieux */
    }
  }

  useEffect(() => {
    setPlan(null)
    setDernier(null)
    setMessage(null)
    recharger()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Une opération vient de finir (la nôtre ou une automatique) : on recharge.
  useEffect(() => {
    if (occupePrec.current && !occupe && actif) {
      recharger()
    }
    occupePrec.current = occupe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupe, actif])

  const parCle = useMemo(() => {
    const map = new Map<string, SenderGroup>()
    plan?.senders.forEach((s) => map.set(s.key, s))
    return map
  }, [plan])

  const ranger = async () => {
    setMessage(null)
    setErreur(null)
    try {
      const res = await api.sortEverything(accountId, 'lus', false)
      setMessage(
        res.archived > 0
          ? `${res.archived.toLocaleString('fr-FR')} mails rangés. Les non-lus restent dans votre boîte de réception.`
          : 'Rien de nouveau à ranger : votre boîte est déjà propre.'
      )
      recharger()
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    }
  }

  const inventorier = async () => {
    setChargement(true)
    setErreur(null)
    try {
      setPlan(await api.rescanOrganized(accountId))
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    } finally {
      setChargement(false)
    }
  }

  const newsletters = plan?.newsletters.length ?? 0

  return (
    <div className="colonne">
      <div className="barre-comptes">
        {boot.accounts.map((a) => (
          <button
            key={a.id}
            className={`compte-jeton ${a.id === accountId ? 'choisi' : ''}`}
            onClick={() => onSelectAccount(a.id)}
          >
            {a.email}
          </button>
        ))}
        <button className="discret" onClick={onAddAccount}>
          + Ajouter un compte
        </button>
      </div>

      <div className="carte ombre heros" style={{ textAlign: 'center', padding: '46px 30px 34px' }}>
        <Mascotte taille={84} style={{ marginBottom: 14 }} />
        <h1 style={{ marginBottom: 6 }}>Médor range, vous vivez.</h1>
        <p className="sous-titre" style={{ maxWidth: 480, margin: '0 auto 26px' }}>
          Un clic : les mails déjà lus filent dans leurs libellés, les newsletters dans
          « Newsletters ». Les non-lus ne bougent pas. Rien n'est supprimé, tout est annulable
          depuis le Journal.
        </p>
        <button className="principal large" onClick={ranger} disabled={occupe}>
          {occupe ? 'Médor s’active…' : 'Ranger ma boîte'}
        </button>
        {dernier && (
          <p className="precision" style={{ marginTop: 16, color: 'var(--gris)', fontSize: 13 }}>
            Dernier passage : {dernier}
          </p>
        )}
        {message && <div className="info" style={{ marginTop: 14, textAlign: 'left' }}>{message}</div>}
        {erreur && <div className="erreur" style={{ marginTop: 14, textAlign: 'left' }}>{erreur}</div>}
      </div>

      <div className="carte ombre">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: 0 }}>Newsletters</h2>
            <p className="aide" style={{ margin: '2px 0 0' }}>
              {newsletters > 0
                ? `${newsletters.toLocaleString('fr-FR')} newsletters repérées — désabonnez, supprimez.`
                : 'Se désabonner et supprimer, en un clic.'}
            </p>
          </div>
          <button className="discret" onClick={inventorier} disabled={chargement || occupe}>
            {chargement ? 'Inventaire…' : 'Actualiser la liste'}
          </button>
        </div>
        {!plan && !chargement && (
          <p className="aide" style={{ marginTop: 12 }}>
            Lancez « Ranger ma boîte » (ou « Actualiser la liste ») pour repérer vos newsletters.
          </p>
        )}
        {plan && newsletters === 0 && (
          <p className="aide" style={{ marginTop: 12 }}>
            Aucune newsletter repérée pour l'instant.
          </p>
        )}
        {plan && newsletters > 0 && (
          <div style={{ marginTop: 14 }}>
            <Newsletters
              plan={plan}
              parCle={parCle}
              accountId={accountId}
              occupe={occupe}
              progresser={noop}
            />
          </div>
        )}
      </div>

      <p style={{ textAlign: 'center' }}>
        <button className="discret" onClick={onOuvrirAvance}>
          Analyse détaillée (avancé)
        </button>
      </p>
    </div>
  )
}
