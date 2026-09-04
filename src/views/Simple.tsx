import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { AppBootstrap, JournalEntry, Plan, SenderGroup } from '../types'
import Mascotte from '../Mascotte'
import CompteRendu from '../CompteRendu'

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
  onAddAccount
}: {
  boot: AppBootstrap
  accountId: string
  occupe: boolean
  actif: boolean
  onSelectAccount: (id: string) => void
  onAddAccount: () => void
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [dernier, setDernier] = useState<string | null>(null)
  const [prochaine, setProchaine] = useState<string | null>(null)
  const [detailPassage, setDetailPassage] = useState<string[]>([])
  const [montrerDetail, setMontrerDetail] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [chargement, setChargement] = useState(false)
  const occupePrec = useRef(occupe)

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

  /** Expéditeurs commerciaux (newsletters détectées) encore présents. */
  const commerciaux = useMemo(
    () =>
      (plan?.newsletters ?? [])
        .map((k) => parCle.get(k))
        .filter((s): s is SenderGroup => Boolean(s)),
    [plan, parCle]
  )
  const desabonnables = useMemo(
    () =>
      commerciaux.filter(
        (s) => s.unsubscribeHttp && (s.unsubscribedAt == null || s.stillMailing)
      ),
    [commerciaux]
  )
  const totalCommerciaux = useMemo(
    () => commerciaux.reduce((n, s) => n + s.total, 0),
    [commerciaux]
  )

  /** Confirmation avec sélection : on décoche ce que Médor doit épargner. */
  const [confirmation, setConfirmation] = useState<'supprimer' | 'desabonner' | null>(null)
  const [coches, setCoches] = useState<Record<string, boolean>>({})

  const ouvrirConfirmation = (mode: 'supprimer' | 'desabonner') => {
    const liste = mode === 'supprimer' ? commerciaux : desabonnables
    const c: Record<string, boolean> = {}
    for (const s of liste) c[s.key] = true
    setCoches(c)
    setMessage(null)
    setErreur(null)
    setConfirmation(mode)
  }

  const executerConfirmation = async () => {
    const mode = confirmation
    const liste = mode === 'supprimer' ? commerciaux : desabonnables
    const cles = liste.filter((s) => coches[s.key] !== false).map((s) => s.key)
    setConfirmation(null)
    if (!mode || cles.length === 0) return
    try {
      if (mode === 'supprimer') {
        const n = await api.trashSenders(accountId, cles)
        setMessage(
          `${n.toLocaleString('fr-FR')} mails commerciaux supprimés (corbeille du compte, récupérables ~30 jours).`
        )
      } else {
        const res = await api.unsubscribeMany(accountId, cles)
        const ok = Object.values(res).filter((v) => v === 'ok').length
        const autres = cles.length - ok
        setMessage(
          `Désabonnement demandé pour ${ok} newsletters${autres > 0 ? ` (${autres} sans lien direct — voir la liste en dessous)` : ''}.`
        )
      }
      recharger()
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    }
  }

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
      setMontrerDetail(res.archived > 0)
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
        {(dernier || prochaine) && (
          <p className="precision" style={{ marginTop: 16, color: 'var(--gris)', fontSize: 13 }}>
            {dernier && <>Dernier passage : {dernier}</>}
            {dernier && prochaine && ' · '}
            {prochaine && <>Prochaine analyse auto : {prochaine}</>}
          </p>
        )}
        {message && <div className="info" style={{ marginTop: 14, textAlign: 'left' }}>{message}</div>}
        {erreur && <div className="erreur" style={{ marginTop: 14, textAlign: 'left' }}>{erreur}</div>}
        {detailPassage.length > 0 && (
          <details open={montrerDetail} style={{ marginTop: 12, textAlign: 'left' }}>
            <summary className="aide" style={{ cursor: 'pointer' }}>
              Ce que Médor a fait ({detailPassage.length} libellés)
            </summary>
            <CompteRendu lignes={detailPassage} />
          </details>
        )}
      </div>

      {confirmation && (
        <div className="carte ombre">
          <h2 style={{ margin: 0 }}>
            {confirmation === 'supprimer'
              ? 'Supprimer les mails commerciaux'
              : 'Se désabonner des newsletters'}
          </h2>
          <p className="aide" style={{ margin: '4px 0 10px' }}>
            Décochez ce que Médor doit laisser tranquille, puis confirmez.
            {confirmation === 'supprimer'
              ? ' Les mails partent à la corbeille du compte (récupérables ~30 jours).'
              : ' Un désabonnement en un clic est demandé à chaque expéditeur coché.'}
          </p>
          <div
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              border: '1px solid var(--ligne)',
              borderRadius: 10,
              padding: '2px 14px'
            }}
          >
            {(confirmation === 'supprimer' ? commerciaux : desabonnables).map((s) => (
              <label
                key={s.key}
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
                  checked={coches[s.key] !== false}
                  onChange={(e) => setCoches((c) => ({ ...c, [s.key]: e.target.checked }))}
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
                  {s.name || s.address}{' '}
                  <span className="mono" style={{ color: 'var(--gris)', fontSize: 12 }}>
                    {s.address}
                  </span>
                </span>
                {s.stillMailing && (
                  <span className="badge spam">écrit encore</span>
                )}
                <span className="aide" style={{ whiteSpace: 'nowrap' }}>
                  {s.total.toLocaleString('fr-FR')} mails ·{' '}
                  {s.total > 0 ? Math.round((s.read / s.total) * 100) : 0} % lus
                </span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
            <button className="danger" onClick={executerConfirmation} disabled={occupe}>
              {confirmation === 'supprimer'
                ? `Supprimer ${(confirmation === 'supprimer' ? commerciaux : desabonnables)
                    .filter((s) => coches[s.key] !== false)
                    .reduce((n, s) => n + s.total, 0)
                    .toLocaleString('fr-FR')} mails`
                : `Se désabonner de ${desabonnables.filter((s) => coches[s.key] !== false).length} newsletters`}
            </button>
            <button className="secondaire" onClick={() => setConfirmation(null)}>
              Annuler
            </button>
          </div>
        </div>
      )}

      <p style={{ textAlign: 'center' }}>
        <button className="discret" onClick={inventorier} disabled={chargement || occupe}>
          {chargement ? 'Inventaire…' : 'Actualiser les compteurs (relire les dossiers)'}
        </button>
      </p>

    </div>
  )
}
