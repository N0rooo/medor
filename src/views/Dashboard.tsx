import { useEffect, useMemo, useState } from 'react'
import { api, onApplyProgress, onScanProgress } from '../api'
import type {
  AppBootstrap,
  ApplyProgress,
  ApplyResult,
  Plan,
  PlanLabel,
  ScanProgress,
  ScanScope,
  SenderGroup
} from '../types'

interface Props {
  boot: AppBootstrap
  accountId: string
  onSelectAccount: (id: string) => void
  onAddAccount: () => void
  onEditOnboarding: () => void
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
  'Banque & finance': '#16a766',
  'Factures & reçus': '#ffad47',
  'Shopping & livraisons': '#e66550',
  'Voyages & réservations': '#2da2bb',
  'Réseaux sociaux': '#4a86e8',
  Newsletters: '#fad165',
  'Sécurité & comptes': '#fb4c2f',
  Administratif: '#285bac',
  Travail: '#a479e2',
  'Dev & outils': '#999999',
  Notifications: '#43d692'
}

function couleurAuto(nom: string): string {
  if (COULEURS_DEFAUT[nom]) return COULEURS_DEFAUT[nom]
  let h = 0
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export default function Dashboard({
  boot,
  accountId,
  onSelectAccount,
  onAddAccount,
  onEditOnboarding
}: Props) {
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
  const [couleurs, setCouleurs] = useState<Record<string, string>>({})

  useEffect(() => {
    const desabos: Promise<() => void>[] = [
      onScanProgress((p) => setScan((prev) => (prev === null ? prev : p))),
      onApplyProgress((p) => setApplique((prev) => (prev === null ? prev : p)))
    ]
    return () => {
      desabos.forEach((d) => d.then((fn) => fn()))
    }
  }, [])

  // Changer de compte remet la vue à zéro.
  useEffect(() => {
    setPlan(null)
    setResultat(null)
    setErreur(null)
  }, [accountId])

  const compte = boot.accounts.find((a) => a.id === accountId)
  const parCle = useMemo(() => {
    const map = new Map<string, SenderGroup>()
    plan?.senders.forEach((s) => map.set(s.key, s))
    return map
  }, [plan])

  const lancerAnalyse = async () => {
    setErreur(null)
    setResultat(null)
    setPlan(null)
    setScan({ phase: 'connexion', done: 0, total: 0 })
    try {
      const p = await api.scanAccount(accountId, portee)
      const libelles: Record<string, boolean> = {}
      for (const l of p.labels) {
        const estNewsletters = l.name === 'Newsletters'
        const archiveNews = boot.onboarding?.archiveReadNewsletters ?? true
        libelles[l.name] = l.name !== 'À trier' && (!estNewsletters || archiveNews)
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
      setPlan(p)
      setOnglet('libelles')
    } catch (e) {
      setErreur(String(e))
    } finally {
      setScan(null)
    }
  }

  const clesSpamActives = useMemo(
    () => new Set(Object.keys(spamCoches).filter((k) => spamCoches[k])),
    [spamCoches]
  )

  const selection = useMemo(() => {
    if (!plan) return { labels: [], junkSenderKeys: [] as string[], labelColors: {} }
    const labels = plan.labels
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
  }, [plan, libellesCoches, expediteursCoches, clesSpamActives, couleurs])

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

  const appliquer = async () => {
    setErreur(null)
    setApplique({ done: 0, total: totalArchivables + totalSpam, label: '' })
    try {
      const res = await api.applyPlan(accountId, selection)
      setResultat(res)
      setPlan(null)
    } catch (e) {
      setErreur(String(e))
    } finally {
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
        <button className="discret" style={{ marginLeft: 'auto' }} onClick={onEditOnboarding}>
          ⚙︎ Préférences de tri
        </button>
      </div>

      {erreur && <div className="erreur">{erreur}</div>}

      {resultat && <Resultat resultat={resultat} onRelancer={lancerAnalyse} />}

      {!plan && !resultat && (
        <div className="carte ombre heros" style={{ paddingBottom: 40 }}>
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
          <button className="principal large" onClick={lancerAnalyse} disabled={scan !== null}>
            Analyser ma boîte
          </button>
        </div>
      )}

      {plan && plan.senders.length === 0 && (
        <div className="carte ombre heros" style={{ paddingBottom: 40 }}>
          <h1>Rien à ranger 🎉</h1>
          <p className="sous-titre" style={{ maxWidth: 520, margin: '0 auto 24px' }}>
            {plan.scope === 'lus' && 'Aucun mail lu à traiter dans la boîte de réception sur la période analysée.'}
            {plan.scope === 'nonlus' && 'Aucun mail non lu à traiter dans la boîte de réception sur la période analysée.'}
            {plan.scope === 'tous' && 'La boîte de réception est vide sur la période analysée.'}{' '}
            Médor n’a rien trouvé à faire — c’est qu’elle est bien rangée.
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
              <div className="intitule">mails analysés</div>
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

          {plan.aiNote && <div className="info">{plan.aiNote}</div>}

          <div className="onglets">
            <button className={onglet === 'libelles' ? 'actif' : ''} onClick={() => setOnglet('libelles')}>
              Plan de rangement<span className="compteur">{plan.labels.length}</span>
            </button>
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

          {onglet === 'libelles' && (
            <Libelles
              plan={plan}
              parCle={parCle}
              libellesCoches={libellesCoches}
              setLibellesCoches={setLibellesCoches}
              expediteursCoches={expediteursCoches}
              setExpediteursCoches={setExpediteursCoches}
              clesSpamActives={clesSpamActives}
              couleurs={couleurs}
              setCouleurs={setCouleurs}
            />
          )}
          {onglet === 'newsletters' && (
            <Newsletters plan={plan} parCle={parCle} accountId={accountId} />
          )}
          {onglet === 'spam' && (
            <Spam plan={plan} parCle={parCle} spamCoches={spamCoches} setSpamCoches={setSpamCoches} />
          )}

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
              disabled={totalArchivables + totalSpam === 0 || applique !== null}
            >
              Appliquer le rangement
            </button>
          </div>
        </>
      )}

      {scan && <VoileProgression scan={scan} />}
      {applique && <VoileApplication p={applique} />}
    </div>
  )
}

// ------------------------------------------------------------------ Libellés

function Libelles({
  plan,
  parCle,
  libellesCoches,
  setLibellesCoches,
  expediteursCoches,
  setExpediteursCoches,
  clesSpamActives,
  couleurs,
  setCouleurs
}: {
  plan: Plan
  parCle: Map<string, SenderGroup>
  libellesCoches: Record<string, boolean>
  setLibellesCoches: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  expediteursCoches: Record<string, boolean>
  setExpediteursCoches: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
  clesSpamActives: Set<string>
  couleurs: Record<string, string>
  setCouleurs: React.Dispatch<React.SetStateAction<Record<string, string>>>
}) {
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const [groupesOuverts, setGroupesOuverts] = useState<Record<string, boolean>>({})
  const [paletteOuverte, setPaletteOuverte] = useState<string | null>(null)

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
    for (const l of plan.labels) {
      const racine = l.name.split('/')[0]
      if (!map.has(racine)) {
        map.set(racine, [])
        ordre.push(racine)
      }
      map.get(racine)!.push(l)
    }
    return ordre.map((racine) => ({ racine, items: map.get(racine)! }))
  }, [plan])

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
          <span className="nom-libelle">{nomAffiche}</span>
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
                <div className="rangee-expediteur" key={k}>
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
                  <span className="nombres">{s.total} mails</span>
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
        moment du rangement).
        <br />
        <span className="badge nouveau">sera créé</span> nouveau libellé ·{' '}
        <span className="badge existant">déjà en place</span> libellé existant, simplement
        complété — jamais renommé ni vidé.
      </p>
      {groupes.map(({ racine, items }) => {
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
              <span className="nom-libelle">
                {groupeOuvert ? '📂' : '📁'} {racine}
              </span>
              {badgeEtat(racine)}
              <span className="compte-mails">
                {total.toLocaleString('fr-FR')} mails · {items.length} sous-dossiers{' '}
                {groupeOuvert ? '▾' : '▸'}
              </span>
            </div>
            {paletteOuverte === racine && paletteRow(racine)}
            {groupeOuvert && (
              <div className="groupe-enfants">
                {items.map((l) =>
                  rangee(l, l.name === racine ? `${racine} (directement)` : l.name.split('/').slice(1).join('/'))
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------- Newsletters

function Newsletters({
  plan,
  parCle,
  accountId
}: {
  plan: Plan
  parCle: Map<string, SenderGroup>
  accountId: string
}) {
  const [statuts, setStatuts] = useState<Record<string, string>>({})
  const [occupes, setOccupes] = useState<Record<string, boolean>>({})

  const lignes = plan.newsletters
    .map((k) => parCle.get(k))
    .filter((s): s is SenderGroup => Boolean(s))
    .sort((a, b) => b.total - a.total)

  if (lignes.length === 0) {
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

  return (
    <div>
      <p className="aide" style={{ marginBottom: 14 }}>
        « Se désabonner » utilise le désabonnement en un clic quand l’expéditeur le permet, sinon
        ouvre sa page de désabonnement.
      </p>
      <table className="liste">
        <thead>
          <tr>
            <th>Expéditeur</th>
            <th>Volume</th>
            <th>Lecture</th>
            <th>Dernier mail</th>
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
                  <div>{s.name || s.address}</div>
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
                  ) : peut ? (
                    <>
                      {s.unsubscribeHttp ? (
                        <button
                          className="danger"
                          disabled={occupes[s.key]}
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
                      )}
                    </>
                  ) : (
                    <span className="aide">—</span>
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
  spamCoches,
  setSpamCoches
}: {
  plan: Plan
  parCle: Map<string, SenderGroup>
  spamCoches: Record<string, boolean>
  setSpamCoches: React.Dispatch<React.SetStateAction<Record<string, boolean>>>
}) {
  const lignes = plan.spamSuspects
    .map((k) => parCle.get(k))
    .filter((s): s is SenderGroup => Boolean(s))
    .sort((a, b) => b.total - a.total)

  if (lignes.length === 0) {
    return <div className="succes">Rien de suspect : votre boîte a l’air saine.</div>
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
              <td className="aide" style={{ maxWidth: 320 }}>
                {s.sampleSubjects[0] ?? ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// -------------------------------------------------------------- Progression

const PHASES: Record<ScanProgress['phase'], string> = {
  connexion: 'Connexion au serveur…',
  liste: 'Inventaire de la boîte de réception…',
  lecture: 'Lecture des en-têtes…',
  classement: 'Regroupement par expéditeur…',
  ia: 'Classement intelligent par l’IA…'
}

function VoileProgression({ scan }: { scan: ScanProgress }) {
  const pct = scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : null
  return (
    <div className="voile">
      <div className="panneau-progression">
        <h2>Analyse en cours</h2>
        <div className="note">
          {PHASES[scan.phase]}
          {scan.phase === 'lecture' && scan.total > 0 && ` (${scan.done}/${scan.total})`}
          {scan.phase === 'ia' && scan.total > 0 && ` (lot ${Math.min(scan.done + 1, scan.total)}/${scan.total})`}
          {scan.note ? ` — ${scan.note}` : ''}
        </div>
        <div className="rail">
          <div className="avancement" style={{ width: pct !== null ? `${pct}%` : '100%' }} />
        </div>
      </div>
    </div>
  )
}

function VoileApplication({ p }: { p: ApplyProgress }) {
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : null
  return (
    <div className="voile">
      <div className="panneau-progression">
        <h2>Rangement en cours</h2>
        <div className="note">
          {p.label ? `Libellé « ${p.label} »` : 'Préparation…'}
          {p.total > 0 && ` — ${p.done.toLocaleString('fr-FR')}/${p.total.toLocaleString('fr-FR')} mails`}
        </div>
        <div className="rail">
          <div className="avancement" style={{ width: pct !== null ? `${pct}%` : '100%' }} />
        </div>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ Résultat

function Resultat({ resultat, onRelancer }: { resultat: ApplyResult; onRelancer: () => void }) {
  return (
    <div className="carte ombre" style={{ marginBottom: 20 }}>
      <h1>Boîte rangée ✓</h1>
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
      <button className="principal" onClick={onRelancer}>
        Relancer une analyse
      </button>
    </div>
  )
}
