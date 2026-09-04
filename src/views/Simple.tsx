import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { ActionsSemaine, AppBootstrap, JournalEntry, Plan, SenderGroup } from '../types'
import Mascotte from '../Mascotte'
import CompteRendu from '../CompteRendu'

/** Un expéditeur ciblé par une action de masse, avec son compte d'origine. */
type Cible = { compte: string; email: string; s: SenderGroup }

const cibleId = (c: Cible) => `${c.compte}|${c.s.key}`

/**
 * L'écran principal du Médor simple : trois gestes (ranger, supprimer le
 * commercial, se désabonner) sur le compte choisi — ou sur TOUTES les boîtes
 * d'un coup via le jeton « Tous les comptes ».
 */
export default function Simple({
  boot,
  accountId,
  occupe,
  actif,
  onSelectAccount,
  onAddAccount
}: {
  boot: AppBootstrap
  accountId: string
  occupe: boolean
  actif: boolean
  onSelectAccount: (id: string) => void
  onAddAccount: () => void
}) {
  const [tous, setTous] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [plansTous, setPlansTous] = useState<Record<string, Plan | null>>({})
  const [dernier, setDernier] = useState<string | null>(null)
  const [prochaine, setProchaine] = useState<string | null>(null)
  const [actions, setActions] = useState<ActionsSemaine | null>(null)
  const [actionsEnCours, setActionsEnCours] = useState(false)
  const [actionsErreur, setActionsErreur] = useState<string | null>(null)
  const [detailPassage, setDetailPassage] = useState<string[]>([])
  const [montrerDetail, setMontrerDetail] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const occupePrec = useRef(occupe)

  const emailDe = (id: string) => boot.accounts.find((a) => a.id === id)?.email ?? id

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
      // Le compte-rendu ne montre pas ce qui n'existe plus : les libellés
      // supprimés depuis le passage sont filtrés (dès que l'inventaire de
      // « Ma boîte » est plus récent que le passage).
      let lignes = passage?.detail ?? []
      const arbre = await api.getLastTree(accountId)
      if (arbre && passage && arbre.updatedAt > passage.ts) {
        const existants = new Set(arbre.dossiers.map((d) => d.name))
        lignes = lignes.filter((l) => {
          const m = l.match(/^« (.+) » — /)
          return !m || existants.has(m[1])
        })
      }
      setDetailPassage(lignes)
      const prochain = await api.autoNext()
      if (prochain == null) {
        setProchaine(null)
      } else {
        const delta = prochain - Math.floor(Date.now() / 1000)
        const quand = new Date(prochain * 1000)
        const heure = quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        const demain = quand.getDate() !== new Date().getDate()
        setProchaine(
          delta <= 90
            ? 'imminente'
            : delta < 3600
              ? `dans ${Math.round(delta / 60)} min (à ${heure})`
              : `${demain ? 'demain' : "aujourd'hui"} à ${heure}`
        )
      }
    } catch {
      /* silencieux */
    }
  }

  const rechargerTous = async () => {
    const suivant: Record<string, Plan | null> = {}
    for (const a of boot.accounts) {
      try {
        suivant[a.id] = await api.getLastPlan(a.id)
      } catch {
        suivant[a.id] = null
      }
    }
    setPlansTous(suivant)
  }

  const chargerActions = async () => {
    try {
      if (!tous) {
        setActions(await api.getActions(accountId))
        return
      }
      const fusion: ActionsSemaine = { actions: [], generatedAt: 0 }
      for (const a of boot.accounts) {
        const r = await api.getActions(a.id)
        if (r) {
          fusion.generatedAt = Math.max(fusion.generatedAt, r.generatedAt)
          fusion.actions.push(
            ...r.actions.map((x) => ({ ...x, expediteur: `${x.expediteur} · ${a.email}` }))
          )
        }
      }
      setActions(fusion.generatedAt > 0 ? fusion : null)
    } catch {
      /* silencieux */
    }
  }

  useEffect(() => {
    setPlan(null)
    setDernier(null)
    setMessage(null)
    setActions(null)
    setActionsErreur(null)
    if (tous) {
      rechargerTous()
    } else {
      recharger()
    }
    chargerActions()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId, tous])

  // Une opération vient de finir (la nôtre ou une automatique) : on recharge.
  useEffect(() => {
    if (occupePrec.current && !occupe && actif) {
      if (tous) {
        rechargerTous()
      } else {
        recharger()
      }
    }
    occupePrec.current = occupe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupe, actif])

  /** Cibles commerciales (newsletters détectées), selon le mode. */
  const commerciaux = useMemo<Cible[]>(() => {
    const depuis = (compte: string, email: string, p: Plan | null): Cible[] => {
      if (!p) return []
      const parCle = new Map(p.senders.map((s) => [s.key, s]))
      return p.newsletters
        .map((k) => parCle.get(k))
        .filter((s): s is SenderGroup => Boolean(s))
        .map((s) => ({ compte, email, s }))
    }
    if (!tous) return depuis(accountId, emailDe(accountId), plan)
    return boot.accounts.flatMap((a) => depuis(a.id, a.email, plansTous[a.id] ?? null))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tous, plan, plansTous, accountId, boot.accounts])

  const desabonnables = useMemo(
    () =>
      commerciaux.filter(
        (c) => c.s.unsubscribeHttp && (c.s.unsubscribedAt == null || c.s.stillMailing)
      ),
    [commerciaux]
  )
  const totalCommerciaux = useMemo(
    () => commerciaux.reduce((n, c) => n + c.s.total, 0),
    [commerciaux]
  )

  /** Confirmation avec sélection : on décoche ce que Médor doit épargner. */
  const [confirmation, setConfirmation] = useState<'supprimer' | 'desabonner' | null>(null)
  const [coches, setCoches] = useState<Record<string, boolean>>({})

  const ouvrirConfirmation = (mode: 'supprimer' | 'desabonner') => {
    const liste = mode === 'supprimer' ? commerciaux : desabonnables
    const c: Record<string, boolean> = {}
    for (const cible of liste) c[cibleId(cible)] = true
    setCoches(c)
    setMessage(null)
    setErreur(null)
    setConfirmation(mode)
  }

  const executerConfirmation = async () => {
    const mode = confirmation
    const liste = mode === 'supprimer' ? commerciaux : desabonnables
    const choisis = liste.filter((c) => coches[cibleId(c)] !== false)
    setConfirmation(null)
    if (!mode || choisis.length === 0) return
    // Groupé par compte, exécuté boîte par boîte.
    const parCompte = new Map<string, string[]>()
    for (const c of choisis) {
      const l = parCompte.get(c.compte) ?? []
      l.push(c.s.key)
      parCompte.set(c.compte, l)
    }
    try {
      if (mode === 'supprimer') {
        let total = 0
        for (const [compte, cles] of parCompte) {
          total += await api.trashSenders(compte, cles)
        }
        setMessage(
          `${total.toLocaleString('fr-FR')} mails commerciaux supprimés${
            parCompte.size > 1 ? ` sur ${parCompte.size} comptes` : ''
          } (corbeille, récupérables ~30 jours).`
        )
      } else {
        let ok = 0
        let demandes = 0
        for (const [compte, cles] of parCompte) {
          demandes += cles.length
          const res = await api.unsubscribeMany(compte, cles)
          ok += Object.values(res).filter((v) => v === 'ok').length
        }
        const autres = demandes - ok
        setMessage(
          `Désabonnement demandé pour ${ok} newsletters${
            parCompte.size > 1 ? ` sur ${parCompte.size} comptes` : ''
          }${autres > 0 ? ` (${autres} sans lien direct)` : ''}.`
        )
      }
      if (tous) {
        rechargerTous()
      } else {
        recharger()
      }
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    }
  }

  const ranger = async () => {
    setMessage(null)
    setErreur(null)
    try {
      if (!tous) {
        const res = await api.sortEverything(accountId, 'lus', false)
        setMessage(
          res.archived > 0
            ? `${res.archived.toLocaleString('fr-FR')} mails rangés. Les non-lus restent dans votre boîte de réception.`
            : 'Rien de nouveau à ranger : votre boîte est déjà propre.'
        )
        setMontrerDetail(res.archived > 0)
        recharger()
        return
      }
      // Toutes les boîtes, l'une après l'autre.
      const bilans: string[] = []
      let total = 0
      for (const a of boot.accounts) {
        try {
          const res = await api.sortEverything(a.id, 'lus', false)
          total += res.archived
          bilans.push(`${a.email} : ${res.archived.toLocaleString('fr-FR')} mails`)
        } catch (e) {
          const m = String(e)
          if (m.includes('annulée')) throw e
          bilans.push(`${a.email} : ${m}`)
        }
      }
      setMessage(
        `${total.toLocaleString('fr-FR')} mails rangés sur ${boot.accounts.length} comptes — ${bilans.join(' · ')}`
      )
      rechargerTous()
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    }
  }

  const analyserSemaine = async () => {
    setActionsEnCours(true)
    setActionsErreur(null)
    try {
      if (!tous) {
        setActions(await api.actionItems(accountId))
      } else {
        const fusion: ActionsSemaine = {
          actions: [],
          generatedAt: Math.floor(Date.now() / 1000)
        }
        for (const a of boot.accounts) {
          try {
            const r = await api.actionItems(a.id)
            fusion.actions.push(
              ...r.actions.map((x) => ({ ...x, expediteur: `${x.expediteur} · ${a.email}` }))
            )
          } catch (e) {
            const m = String(e)
            if (m.includes('annulée')) throw e
            /* compte sans IA ou en erreur : on continue */
          }
        }
        setActions(fusion)
      }
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setActionsErreur(m)
    } finally {
      setActionsEnCours(false)
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

  const listeConfirmation = confirmation === 'supprimer' ? commerciaux : desabonnables

  return (
    <div className="colonne">
      <div className="barre-comptes">
        <button
          className={`compte-jeton ${tous ? 'choisi' : ''}`}
          onClick={() => setTous(true)}
        >
          Tous les comptes
        </button>
        {boot.accounts.map((a) => (
          <button
            key={a.id}
            className={`compte-jeton ${!tous && a.id === accountId ? 'choisi' : ''}`}
            onClick={() => {
              setTous(false)
              onSelectAccount(a.id)
            }}
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
        <h1 style={{ marginBottom: 6 }}>
          {tous ? 'Toutes vos boîtes, un seul geste.' : 'Médor range, vous vivez.'}
        </h1>
        <p className="sous-titre" style={{ maxWidth: 480, margin: '0 auto 26px' }}>
          Un clic : les mails déjà lus filent dans leurs libellés, les newsletters dans
          « Newsletters ». Les non-lus ne bougent pas. Rien n'est supprimé, tout est annulable
          depuis le Journal.
        </p>
        <button className="principal large" onClick={ranger} disabled={occupe}>
          {occupe
            ? 'Médor s’active…'
            : tous
              ? `Analyser et ranger mes ${boot.accounts.length} boîtes`
              : 'Analyser et ranger ma boîte'}
        </button>
        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginTop: 12
          }}
        >
          <button
            className="secondaire"
            disabled={occupe || commerciaux.length === 0}
            onClick={() => ouvrirConfirmation('supprimer')}
          >
            Supprimer les mails commerciaux
            {totalCommerciaux > 0 ? ` (${totalCommerciaux.toLocaleString('fr-FR')} mails)` : ''}
          </button>
          <button
            className="secondaire"
            disabled={occupe || desabonnables.length === 0}
            onClick={() => ouvrirConfirmation('desabonner')}
          >
            Se désabonner des newsletters
            {desabonnables.length > 0 ? ` (${desabonnables.length})` : ''}
          </button>
        </div>
        {((!tous && dernier) || prochaine) && (
          <p className="precision" style={{ marginTop: 16, color: 'var(--gris)', fontSize: 13 }}>
            {!tous && dernier && <>Dernier passage : {dernier}</>}
            {!tous && dernier && prochaine && ' · '}
            {prochaine && <>Prochaine analyse auto : {prochaine}</>}
          </p>
        )}
        {message && <div className="info" style={{ marginTop: 14, textAlign: 'left' }}>{message}</div>}
        {erreur && <div className="erreur" style={{ marginTop: 14, textAlign: 'left' }}>{erreur}</div>}
        {!tous && detailPassage.length > 0 && (
          <details open={montrerDetail} style={{ marginTop: 12, textAlign: 'left' }}>
            <summary className="aide" style={{ cursor: 'pointer' }}>
              Ce que Médor a fait ({detailPassage.length} libellés)
            </summary>
            <CompteRendu lignes={detailPassage} />
          </details>
        )}
      </div>

      <div className="carte ombre">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <h2 style={{ margin: 0 }}>À faire cette semaine</h2>
            <p className="aide" style={{ margin: '2px 0 0' }}>
              Médor relit vos 7 derniers jours et repère qui attend quoi de vous.
              {actions && actions.generatedAt > 0 && (
                <>
                  {' '}
                  Analyse du{' '}
                  {new Date(actions.generatedAt * 1000).toLocaleString('fr-FR', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                  .
                </>
              )}
            </p>
          </div>
          <button
            className="secondaire"
            onClick={analyserSemaine}
            disabled={actionsEnCours || occupe}
          >
            {actionsEnCours
              ? 'Médor relit la semaine…'
              : tous
                ? `Analyser la semaine des ${boot.accounts.length} boîtes`
                : 'Analyser ma semaine'}
          </button>
        </div>
        {actionsErreur && (
          <div className="erreur" style={{ marginTop: 12 }}>
            {actionsErreur}
          </div>
        )}
        {actions && actions.actions.length === 0 && (
          <p className="aide" style={{ marginTop: 12 }}>
            Rien ne semble attendre de réponse — belle semaine.
          </p>
        )}
        {actions && actions.actions.length > 0 && (
          <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {actions.actions.map((a, i) => (
              <div
                key={i}
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'baseline',
                  padding: '10px 14px',
                  border: '1px solid var(--ligne)',
                  borderRadius: 10
                }}
              >
                <span
                  className="cr-pastille"
                  style={{
                    background: a.urgence === 'haute' ? '#c34a3e' : '#75808b',
                    alignSelf: 'center'
                  }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>{a.titre}</strong>
                  {a.detail && (
                    <div className="aide" style={{ marginTop: 2 }}>
                      {a.detail}
                    </div>
                  )}
                </div>
                <span className="mono" style={{ color: 'var(--gris)', fontSize: 12, whiteSpace: 'nowrap' }}>
                  {a.expediteur}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {confirmation && (
        <div className="voile" onClick={() => setConfirmation(null)}>
        <div className="modale" onClick={(e) => e.stopPropagation()}>
          <h2 style={{ margin: 0 }}>
            {confirmation === 'supprimer'
              ? 'Supprimer les mails commerciaux'
              : 'Se désabonner des newsletters'}
            {tous ? ` — ${boot.accounts.length} comptes` : ''}
          </h2>
          <p className="aide" style={{ margin: '4px 0 10px' }}>
            Décochez ce que Médor doit laisser tranquille, puis confirmez.
            {confirmation === 'supprimer'
              ? ' Les mails partent à la corbeille du compte (récupérables ~30 jours).'
              : ' Un désabonnement en un clic est demandé à chaque expéditeur coché.'}
          </p>
          <div
            style={{
              maxHeight: '52vh',
              overflowY: 'auto',
              border: '1px solid var(--ligne)',
              borderRadius: 10,
              padding: '2px 14px'
            }}
          >
            {listeConfirmation.map((c) => (
              <label
                key={cibleId(c)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '7px 0',
                  borderBottom: '1px solid var(--ligne)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={coches[cibleId(c)] !== false}
                  onChange={(e) =>
                    setCoches((prev) => ({ ...prev, [cibleId(c)]: e.target.checked }))
                  }
                />
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {c.s.name || c.s.address}{' '}
                  <span className="mono" style={{ color: 'var(--gris)', fontSize: 12 }}>
                    {c.s.address}
                  </span>
                </span>
                {tous && <span className="badge existant">{c.email}</span>}
                {c.s.stillMailing && <span className="badge spam">écrit encore</span>}
                <span className="aide" style={{ whiteSpace: 'nowrap' }}>
                  {c.s.total.toLocaleString('fr-FR')} mails ·{' '}
                  {c.s.total > 0 ? Math.round((c.s.read / c.s.total) * 100) : 0} % lus
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="danger" onClick={executerConfirmation} disabled={occupe}>
              {confirmation === 'supprimer'
                ? `Supprimer ${listeConfirmation
                    .filter((c) => coches[cibleId(c)] !== false)
                    .reduce((n, c) => n + c.s.total, 0)
                    .toLocaleString('fr-FR')} mails`
                : `Se désabonner de ${
                    listeConfirmation.filter((c) => coches[cibleId(c)] !== false).length
                  } newsletters`}
            </button>
            <button className="secondaire" onClick={() => setConfirmation(null)}>
              Annuler
            </button>
          </div>
        </div>
        </div>
      )}

      {!tous && (
        <p style={{ textAlign: 'center' }}>
          <button className="discret" onClick={inventorier} disabled={chargement || occupe}>
            {chargement ? 'Inventaire…' : 'Actualiser les compteurs (relire les dossiers)'}
          </button>
        </p>
      )}
    </div>
  )
}
