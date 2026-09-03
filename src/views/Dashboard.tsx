import { useEffect, useMemo, useRef, useState } from 'react'
import { api, onApplyProgress, onScanProgress } from '../api'
import type {
  ApercuMail,
  AppBootstrap,
  ApplyProgress,
  ApplyResult,
  Plan,
  PlanLabel,
  ScanProgress,
  ScanScope,
  SenderGroup
} from '../types'
import Mascotte from '../Mascotte'

interface Props {
  boot: AppBootstrap
  /** Une opération est en cours quelque part (source : op-etat du backend). */
  occupe: boolean
  accountId: string
  onSelectAccount: (id: string) => void
  onAddAccount: () => void
}

type Onglet = 'libelles' | 'newsletters' | 'spam'

/* Palette officielle Gmail (fonds autorisés par l'API). */
const PALETTE = [
  '#fb4c2f',
  '#ffad47',
  '#fad165',
  '#16a766',
  '#43d692',
  '#4a86e8',
  '#285bac',
  '#a479e2',
  '#f691b3',
  '#e66550',
  '#999999',
  '#2da2bb'
]

const COULEURS_DEFAUT: Record<string, string> = {
  Finances: '#16a766',
  Factures: '#ffad47',
  Shopping: '#e66550',
  Voyages: '#2da2bb',
  Sport: '#43d692',
  Santé: '#f691b3',
  Loisirs: '#a479e2',
  'Réseaux sociaux': '#4a86e8',
  Newsletters: '#fad165',
  Sécurité: '#fb4c2f',
  Administratif: '#285bac',
  Dev: '#999999'
}

function couleurAuto(nom: string): string {
  if (COULEURS_DEFAUT[nom]) return COULEURS_DEFAUT[nom]
  let h = 0
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export default function Dashboard({ boot, occupe, accountId, onSelectAccount, onAddAccount }: Props) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [scan, setScan] = useState<ScanProgress | null>(null)
  const [applique, setApplique] = useState<ApplyProgress | null>(null)
  const [resultat, setResultat] = useState<ApplyResult | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [onglet, setOnglet] = useState<Onglet>('libelles')

  const [libellesCoches, setLibellesCoches] = useState<Record<string, boolean>>({})
  const [expediteursCoches, setExpediteursCoches] = useState<Record<string, boolean>>({})
  const [spamCoches, setSpamCoches] = useState<Record<string, boolean>>({})
  const [portee, setPortee] = useState<ScanScope>('lus')
  const [ecraser, setEcraser] = useState(false)
  const [couleurs, setCouleurs] = useState<Record<string, string>>({})
  const [enBoucle, setEnBoucle] = useState(false)
  const [armeRangeTout, setArmeRangeTout] = useState(false)
  /** Copie modifiable des libellés du plan : renommages et réassociations. */
  const [labelsEdit, setLabelsEdit] = useState<PlanLabel[]>([])
  /** Le plan affiché a déjà été appliqué : on garde newsletters et
   * indésirables accessibles, mais plus de bouton « Appliquer ». */
  const [rangeFait, setRangeFait] = useState(false)
  /** Note informative après une analyse qui n'a rien trouvé de nouveau. */
  const [infoAnalyse, setInfoAnalyse] = useState<string | null>(null)

  const dernierEvenement = useRef(0)
  /** Une opération lancée depuis CETTE fenêtre est en cours : le bandeau ne
   * doit pas être « ramassé » pendant ses phases silencieuses (IA…). */
  const opLocale = useRef(false)

  useEffect(() => {
    // Les événements pilotent le bandeau, même pour les opérations lancées en
    // arrière-plan (rangement automatique, Range tout…).
    const desabos: Promise<() => void>[] = [
      onScanProgress((p) => {
        dernierEvenement.current = Date.now()
        setScan(p)
        setApplique(null)
      }),
      onApplyProgress((p) => {
        dernierEvenement.current = Date.now()
        setApplique(p)
        setScan(null)
      })
    ]
    // Sans événement depuis 6 s, l'opération de fond est finie : on range le bandeau.
    const gc = setInterval(() => {
      if (
        !opLocale.current &&
        dernierEvenement.current > 0 &&
        Date.now() - dernierEvenement.current > 6000
      ) {
        dernierEvenement.current = 0
        setScan(null)
        setApplique(null)
      }
    }, 2000)
    return () => {
      desabos.forEach((d) => d.then((fn) => fn()))
      clearInterval(gc)
    }
  }, [])

  // Changer de compte remet la vue à zéro… puis recharge la dernière analyse
  // connue de ce compte (persistée sur disque) : newsletters, indésirables et
  // plan restent disponibles d'un lancement à l'autre.
  useEffect(() => {
    setPlan(null)
    setResultat(null)
    setErreur(null)
    let annule = false
    api
      .getLastPlan(accountId)
      .then((p) => {
        if (p && !annule) adopterPlan(p)
      })
      .catch(() => {})
    return () => {
      annule = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const compte = boot.accounts.find((a) => a.id === accountId)
  const parCle = useMemo(() => {
    const map = new Map<string, SenderGroup>()
    plan?.senders.forEach((s) => map.set(s.key, s))
    return map
  }, [plan])

  /** Adopte un plan (analyse fraîche ou rechargée du disque) : coches, couleurs, copie éditable. */
  const adopterPlan = (p: Plan) => {
    const libelles: Record<string, boolean> = {}
    for (const l of p.labels) {
      libelles[l.name] = l.name !== 'À trier'
    }
    const spam: Record<string, boolean> = {}
    for (const key of p.spamSuspects) spam[key] = true
    const teintes: Record<string, string> = {}
    for (const l of p.labels) {
      const top = l.name.split('/')[0]
      if (!teintes[top]) teintes[top] = couleurAuto(top)
    }
    setLibellesCoches(libelles)
    setExpediteursCoches({})
    setSpamCoches(spam)
    setCouleurs(teintes)
    setLabelsEdit(p.labels)
    setRangeFait(false)
    setInfoAnalyse(null)
    setPlan(p)
  }

  const lancerAnalyse = async () => {
    setErreur(null)
    setResultat(null)
    opLocale.current = true
    // Le plan précédent reste visible et manipulable pendant la nouvelle analyse.
    setScan({ phase: 'connexion', done: 0, total: 0 })
    try {
      const p = await api.scanAccount(accountId, portee, ecraser)
      if (p.senders.length === 0 && plan && plan.senders.length > 0) {
        // Boîte déjà propre : on garde l'analyse riche (newsletters,
        // indésirables) au lieu de tout remplacer par du vide.
        setInfoAnalyse(
          'Rien de nouveau à ranger : la boîte de réception est déjà propre. La dernière analyse reste affichée ci-dessous.'
        )
      } else {
        adopterPlan(p)
        setOnglet('libelles')
      }
    } catch (e) {
      const msg = String(e)
      if (!msg.includes('annulée')) setErreur(msg)
    } finally {
      opLocale.current = false
      setScan(null)
    }
  }

  const clesSpamActives = useMemo(
    () => new Set(Object.keys(spamCoches).filter((k) => spamCoches[k])),
    [spamCoches]
  )

  /** Recalcule les compteurs et purge les libellés vides. */
  const recalcule = (liste: PlanLabel[]): PlanLabel[] =>
    liste
      .filter((l) => l.senderKeys.length > 0)
      .map((l) => {
        let read = 0
        let total = 0
        for (const k of l.senderKeys) {
          const s = parCle.get(k)
          read += s?.read ?? 0
          total += s?.total ?? 0
        }
        return { ...l, readCount: read, totalCount: total }
      })

  const renommerLabel = (ancien: string, nouveau: string) => {
    const propre = nouveau.trim().replace(/\s*\/\s*/g, '/').replace(/^\/+|\/+$/g, '')
    if (!propre || propre === ancien) return
    setLabelsEdit((prev) => {
      const source = prev.find((l) => l.name === ancien)
      if (!source) return prev
      const cible = prev.find((l) => l.name === propre)
      const next = cible
        ? prev
            .filter((l) => l.name !== ancien)
            .map((l) =>
              l.name === propre ? { ...l, senderKeys: [...l.senderKeys, ...source.senderKeys] } : l
            )
        : prev.map((l) => (l.name === ancien ? { ...l, name: propre } : l))
      return recalcule(next)
    })
    setLibellesCoches((prev) => {
      const n = { ...prev }
      const etait = n[ancien] ?? false
      delete n[ancien]
      n[propre] = (n[propre] ?? false) || etait
      return n
    })
    setCouleurs((c) => {
      const top = propre.split('/')[0]
      return c[top] ? c : { ...c, [top]: couleurAuto(top) }
    })
  }

  const renommerGroupe = (ancienTop: string, nouveauTop: string) => {
    const propre = nouveauTop.trim().replace(/\/+$/g, '')
    if (!propre || propre === ancienTop) return
    const renomme = (nom: string) =>
      nom === ancienTop
        ? propre
        : nom.startsWith(ancienTop + '/')
          ? propre + nom.slice(ancienTop.length)
          : nom
    setLabelsEdit((prev) => {
      const map = new Map<string, PlanLabel>()
      for (const l of prev) {
        const nom = renomme(l.name)
        const exist = map.get(nom)
        if (exist) {
          exist.senderKeys = [...exist.senderKeys, ...l.senderKeys]
        } else {
          map.set(nom, { ...l, name: nom, senderKeys: [...l.senderKeys] })
        }
      }
      return recalcule([...map.values()])
    })
    setLibellesCoches((prev) => {
      const n: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(prev)) {
        const nom = renomme(k)
        n[nom] = (n[nom] ?? false) || v
      }
      return n
    })
    setCouleurs((c) => {
      const n = { ...c }
      if (!n[propre]) n[propre] = c[ancienTop] ?? couleurAuto(propre)
      return n
    })
  }

  const reassigner = (senderKey: string, vers: string) => {
    setLabelsEdit((prev) => {
      const next = prev.map((l) => ({
        ...l,
        senderKeys: l.senderKeys.filter((k) => k !== senderKey)
      }))
      const cible = next.find((l) => l.name === vers)
      if (cible) {
        cible.senderKeys.push(senderKey)
      } else {
        next.push({ name: vers, senderKeys: [senderKey], readCount: 0, totalCount: 0 })
      }
      return recalcule(next)
    })
    setLibellesCoches((prev) => (prev[vers] === undefined ? { ...prev, [vers]: true } : prev))
  }

  const selection = useMemo(() => {
    if (!plan) return { labels: [], junkSenderKeys: [] as string[], labelColors: {} }
    const labels = labelsEdit
      .filter((l) => libellesCoches[l.name])
      .map((l) => ({
        name: l.name,
        senderKeys: l.senderKeys.filter(
          (k) => expediteursCoches[k] !== false && !clesSpamActives.has(k)
        )
      }))
      .filter((l) => l.senderKeys.length > 0)
    const labelColors: Record<string, string> = {}
    for (const l of labels) {
      const top = l.name.split('/')[0]
      if (couleurs[top]) labelColors[top] = couleurs[top]
    }
    return { labels, junkSenderKeys: [...clesSpamActives], labelColors }
  }, [plan, labelsEdit, libellesCoches, expediteursCoches, clesSpamActives, couleurs])

  const totalArchivables = useMemo(() => {
    let n = 0
    for (const l of selection.labels) {
      for (const k of l.senderKeys) n += parCle.get(k)?.total ?? 0
    }
    return n
  }, [selection, parCle])

  const totalSpam = useMemo(() => {
    let n = 0
    for (const k of selection.junkSenderKeys) n += parCle.get(k)?.total ?? 0
    return n
  }, [selection, parCle])

  const rangeTout = async () => {
    setArmeRangeTout(false)
    setErreur(null)
    setResultat(null)
    setEnBoucle(true)
    opLocale.current = true
    setScan({ phase: 'connexion', done: 0, total: 0 })
    setApplique({ done: 0, total: 0, label: '' })
    try {
      // « Range tout » est autonome : toute la boîte, mémoire + libellés existants.
      const res = await api.sortEverything(accountId, 'tous', false)
      setResultat(res)
      setPlan(null)
    } catch (e) {
      const msg = String(e)
      if (!msg.includes('annulée')) setErreur(msg)
    } finally {
      opLocale.current = false
      setEnBoucle(false)
      setScan(null)
      setApplique(null)
    }
  }

  const appliquer = async () => {
    setErreur(null)
    opLocale.current = true
    setApplique({ done: 0, total: totalArchivables + totalSpam, label: '' })
    try {
      const res = await api.applyPlan(accountId, selection)
      setResultat(res)
      // Le plan reste : les onglets Newsletters et Indésirables gardent tout
      // leur intérêt après le rangement (désabonnements, corbeille…).
      setRangeFait(true)
      setOnglet('newsletters')
    } catch (e) {
      const msg = String(e)
      if (!msg.includes('annulée')) setErreur(msg)
    } finally {
      opLocale.current = false
      setApplique(null)
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

      {erreur && <div className="erreur">{erreur}</div>}

      {resultat && (
        <Resultat resultat={resultat} onRelancer={lancerAnalyse} provider={compte?.provider} />
      )}

      {!plan && !resultat && (
        <div className="carte ombre heros" style={{ paddingBottom: 40 }}>
          <Mascotte taille={72} style={{ marginBottom: 14 }} />
          <h1>Prêt à ranger {compte?.email}</h1>
          <p className="sous-titre" style={{ maxWidth: 520, margin: '0 auto 24px' }}>
            Médor lit les en-têtes des mails (jamais leur contenu complet), propose des
            libellés, repère newsletters et indésirables, puis vous montre tout avant d’agir.
          </p>
          <div
            className="choix-cartes trois"
            style={{ maxWidth: 680, margin: '0 auto 24px', textAlign: 'left' }}
          >
            {(
              [
                ['lus', 'Mails déjà lus', 'Le classique : on archive ce qui est lu, les non-lus restent devant vous.'],
                ['nonlus', 'Mails non lus', 'Range le retard : les non-lus filent dans leurs dossiers, toujours marqués non lus.'],
                ['tous', 'Toute la boîte', 'Tri maximal : tout est rangé, lu ou non.']
              ] as const
            ).map(([val, titre, detail]) => (
              <button
                key={val}
                className={`choix-carte ${portee === val ? 'choisi' : ''}`}
                onClick={() => setPortee(val)}
              >
                <span className="titre">{titre}</span>
                <span className="detail">{detail}</span>
              </button>
            ))}
          </div>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              margin: '0 auto 22px',
              cursor: 'pointer',
              color: 'var(--gris)',
              fontSize: 13.5
            }}
          >
            <input type="checkbox" checked={ecraser} onChange={(e) => setEcraser(e.target.checked)} />
            Repartir de zéro : ignorer mes libellés existants, l’IA repense toute l’organisation
          </label>
          <button
            className="principal large"
            onClick={lancerAnalyse}
            disabled={occupe || scan !== null || enBoucle}
          >
            Analyser ma boîte
          </button>

          <div style={{ margin: '30px auto 0', maxWidth: 560, borderTop: '1px solid var(--ligne)', paddingTop: 22 }}>
            <p className="aide" style={{ marginBottom: 12 }}>
              Ou laissez Médor tout faire, sans rien valider :
            </p>
            <button
              className="secondaire large"
              onClick={() => setArmeRangeTout(true)}
              disabled={occupe || scan !== null || enBoucle}
            >
              🦴 Range tout, tout seul
            </button>
            {armeRangeTout && (
              <div className="info" style={{ marginTop: 14, textAlign: 'left' }}>
                Médor va analyser et ranger <strong>toute la boîte de réception</strong>, tranche
                par tranche, jusqu'au bout. Aucun mail n'est supprimé, et chaque étape reste
                annulable depuis le Journal.
                <div style={{ marginTop: 10, display: 'flex', gap: 10 }}>
                  <button className="principal" onClick={rangeTout}>
                    Au travail, Médor
                  </button>
                  <button className="secondaire" onClick={() => setArmeRangeTout(false)}>
                    Annuler
                  </button>
                </div>
              </div>
            )}
          </div>
          {boot.totalArchived > 0 && (
            <p className="precision" style={{ marginTop: 22, textAlign: 'center', color: 'var(--gris)', fontSize: 13 }}>
              🦴 Médor a déjà rangé {boot.totalArchived.toLocaleString('fr-FR')} mails pour vous
            </p>
          )}
        </div>
      )}

      {plan && plan.senders.length === 0 && (
        <div className="carte ombre heros" style={{ paddingBottom: 40 }}>
          <Mascotte taille={72} humeur="joie" style={{ marginBottom: 14 }} />
          <h1>Rien à ranger 🎉</h1>
          <p className="sous-titre" style={{ maxWidth: 520, margin: '0 auto 24px' }}>
            {plan.scope === 'lus' && 'Aucun mail lu à traiter dans la boîte de réception sur la période analysée.'}
            {plan.scope === 'nonlus' && 'Aucun mail non lu à traiter dans la boîte de réception sur la période analysée.'}
            {plan.scope === 'tous' && 'La boîte de réception est vide sur la période analysée.'}{' '}
            Médor n’a rien trouvé à faire — c’est qu’elle est bien rangée.
          </p>
          <p className="aide" style={{ maxWidth: 520, margin: '0 auto 16px' }}>
            Vos newsletters et votre boîte rangée restent accessibles dans les onglets
            « Newsletters » et « Ma boîte » de la barre du haut.
          </p>
          <button className="secondaire" onClick={() => setPlan(null)}>
            Nouvelle analyse (changer la portée)
          </button>
        </div>
      )}

      {plan && plan.senders.length > 0 && (
        <>
          <div className="stats">
            <div className="stat">
              <div className="valeur">{plan.scanned.toLocaleString('fr-FR')}</div>
              <div className="intitule">
                mails analysés · {plan.inboxTotal.toLocaleString('fr-FR')} au total en boîte de
                réception
              </div>
            </div>
            <div className="stat">
              <div className="valeur">{plan.senders.length.toLocaleString('fr-FR')}</div>
              <div className="intitule">expéditeurs distincts</div>
            </div>
            <div className="stat">
              <div className="valeur">{plan.labels.length}</div>
              <div className="intitule">
                libellés proposés{' '}
                <span className={`badge ${plan.generatedBy === 'ia' ? 'ia' : 'heuristique'}`}>
                  {plan.generatedBy === 'ia' ? 'classé par IA' : 'heuristique'}
                </span>
              </div>
            </div>
            <div className="stat">
              <div className="valeur">{plan.newsletters.length}</div>
              <div className="intitule">newsletters repérées</div>
            </div>
          </div>

          {infoAnalyse && <div className="info">{infoAnalyse}</div>}
          {plan.aiNote && <div className="info">{plan.aiNote}</div>}

          <div className="onglets">
            {!rangeFait && (
              <button className={onglet === 'libelles' ? 'actif' : ''} onClick={() => setOnglet('libelles')}>
                Plan de rangement<span className="compteur">{plan.labels.length}</span>
              </button>
            )}
            <button
              className={onglet === 'newsletters' ? 'actif' : ''}
              onClick={() => setOnglet('newsletters')}
            >
              Newsletters<span className="compteur">{plan.newsletters.length}</span>
            </button>
            <button className={onglet === 'spam' ? 'actif' : ''} onClick={() => setOnglet('spam')}>
              Indésirables<span className="compteur">{plan.spamSuspects.length}</span>
            </button>
          </div>

          {onglet === 'libelles' && !rangeFait && (
            <Libelles
              plan={plan}
              labels={labelsEdit}
              parCle={parCle}
              libellesCoches={libellesCoches}
              setLibellesCoches={setLibellesCoches}
              expediteursCoches={expediteursCoches}
              setExpediteursCoches={setExpediteursCoches}
              clesSpamActives={clesSpamActives}
              couleurs={couleurs}
              setCouleurs={setCouleurs}
              renommerLabel={renommerLabel}
              renommerGroupe={renommerGroupe}
              reassigner={reassigner}
            />
          )}
          {onglet === 'newsletters' && (
            <Newsletters
              plan={plan}
              parCle={parCle}
              accountId={accountId}
              occupe={occupe}
              progresser={setApplique}
            />
          )}
          {onglet === 'spam' && (
            <Spam
              plan={plan}
              parCle={parCle}
              accountId={accountId}
              occupe={occupe}
              spamCoches={spamCoches}
              setSpamCoches={setSpamCoches}
              progresser={setApplique}
            />
          )}

          {!rangeFait && (
          <div className="barre-action">
            <div className="resume">
              <strong>{totalArchivables.toLocaleString('fr-FR')}</strong> mails
              {plan.scope === 'lus' ? ' lus' : plan.scope === 'nonlus' ? ' non lus' : ''} seront
              archivés dans <strong>{selection.labels.length}</strong> libellés
              {totalSpam > 0 && (
                <>
                  {' '}
                  · <strong>{totalSpam.toLocaleString('fr-FR')}</strong> mails déplacés vers les
                  indésirables
                </>
              )}
              .{' '}
              {plan.scope === 'lus'
                ? 'Les mails non lus restent dans la boîte de réception.'
                : 'Les non-lus restent marqués non lus, simplement rangés.'}
            </div>
            <button
              className="principal large"
              onClick={appliquer}
              disabled={occupe || totalArchivables + totalSpam === 0 || applique !== null}
            >
              Appliquer le rangement
            </button>
          </div>
          )}
        </>
      )}

    </div>
  )
}

// ------------------------------------------------------------------ Libellés

function Libelles({
  plan,
  labels,
  parCle,
  libellesCoches,
  setLibellesCoches,
  expediteursCoches,
  setExpediteursCoches,
  clesSpamActives,
  couleurs,
  setCouleurs,
  renommerLabel,
  renommerGroupe,
  reassigner
}: {
  plan: Plan
  labels: PlanLabel[]
  parCle: Map<string, SenderGroup>
  libellesCoches: Record<string, boolean>
  setLibellesCoches: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  expediteursCoches: Record<string, boolean>
  setExpediteursCoches: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  clesSpamActives: Set<string>
  couleurs: Record<string, string>
  setCouleurs: React.Dispatch<React.SetStateAction<Record<string, string>>>
  renommerLabel: (ancien: string, nouveau: string) => void
  renommerGroupe: (ancienTop: string, nouveauTop: string) => void
  reassigner: (senderKey: string, vers: string) => void
}) {
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const [groupesOuverts, setGroupesOuverts] = useState<Record<string, boolean>>({})
  const [sousOuverts, setSousOuverts] = useState<Record<string, boolean>>({})
  const [paletteOuverte, setPaletteOuverte] = useState<string | null>(null)
  const [edition, setEdition] = useState<{ cible: string; groupe: boolean; valeur: string } | null>(
    null
  )
  const [recherche, setRecherche] = useState('')
  const [apercu, setApercu] = useState<{ key: string; mails: ApercuMail[] | null } | null>(null)

  const voirApercu = async (key: string) => {
    if (apercu?.key === key) {
      setApercu(null)
      return
    }
    setApercu({ key, mails: null })
    try {
      const mails = await api.getSenderPreview(plan.accountId, key)
      setApercu((prev) => (prev?.key === key ? { key, mails } : prev))
    } catch {
      setApercu(null)
    }
  }

  const nomsLabels = useMemo(() => labels.map((l) => l.name).sort(), [labels])

  const validerEdition = () => {
    if (!edition) return
    if (edition.groupe) renommerGroupe(edition.cible, edition.valeur)
    else renommerLabel(edition.cible, edition.valeur)
    setEdition(null)
  }

  const crayon = (cible: string, groupe: boolean) => (
    <button
      className="crayon"
      title="Renommer"
      onClick={(e) => {
        e.stopPropagation()
        setEdition({ cible, groupe, valeur: cible })
      }}
    >
      ✏️
    </button>
  )

  const champEdition = () =>
    edition && (
      <input
        className="edition-nom"
        autoFocus
        value={edition.valeur}
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => setEdition({ ...edition, valeur: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter') validerEdition()
          if (e.key === 'Escape') setEdition(null)
        }}
        onBlur={validerEdition}
      />
    )

  const existants = useMemo(
    () => new Set(plan.existingLabels.map((n) => n.toLowerCase())),
    [plan]
  )
  const dejaLa = (nom: string) => existants.has(nom.toLowerCase())
  const badgeEtat = (nom: string) =>
    dejaLa(nom) ? (
      <span className="badge existant">déjà en place</span>
    ) : (
      <span className="badge nouveau">sera créé</span>
    )

  const pastille = (top: string) => (
    <span
      className="pastille-couleur"
      title="Choisir la couleur du libellé"
      style={{ background: couleurs[top] ?? '#c2c2c2' }}
      onClick={(e) => {
        e.stopPropagation()
        setPaletteOuverte(paletteOuverte === top ? null : top)
      }}
    />
  )

  const paletteRow = (top: string) => (
    <div className="palette" onClick={(e) => e.stopPropagation()}>
      {PALETTE.map((bg) => (
        <button
          key={bg}
          className={`palette-dot ${couleurs[top] === bg ? 'choisi' : ''}`}
          style={{ background: bg }}
          aria-label={`Couleur ${bg}`}
          onClick={() => {
            setCouleurs((c) => ({ ...c, [top]: bg }))
            setPaletteOuverte(null)
          }}
        />
      ))}
    </div>
  )

  // Regroupe les libellés par premier niveau : « Newsletters/Apple » et
  // « Newsletters/Deezer » s'affichent comme sous-dossiers de « Newsletters ».
  const groupes = useMemo(() => {
    const ordre: string[] = []
    const map = new Map<string, PlanLabel[]>()
    for (const l of labels) {
      const racine = l.name.split('/')[0]
      if (!map.has(racine)) {
        map.set(racine, [])
        ordre.push(racine)
      }
      map.get(racine)!.push(l)
    }
    return ordre.map((racine) => ({ racine, items: map.get(racine)! }))
  }, [labels])

  // Recherche : filtre libellés et expéditeurs.
  const groupesAffiches = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    if (q === '') return groupes
    const senderMatch = (k: string) => {
      const s = parCle.get(k)
      return (
        s !== undefined &&
        (s.address.toLowerCase().includes(q) || s.name.toLowerCase().includes(q))
      )
    }
    return groupes
      .map(({ racine, items }) => ({
        racine,
        items: items
          .map((l) =>
            l.name.toLowerCase().includes(q)
              ? l
              : { ...l, senderKeys: l.senderKeys.filter(senderMatch) }
          )
          .filter((l) => l.name.toLowerCase().includes(q) || l.senderKeys.length > 0)
      }))
      .filter((g) => g.items.length > 0)
  }, [groupes, recherche, parCle])

  const rangee = (l: PlanLabel, nomAffiche: string, topCouleur?: string) => {
    const ouvert = ouverts[l.name] ?? false
    return (
      <div className={`rangee-libelle ${dejaLa(l.name) ? 'etat-existant' : 'etat-nouveau'}`} key={l.name}>
        <div className="tete" onClick={() => setOuverts((o) => ({ ...o, [l.name]: !ouvert }))}>
          <input
            type="checkbox"
            checked={libellesCoches[l.name] ?? false}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => setLibellesCoches((prev) => ({ ...prev, [l.name]: e.target.checked }))}
          />
          {topCouleur && pastille(topCouleur)}
          {edition && !edition.groupe && edition.cible === l.name ? (
            champEdition()
          ) : (
            <span className="nom-libelle">{nomAffiche}</span>
          )}
          {crayon(l.name, false)}
          {badgeEtat(l.name)}
          <span className="compte-mails">
            {l.totalCount.toLocaleString('fr-FR')} mails · {l.senderKeys.length} expéditeurs{' '}
            {ouvert ? '▾' : '▸'}
          </span>
        </div>
        {topCouleur && paletteOuverte === topCouleur && paletteRow(topCouleur)}
        {ouvert && (
          <div className="expediteurs">
            {l.senderKeys.map((k) => {
              const s = parCle.get(k)
              if (!s) return null
              const enSpam = clesSpamActives.has(k)
              return (
                <div key={k}>
                <div className="rangee-expediteur">
                  <input
                    type="checkbox"
                    disabled={enSpam}
                    checked={!enSpam && expediteursCoches[k] !== false}
                    onChange={(e) =>
                      setExpediteursCoches((prev) => ({ ...prev, [k]: e.target.checked }))
                    }
                  />
                  <span>{s.name || s.address}</span>
                  <span className="adresse">{s.address}</span>
                  {s.isNewsletter && <span className="badge newsletter">newsletter</span>}
                  {enSpam && <span className="badge spam">→ indésirables</span>}
                  <select
                    className="mini-select"
                    title="Déplacer vers un autre libellé"
                    value={l.name}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => reassigner(k, e.target.value)}
                  >
                    {nomsLabels.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                  <button
                    className="discret"
                    title="Voir les mails de cet expéditeur"
                    style={{ padding: '2px 6px' }}
                    onClick={(e) => {
                      e.stopPropagation()
                      voirApercu(k)
                    }}
                  >
                    👁
                  </button>
                  <span className="nombres">{s.total} mails</span>
                </div>
                {apercu?.key === k && (
                  <div className="apercu-liste">
                    {apercu.mails === null && <span className="aide">Chargement…</span>}
                    {apercu.mails?.map((m, i) => (
                      <div className="apercu-mail" key={i}>
                        <span className="mono" style={{ color: 'var(--gris)', flex: 'none' }}>
                          {m.date}
                        </span>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: m.seen ? 400 : 600
                          }}
                        >
                          {m.subject || '(sans objet)'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <input
        type="text"
        className="champ-recherche"
        placeholder="🔍 Rechercher un libellé, un expéditeur, une adresse…"
        value={recherche}
        onChange={(e) => setRecherche(e.target.value)}
      />
      <p className="aide" style={{ marginBottom: 14 }}>
        Décochez un libellé (ou un expéditeur) pour ne pas y toucher.{' '}
        {plan.scope === 'lus' && (
          <>
            Seuls les mails <strong>déjà lus</strong> sont concernés.
          </>
        )}
        {plan.scope === 'nonlus' && (
          <>
            Seuls les mails <strong>non lus</strong> sont concernés — ils resteront marqués non
            lus.
          </>
        )}
        {plan.scope === 'tous' && <>Tous les mails analysés sont concernés, lus comme non lus.</>}{' '}
        La pastille ronde choisit la <strong>couleur</strong> du libellé (appliquée sur Gmail au
        moment du rangement). ✏️ renomme un libellé ou un groupe (Entrée pour valider — même nom
        qu’un autre = fusion) ; le menu déroulant d’un expéditeur le déplace vers un autre
        libellé.
        <br />
        <span className="badge nouveau">sera créé</span> nouveau libellé ·{' '}
        <span className="badge existant">déjà en place</span> libellé existant, simplement
        complété — jamais renommé ni vidé.
      </p>
      {groupesAffiches.map(({ racine, items }) => {
        if (items.length === 1 && items[0].name === racine) {
          return rangee(items[0], racine, racine)
        }
        const tousCoches = items.every((l) => libellesCoches[l.name])
        const total = items.reduce((n, l) => n + l.totalCount, 0)
        const groupeOuvert = groupesOuverts[racine] ?? false
        return (
          <div
            className={`groupe-libelles ${dejaLa(racine) ? 'etat-existant' : 'etat-nouveau'}`}
            key={racine}
          >
            <div
              className="groupe-tete"
              onClick={() => setGroupesOuverts((o) => ({ ...o, [racine]: !groupeOuvert }))}
            >
              <input
                type="checkbox"
                checked={tousCoches}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) =>
                  setLibellesCoches((prev) => {
                    const suivant = { ...prev }
                    items.forEach((l) => {
                      suivant[l.name] = e.target.checked
                    })
                    return suivant
                  })
                }
              />
              {pastille(racine)}
              {edition && edition.groupe && edition.cible === racine ? (
                champEdition()
              ) : (
                <span className="nom-libelle">
                  {groupeOuvert ? '📂' : '📁'} {racine}
                </span>
              )}
              {crayon(racine, true)}
              {badgeEtat(racine)}
              <span className="compte-mails">
                {total.toLocaleString('fr-FR')} mails · {items.length} sous-dossiers{plan?.scannedAt ? ` · analyse du ${new Date(plan.scannedAt * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}{' '}
                {groupeOuvert ? '▾' : '▸'}
              </span>
            </div>
            {paletteOuverte === racine && paletteRow(racine)}
            {groupeOuvert && (
              <div className="groupe-enfants">
                {(() => {
                  // Sous-groupes par 2e niveau : Sport → Running → Strava…
                  const ordre: string[] = []
                  const map = new Map<string, PlanLabel[]>()
                  for (const l of items) {
                    const segs = l.name.split('/')
                    const sous = segs.length >= 2 ? segs[1] : ''
                    if (!map.has(sous)) {
                      map.set(sous, [])
                      ordre.push(sous)
                    }
                    map.get(sous)!.push(l)
                  }
                  return ordre.map((sous) => {
                    const sitems = map.get(sous)!
                    if (sous === '') {
                      return sitems.map((l) => rangee(l, `${racine} (directement)`))
                    }
                    if (sitems.length === 1 && sitems[0].name === `${racine}/${sous}`) {
                      return rangee(sitems[0], sous)
                    }
                    const cle = `${racine}/${sous}`
                    const ouvert2 = sousOuverts[cle] ?? false
                    const coches2 = sitems.every((l) => libellesCoches[l.name])
                    const total2 = sitems.reduce((n, l) => n + l.totalCount, 0)
                    return (
                      <div className="groupe-libelles niveau2" key={cle}>
                        <div
                          className="groupe-tete"
                          onClick={() => setSousOuverts((o) => ({ ...o, [cle]: !ouvert2 }))}
                        >
                          <input
                            type="checkbox"
                            checked={coches2}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) =>
                              setLibellesCoches((prev) => {
                                const suivant = { ...prev }
                                sitems.forEach((l) => {
                                  suivant[l.name] = e.target.checked
                                })
                                return suivant
                              })
                            }
                          />
                          <span className="nom-libelle">
                            {ouvert2 ? '📂' : '📁'} {sous}
                          </span>
                          {crayon(cle, true)}
                          <span className="compte-mails">
                            {total2.toLocaleString('fr-FR')} mails · {sitems.length} dossiers{' '}
                            {ouvert2 ? '▾' : '▸'}
                          </span>
                        </div>
                        {edition && edition.groupe && edition.cible === cle && (
                          <div style={{ padding: '0 16px 10px' }}>{champEdition()}</div>
                        )}
                        {ouvert2 && (
                          <div className="groupe-enfants">
                            {sitems.map((l) =>
                              rangee(
                                l,
                                l.name === cle
                                  ? `${sous} (directement)`
                                  : l.name.split('/').slice(2).join('/')
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })
                })()}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- Newsletters

export function Newsletters({
  plan,
  parCle,
  accountId,
  occupe,
  progresser
}: {
  plan: Plan
  parCle: Map<string, SenderGroup>
  accountId: string
  occupe: boolean
  progresser: React.Dispatch<React.SetStateAction<ApplyProgress | null>>
}) {
  const [statuts, setStatuts] = useState<Record<string, string>>({})
  const [occupes, setOccupes] = useState<Record<string, boolean>>({})
  const [armeSuppr, setArmeSuppr] = useState<string | null>(null)
  const [armeMasse, setArmeMasse] = useState<'corbeille' | 'desabo' | null>(null)
  const [masseEnCours, setMasseEnCours] = useState<'corbeille' | 'desabo' | null>(null)
  const [rechercheNl, setRechercheNl] = useState('')
  const [tri, setTri] = useState<'volume' | 'lecture' | 'date' | 'nom'>('volume')

  const supprimer = async (s: SenderGroup) => {
    setOccupes((o) => ({ ...o, [s.key]: true }))
    setArmeSuppr(null)
    progresser({ done: 0, total: s.total, label: 'Corbeille' })
    try {
      const n = await api.trashSenders(accountId, [s.key])
      setStatuts((st) => ({ ...st, [s.key]: `🗑️ ${n} mails à la corbeille` }))
    } catch (e) {
      setStatuts((st) => ({ ...st, [s.key]: String(e) }))
    } finally {
      progresser(null)
      setOccupes((o) => ({ ...o, [s.key]: false }))
    }
  }

  const lignes = plan.newsletters
    .map((k) => parCle.get(k))
    .filter((s): s is SenderGroup => Boolean(s))
    .filter((s) => {
      const q = rechercheNl.trim().toLowerCase()
      return (
        q === '' || s.address.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)
      )
    })
    .sort((a, b) => {
      // Ceux qui écrivent encore malgré un désabonnement passent devant.
      if (a.stillMailing !== b.stillMailing) return a.stillMailing ? -1 : 1
      switch (tri) {
        case 'lecture':
          return b.read / Math.max(1, b.total) - a.read / Math.max(1, a.total)
        case 'date':
          return b.lastTs - a.lastTs
        case 'nom':
          return (a.name || a.address).localeCompare(b.name || b.address, 'fr')
        default:
          return b.total - a.total
      }
    })

  if (lignes.length === 0 && rechercheNl.trim() === '') {
    return <div className="info">Aucune newsletter repérée dans la période analysée.</div>
  }

  const desabonner = async (s: SenderGroup) => {
    setOccupes((o) => ({ ...o, [s.key]: true }))
    try {
      const res = await api.unsubscribeOneClick(accountId, s.key)
      if (res.ok) {
        setStatuts((st) => ({ ...st, [s.key]: '✓ Désabonnement demandé' }))
      } else if (res.method === 'lien') {
        await api.openUrl(res.detail)
        setStatuts((st) => ({ ...st, [s.key]: 'Lien ouvert dans le navigateur' }))
      } else {
        setStatuts((st) => ({ ...st, [s.key]: res.detail }))
      }
    } catch (e) {
      setStatuts((st) => ({ ...st, [s.key]: String(e) }))
    } finally {
      setOccupes((o) => ({ ...o, [s.key]: false }))
    }
  }

  // Seuls les expéditeurs déjà passés à la corbeille sortent du pot : un
  // désabonnement ne supprime aucun mail, il ne change donc pas ce total.
  const restantes = lignes.filter((s) => !(statuts[s.key] ?? '').startsWith('🗑️'))
  const desabonnables = restantes.filter(
    (s) => s.unsubscribeHttp && !statuts[s.key] && (s.unsubscribedAt == null || s.stillMailing)
  )
  const totalMailsRestants = restantes.reduce((n, s) => n + s.total, 0)

  const desabonnerTout = async () => {
    setArmeMasse(null)
    setMasseEnCours('desabo')
    try {
      const res = await api.unsubscribeMany(
        accountId,
        desabonnables.map((s) => s.key)
      )
      setStatuts((st) => {
        const suivant = { ...st }
        for (const [key, statut] of Object.entries(res)) {
          suivant[key] =
            statut === 'ok'
              ? '✓ Désabonnement demandé'
              : statut === 'lien'
                ? 'Lien à ouvrir manuellement'
                : statut
        }
        return suivant
      })
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) alert(m)
    } finally {
      setMasseEnCours(null)
    }
  }

  const supprimerTout = async () => {
    setArmeMasse(null)
    setMasseEnCours('corbeille')
    progresser({ done: 0, total: totalMailsRestants, label: 'Corbeille' })
    try {
      const n = await api.trashSenders(
        accountId,
        restantes.map((s) => s.key)
      )
      setStatuts((st) => {
        const suivant = { ...st }
        restantes.forEach((s) => {
          suivant[s.key] = '🗑️ à la corbeille'
        })
        return suivant
      })
      void n
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) alert(m)
    } finally {
      setMasseEnCours(null)
      progresser(null)
    }
  }

  return (
    <div>
      <input
        type="text"
        className="champ-recherche"
        placeholder="🔍 Rechercher une newsletter…"
        value={rechercheNl}
        onChange={(e) => setRechercheNl(e.target.value)}
      />
      <p className="aide" style={{ marginBottom: 14 }}>
        « Se désabonner » utilise le désabonnement en un clic quand l’expéditeur le permet, sinon
        ouvre sa page de désabonnement. Cliquez sur un en-tête de colonne pour trier.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14 }}>
        {armeMasse === null ? (
          <>
            <button
              className="danger"
              disabled={desabonnables.length === 0 || masseEnCours !== null || occupe}
              onClick={() => setArmeMasse('desabo')}
            >
              {masseEnCours === 'desabo'
                ? 'Désabonnements en cours…'
                : `Se désabonner de tout (${desabonnables.length})`}
            </button>
            <button
              className="secondaire"
              disabled={restantes.length === 0 || masseEnCours !== null || occupe}
              onClick={() => setArmeMasse('corbeille')}
            >
              {masseEnCours === 'corbeille'
                ? 'Mise à la corbeille en cours…'
                : `🗑️ Tout mettre à la corbeille (${totalMailsRestants.toLocaleString('fr-FR')} mails)`}
            </button>
          </>
        ) : (
          <div className="erreur" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>
              {armeMasse === 'desabo'
                ? `Demander le désabonnement aux ${desabonnables.length} newsletters ?`
                : `Mettre ${totalMailsRestants.toLocaleString('fr-FR')} mails de ${restantes.length} newsletters à la corbeille ?`}
            </span>
            <button
              className="danger"
              onClick={armeMasse === 'desabo' ? desabonnerTout : supprimerTout}
            >
              Oui
            </button>
            <button className="secondaire" onClick={() => setArmeMasse(null)}>
              Annuler
            </button>
          </div>
        )}
      </div>
      <table className="liste">
        <thead>
          <tr>
            <th className="triable" onClick={() => setTri('nom')}>
              Expéditeur{tri === 'nom' ? ' ▾' : ''}
            </th>
            <th className="triable" onClick={() => setTri('volume')}>
              Volume{tri === 'volume' ? ' ▾' : ''}
            </th>
            <th className="triable" onClick={() => setTri('lecture')}>
              Lecture{tri === 'lecture' ? ' ▾' : ''}
            </th>
            <th className="triable" onClick={() => setTri('date')}>
              Dernier mail{tri === 'date' ? ' ▾' : ''}
            </th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((s) => {
            const tauxLecture = s.total > 0 ? Math.round((s.read / s.total) * 100) : 0
            const peut = Boolean(s.unsubscribeHttp || s.unsubscribeMailto)
            return (
              <tr key={s.key}>
                <td>
                  <div>
                    {s.name || s.address}{' '}
                    {s.stillMailing && (
                      <span className="badge spam">⚠️ écrit encore malgré le désabonnement</span>
                    )}
                    {!s.stillMailing && s.unsubscribedAt != null && (
                      <span className="badge existant">✓ désabonné</span>
                    )}
                  </div>
                  <div className="mono" style={{ color: 'var(--gris)' }}>
                    {s.address}
                  </div>
                </td>
                <td className="mono">{s.total}</td>
                <td className="mono">{tauxLecture}&nbsp;% lus</td>
                <td className="mono">{s.lastDate || '—'}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {statuts[s.key] ? (
                    <span className="aide">{statuts[s.key]}</span>
                  ) : armeSuppr === s.key ? (
                    <>
                      <span className="aide">Mettre les {s.total} mails à la corbeille ?</span>{' '}
                      <button className="danger" disabled={occupe || occupes[s.key]} onClick={() => supprimer(s)}>
                        Oui
                      </button>{' '}
                      <button className="secondaire" onClick={() => setArmeSuppr(null)}>
                        Non
                      </button>
                    </>
                  ) : (
                    <>
                      {peut &&
                        (s.unsubscribeHttp ? (
                          <button
                            className="danger"
                            disabled={occupe || occupes[s.key]}
                            onClick={() => desabonner(s)}
                          >
                            {occupes[s.key] ? '…' : 'Se désabonner'}
                          </button>
                        ) : (
                          <button
                            className="secondaire"
                            onClick={() => api.openUrl(s.unsubscribeMailto!)}
                          >
                            Par e-mail
                          </button>
                        ))}{' '}
                      <button
                        className="secondaire"
                        title={`Mettre les ${s.total} mails de cet expéditeur à la corbeille`}
                        disabled={occupe || occupes[s.key]}
                        onClick={() => setArmeSuppr(s.key)}
                      >
                        🗑️
                      </button>
                    </>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// -------------------------------------------------------------------- Spam

function Spam({
  plan,
  parCle,
  accountId,
  occupe,
  spamCoches,
  setSpamCoches,
  progresser
}: {
  plan: Plan
  parCle: Map<string, SenderGroup>
  accountId: string
  occupe: boolean
  spamCoches: Record<string, boolean>
  setSpamCoches: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  progresser: React.Dispatch<React.SetStateAction<ApplyProgress | null>>
}) {
  const [statuts, setStatuts] = useState<Record<string, string>>({})
  const [armeSuppr, setArmeSuppr] = useState<string | null>(null)

  const supprimer = async (s: SenderGroup) => {
    setArmeSuppr(null)
    progresser({ done: 0, total: s.total, label: 'Corbeille' })
    try {
      const n = await api.trashSenders(accountId, [s.key])
      setStatuts((st) => ({ ...st, [s.key]: `🗑️ ${n} à la corbeille` }))
      setSpamCoches((prev) => ({ ...prev, [s.key]: false }))
    } catch (e) {
      setStatuts((st) => ({ ...st, [s.key]: String(e) }))
    } finally {
      progresser(null)
    }
  }

  const lignes = plan.spamSuspects
    .map((k) => parCle.get(k))
    .filter((s): s is SenderGroup => Boolean(s))
    .sort((a, b) => b.total - a.total)

  if (lignes.length === 0) {
    return (
      <div className="succes">
        {plan.scope === 'lus'
          ? 'Une analyse « mails déjà lus » ne peut pas repérer les expéditeurs jamais lus — relancez en « non lus » ou « toute la boîte » pour la chasse aux indésirables.'
          : 'Rien de suspect dans la boîte de réception. (Le dossier spam de votre compte n’est pas analysé : ce qui y est déjà a été filtré par votre fournisseur.)'}
      </div>
    )
  }

  return (
    <div>
      <p className="aide" style={{ marginBottom: 14 }}>
        Ces expéditeurs vous écrivent souvent sans jamais être lus. Cochés, tous leurs mails
        partiront dans le dossier indésirables lors du rangement.
      </p>
      <table className="liste">
        <thead>
          <tr>
            <th></th>
            <th>Expéditeur</th>
            <th>Mails</th>
            <th>Jamais lus</th>
            <th>Exemple de sujet</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {lignes.map((s) => (
            <tr key={s.key}>
              <td>
                <input
                  type="checkbox"
                  checked={spamCoches[s.key] ?? false}
                  onChange={(e) => setSpamCoches((prev) => ({ ...prev, [s.key]: e.target.checked }))}
                />
              </td>
              <td>
                <div>{s.name || s.address}</div>
                <div className="mono" style={{ color: 'var(--gris)' }}>
                  {s.address}
                </div>
              </td>
              <td className="mono">{s.total}</td>
              <td className="mono">{s.unread}</td>
              <td className="aide" style={{ maxWidth: 280 }}>
                {s.sampleSubjects[0] ?? ''}
              </td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                {statuts[s.key] ? (
                  <span className="aide">{statuts[s.key]}</span>
                ) : armeSuppr === s.key ? (
                  <>
                    <button className="danger" disabled={occupe} onClick={() => supprimer(s)}>
                      Oui, corbeille
                    </button>{' '}
                    <button className="secondaire" onClick={() => setArmeSuppr(null)}>
                      Non
                    </button>
                  </>
                ) : (
                  <button
                    className="secondaire"
                    title={`Mettre les ${s.total} mails à la corbeille`}
                    onClick={() => setArmeSuppr(s.key)}
                  >
                    🗑️
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------ Résultat

const URL_BOITES: Record<string, string> = {
  gmail: 'https://mail.google.com',
  outlook: 'https://outlook.live.com/mail',
  icloud: 'https://www.icloud.com/mail'
}

function Resultat({
  resultat,
  onRelancer,
  provider
}: {
  resultat: ApplyResult
  onRelancer: () => void
  provider?: string
}) {
  return (
    <div className="carte ombre" style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <Mascotte taille={56} humeur="joie" />
        <h1 style={{ margin: 0 }}>Boîte rangée ✓</h1>
      </div>
      <p className="sous-titre" style={{ marginBottom: 14 }}>
        <strong>{resultat.archived.toLocaleString('fr-FR')}</strong> mails archivés,{' '}
        <strong>{resultat.labelsCreated}</strong> libellés créés
        {resultat.junked > 0 && (
          <>
            , <strong>{resultat.junked.toLocaleString('fr-FR')}</strong> mails déplacés vers les
            indésirables
          </>
        )}
        . Vos mails non lus vous attendent dans la boîte de réception.
      </p>
      {resultat.errors.length > 0 && (
        <div className="erreur">
          Quelques opérations ont échoué :
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {resultat.errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {provider && URL_BOITES[provider] && (
          <button className="principal" onClick={() => api.openUrl(URL_BOITES[provider])}>
            Voir le résultat dans ma boîte
          </button>
        )}
        <button className="secondaire" onClick={onRelancer}>
          Relancer une analyse
        </button>
      </div>
    </div>
  )
}
