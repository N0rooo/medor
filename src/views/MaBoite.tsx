import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { ApercuMail, DossierCompte } from '../types'
import Mascotte from '../Mascotte'

/* Même palette que le tableau de bord pour les pastilles de racines. */
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

function couleurAuto(nom: string): string {
  let h = 0
  for (const c of nom) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/**
 * « Ma boîte » : l'arborescence RÉELLE du compte, en accordéons — compteurs par
 * libellé, aperçu des derniers mails, et vidage d'un libellé vers la corbeille.
 */
export default function MaBoite({
  accountId,
  occupe,
  actif
}: {
  accountId: string
  occupe: boolean
  actif: boolean
}) {
  const [arbre, setArbre] = useState<DossierCompte[] | null>(null)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})
  const [apercus, setApercus] = useState<Record<string, ApercuMail[] | 'chargement'>>({})
  const [armeVider, setArmeVider] = useState<string | null>(null)
  const [statuts, setStatuts] = useState<Record<string, string>>({})
  const [recherche, setRecherche] = useState('')
  /** Sélection multiple de libellés, pour supprimer en un coup. */
  const [selection, setSelection] = useState<Record<string, boolean>>({})
  const [armeSelection, setArmeSelection] = useState(false)
  const [selectionEnCours, setSelectionEnCours] = useState(false)
  /** Opération lancée depuis CETTE vue : l'arbre est déjà mis à jour par
   * soustraction, pas besoin de re-inventorier derrière. */
  const opLocale = useRef(false)
  const [majDate, setMajDate] = useState<number | null>(null)
  /** Une opération vient de se terminer : l'arbre affiché est périmé. */
  const [perime, setPerime] = useState(false)
  const occupePrec = useRef(occupe)

  const charger = async () => {
    setChargement(true)
    setErreur(null)
    // L'inventaire est lui-même une opération : sans ce marqueur, sa propre
    // fin re-marquerait l'arbre « périmé » (d'où des inventaires en boucle).
    opLocale.current = true
    try {
      setArbre(await api.mailboxTree(accountId))
      setMajDate(Math.floor(Date.now() / 1000))
      setApercus({})
      setStatuts({})
      setSelection({})
      setPerime(false)
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    } finally {
      setChargement(false)
      setTimeout(() => {
        opLocale.current = false
      }, 1500)
    }
  }

  // Changement de compte : on réaffiche instantanément l'arbre persisté.
  useEffect(() => {
    setArbre(null)
    setOuverts({})
    setMajDate(null)
    let annule = false
    api
      .getLastTree(accountId)
      .then((a) => {
        if (a && !annule) {
          setArbre(a.dossiers)
          setMajDate(a.updatedAt)
        }
      })
      .catch(() => {})
    return () => {
      annule = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // Fin d'une opération EXTERNE (rangement, analyse…) : l'arbre est à
  // rafraîchir. Nos propres suppressions, elles, soustraient directement.
  useEffect(() => {
    if (occupePrec.current && !occupe && !opLocale.current) setPerime(true)
    occupePrec.current = occupe
  }, [occupe])

  // Auto-inventaire UNIQUEMENT au premier affichage (rien à montrer sinon).
  // Un arbre périmé affiche une invitation discrète — jamais d'inventaire
  // surprise qui verrouille le compte une minute.
  useEffect(() => {
    if (actif && !chargement && !occupe && arbre === null) {
      charger()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, accountId, occupe])

  const groupes = useMemo(() => {
    const q = recherche.trim().toLowerCase()
    const map = new Map<string, DossierCompte[]>()
    for (const d of arbre ?? []) {
      if (q && !d.name.toLowerCase().includes(q)) continue
      const racine = d.name.split('/')[0]
      const liste = map.get(racine) ?? []
      liste.push(d)
      map.set(racine, liste)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'fr'))
  }, [arbre, recherche])

  const totalMails = useMemo(
    () => (arbre ?? []).reduce((n, d) => n + d.total, 0),
    [arbre]
  )

  const voirApercu = async (nom: string) => {
    if (apercus[nom]) {
      setApercus((a) => {
        const suivant = { ...a }
        delete suivant[nom]
        return suivant
      })
      return
    }
    setApercus((a) => ({ ...a, [nom]: 'chargement' }))
    try {
      const mails = await api.folderPreview(accountId, nom)
      setApercus((a) => ({ ...a, [nom]: mails }))
    } catch (e) {
      setStatuts((st) => ({ ...st, [nom]: String(e) }))
      setApercus((a) => {
        const suivant = { ...a }
        delete suivant[nom]
        return suivant
      })
    }
  }

  /** Page suivante de l'aperçu (50 mails de plus, vers le passé). */
  const voirPlus = async (nom: string) => {
    const actuels = apercus[nom]
    if (!Array.isArray(actuels)) return
    try {
      const plus = await api.folderPreview(accountId, nom, actuels.length)
      setApercus((a) => ({ ...a, [nom]: [...actuels, ...plus] }))
    } catch (e) {
      setStatuts((st) => ({ ...st, [nom]: String(e) }))
    }
  }

  const cochees = useMemo(
    () => (arbre ?? []).filter((d) => selection[d.name]),
    [arbre, selection]
  )
  const totalCoche = cochees.reduce((n, d) => n + d.total, 0)

  const viderSelection = async () => {
    setArmeSelection(false)
    setSelectionEnCours(true)
    opLocale.current = true
    try {
      const res = await api.trashFolders(
        accountId,
        cochees.map((d) => d.name)
      )
      const supprimes = new Set(res.deleted)
      setArbre(
        (a) =>
          a
            ?.filter((d) => !supprimes.has(d.name))
            .map((d) => (selection[d.name] ? { ...d, total: 0, unseen: 0 } : d)) ?? null
      )
      setApercus((ap) => {
        const suivant = { ...ap }
        for (const d of cochees) delete suivant[d.name]
        return suivant
      })
      setSelection({})
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    } finally {
      setSelectionEnCours(false)
      setTimeout(() => {
        opLocale.current = false
      }, 1500)
    }
  }

  const vider = async (nom: string) => {
    setArmeVider(null)
    setStatuts((st) => ({ ...st, [nom]: 'Suppression en cours…' }))
    opLocale.current = true
    try {
      const res = await api.trashFolder(accountId, nom)
      if (res.folderDeleted) {
        // Libellé disparu : on retire la ligne de l'arbre.
        setArbre((a) => a?.filter((d) => d.name !== nom) ?? null)
      } else {
        setStatuts((st) => ({
          ...st,
          [nom]:
            `${res.trashed.toLocaleString('fr-FR')} mails supprimés (corbeille du compte)` +
            ' · le libellé reste (il a des sous-dossiers)'
        }))
        setArbre(
          (a) => a?.map((d) => (d.name === nom ? { ...d, total: 0, unseen: 0 } : d)) ?? null
        )
      }
      // L'aperçu affiché correspond aux mails supprimés : on le retire.
      setApercus((a) => {
        const suivant = { ...a }
        delete suivant[nom]
        return suivant
      })
    } catch (e) {
      const m = String(e)
      setStatuts((st) => ({ ...st, [nom]: m.includes('annulée') ? 'Annulé' : m }))
    } finally {
      setTimeout(() => {
        opLocale.current = false
      }, 1500)
    }
  }

  /** Une ligne de libellé : case, nom, compteurs, aperçu, suppression. */
  const ligne = (d: DossierCompte, libelle: string, indent: number) => {
    const apercu = apercus[d.name]
    return (
      <div key={d.name} style={{ marginLeft: indent, marginTop: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            type="checkbox"
            checked={selection[d.name] ?? false}
            onChange={(e) => setSelection((sel) => ({ ...sel, [d.name]: e.target.checked }))}
          />
          <span style={{ flex: 1, minWidth: 160 }}>{libelle}</span>
          <span className="aide">
            {d.total.toLocaleString('fr-FR')} mails
            {d.unseen > 0 ? ` · ${d.unseen.toLocaleString('fr-FR')} non lus` : ''}
          </span>
          <button className="discret" onClick={() => voirApercu(d.name)} disabled={d.total === 0}>
            {apercu ? 'Masquer' : 'Aperçu'}
          </button>
          {armeVider === d.name ? (
            <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
              <span className="aide">
                {d.total > 0
                  ? `Supprimer les ${d.total.toLocaleString('fr-FR')} mails ET le libellé ? (mails récupérables ~30 jours dans la corbeille du compte)`
                  : 'Supprimer ce libellé vide ?'}
              </span>
              <button className="danger" disabled={occupe} onClick={() => vider(d.name)}>
                Oui, supprimer
              </button>
              <button className="discret" onClick={() => setArmeVider(null)}>
                Non
              </button>
            </span>
          ) : (
            <button className="discret" onClick={() => setArmeVider(d.name)} disabled={occupe}>
              {d.total > 0 ? 'Supprimer les mails' : 'Supprimer le libellé'}
            </button>
          )}
        </div>
        {statuts[d.name] && (
          <p className="aide" style={{ margin: '4px 0 0' }}>
            {statuts[d.name]}
          </p>
        )}
        {apercu === 'chargement' && (
          <p className="aide" style={{ margin: '6px 0 0' }}>
            Médor renifle ce libellé…
          </p>
        )}
        {Array.isArray(apercu) && (
          <>
          <table className="liste" style={{ marginTop: 8 }}>
            <tbody>
              {apercu.map((m, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }} className="aide">
                    {m.date}
                  </td>
                  <td
                    style={{
                      maxWidth: 220,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {m.from}
                  </td>
                  <td
                    style={{
                      maxWidth: 420,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontWeight: m.seen ? 400 : 700
                    }}
                  >
                    {m.subject || '(sans objet)'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {apercu.length < d.total && (
            <button className="discret" style={{ marginTop: 6 }} onClick={() => voirPlus(d.name)}>
              Afficher plus ({apercu.length.toLocaleString('fr-FR')}/
              {d.total.toLocaleString('fr-FR')})
            </button>
          )}
          </>
        )}
      </div>
    )
  }

  return (
    <div className="colonne">
      <div className="carte ombre">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Mascotte taille={40} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: 0 }}>Ma boîte</h2>
            <p className="aide" style={{ margin: '2px 0 0' }}>
              {arbre
                ? `${arbre.length.toLocaleString('fr-FR')} libellés · ${totalMails.toLocaleString('fr-FR')} mails rangés${
                    majDate
                      ? ` · inventaire de ${new Date(majDate * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`
                      : ''
                  }`
                : 'L’arborescence réelle de votre compte, libellé par libellé.'}
            </p>
          </div>
          {perime && arbre !== null && !chargement && (
            <span className="aide" style={{ fontStyle: 'italic' }}>
              La boîte a changé depuis cet inventaire
            </span>
          )}
          <button className="secondaire" onClick={charger} disabled={chargement || occupe}>
            {chargement ? 'Inventaire…' : '↻ Actualiser'}
          </button>
        </div>

        {erreur && <div className="erreur" style={{ marginTop: 12 }}>{erreur}</div>}
        {chargement && !arbre && (
          <p className="aide" style={{ marginTop: 14 }}>
            Médor compte les mails de chaque libellé…
          </p>
        )}

        {arbre && arbre.length === 0 && (
          <p className="aide" style={{ marginTop: 14 }}>
            Aucun libellé sur ce compte pour l’instant — lancez une analyse depuis le tableau de
            bord.
          </p>
        )}

        {arbre && arbre.length > 0 && (
          <>
            <input
              type="text"
              className="champ-recherche"
              style={{ marginTop: 14 }}
              placeholder="🔍 Filtrer les libellés…"
              value={recherche}
              onChange={(e) => setRecherche(e.target.value)}
            />
            {cochees.length > 0 && (
              <div
                className="info"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                  marginTop: 4
                }}
              >
                <strong>
                  {cochees.length.toLocaleString('fr-FR')} libellés ·{' '}
                  {totalCoche.toLocaleString('fr-FR')} mails sélectionnés
                </strong>
                {armeSelection ? (
                  <>
                    <span className="aide">
                      Supprimer les mails ET les libellés sélectionnés ? (mails récupérables ~30
                      jours dans la corbeille du compte)
                    </span>
                    <button
                      className="danger"
                      disabled={occupe || selectionEnCours}
                      onClick={viderSelection}
                    >
                      Oui, tout supprimer
                    </button>
                    <button className="discret" onClick={() => setArmeSelection(false)}>
                      Non
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="danger"
                      disabled={occupe || selectionEnCours}
                      onClick={() => setArmeSelection(true)}
                    >
                      {selectionEnCours ? 'Suppression en cours…' : 'Supprimer la sélection'}
                    </button>
                    <button className="discret" onClick={() => setSelection({})}>
                      Tout désélectionner
                    </button>
                  </>
                )}
              </div>
            )}
            <div style={{ marginTop: 6 }}>
              {groupes.map(([racine, dossiers]) => {
                const totalGroupe = dossiers.reduce((n, d) => n + d.total, 0)
                const nonLus = dossiers.reduce((n, d) => n + d.unseen, 0)
                const ouvert = ouverts[racine] ?? recherche.trim() !== ''
                return (
                  <div
                    key={racine}
                    style={{ borderTop: '1px solid var(--ligne)', padding: '10px 2px' }}
                  >
                    <div
                      onClick={() => setOuverts((o) => ({ ...o, [racine]: !ouvert }))}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        userSelect: 'none'
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={dossiers.every((d) => selection[d.name])}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          const coche = e.target.checked
                          setSelection((sel) => {
                            const suivant = { ...sel }
                            for (const d of dossiers) suivant[d.name] = coche
                            return suivant
                          })
                        }}
                      />
                      <span style={{ width: 14, textAlign: 'center' }}>{ouvert ? '▾' : '▸'}</span>
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 3,
                          background: couleurAuto(racine),
                          flex: 'none'
                        }}
                      />
                      <strong style={{ flex: 1 }}>{racine}</strong>
                      <span className="aide">
                        {totalGroupe.toLocaleString('fr-FR')} mails
                        {nonLus > 0 ? ` · ${nonLus.toLocaleString('fr-FR')} non lus` : ''}
                      </span>
                    </div>
                    {ouvert &&
                      (() => {
                        // Regrouper par sous-catégorie : la vraie hiérarchie.
                        const propreRacine = dossiers.find((d) => d.name === racine)
                        const sousMap = new Map<
                          string,
                          { propre?: DossierCompte; enfants: DossierCompte[] }
                        >()
                        for (const d of dossiers) {
                          if (d.name === racine) continue
                          const segs = d.name.split('/')
                          const cle = segs[1]
                          const entree = sousMap.get(cle) ?? { enfants: [] }
                          if (segs.length === 2) entree.propre = d
                          else entree.enfants.push(d)
                          sousMap.set(cle, entree)
                        }
                        return (
                          <>
                            {propreRacine &&
                              propreRacine.total > 0 &&
                              ligne(propreRacine, '(mails à la racine)', 34)}
                            {[...sousMap.entries()]
                              .sort((a, b) => a[0].localeCompare(b[0], 'fr'))
                              .map(([sous, { propre, enfants }]) => {
                                if (enfants.length === 0 && propre) {
                                  return ligne(propre, sous, 34)
                                }
                                const cle2 = `${racine}/${sous}`
                                const membres = [...(propre ? [propre] : []), ...enfants]
                                const total2 = membres.reduce((n, d) => n + d.total, 0)
                                const nonLus2 = membres.reduce((n, d) => n + d.unseen, 0)
                                const ouvert2 = ouverts[cle2] ?? recherche.trim() !== ''
                                return (
                                  <div key={cle2} style={{ marginLeft: 34, marginTop: 8 }}>
                                    <div
                                      onClick={() => setOuverts((o) => ({ ...o, [cle2]: !ouvert2 }))}
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 10,
                                        cursor: 'pointer',
                                        userSelect: 'none'
                                      }}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={membres.every((d) => selection[d.name])}
                                        onClick={(e) => e.stopPropagation()}
                                        onChange={(e) => {
                                          const coche = e.target.checked
                                          setSelection((sel) => {
                                            const suivant = { ...sel }
                                            for (const d of membres) suivant[d.name] = coche
                                            return suivant
                                          })
                                        }}
                                      />
                                      <span style={{ width: 14, textAlign: 'center' }}>
                                        {ouvert2 ? '▾' : '▸'}
                                      </span>
                                      <span style={{ flex: 1, fontWeight: 600 }}>{sous}</span>
                                      <span className="aide">
                                        {total2.toLocaleString('fr-FR')} mails
                                        {nonLus2 > 0
                                          ? ` · ${nonLus2.toLocaleString('fr-FR')} non lus`
                                          : ''}
                                      </span>
                                    </div>
                                    {ouvert2 && (
                                      <>
                                        {propre && ligne(propre, `(directement dans ${sous})`, 34)}
                                        {[...enfants]
                                          .sort((a, b) => a.name.localeCompare(b.name, 'fr'))
                                          .map((d) =>
                                            ligne(d, d.name.split('/').slice(2).join('/'), 34)
                                          )}
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                          </>
                        )
                      })()}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
