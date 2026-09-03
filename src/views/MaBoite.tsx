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
  const [majDate, setMajDate] = useState<number | null>(null)
  /** Une opération vient de se terminer : l'arbre affiché est périmé. */
  const [perime, setPerime] = useState(false)
  const occupePrec = useRef(occupe)

  const charger = async () => {
    setChargement(true)
    setErreur(null)
    try {
      setArbre(await api.mailboxTree(accountId))
      setMajDate(Math.floor(Date.now() / 1000))
      setApercus({})
      setStatuts({})
      setPerime(false)
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    } finally {
      setChargement(false)
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

  // Fin d'une opération (rangement, suppression…) : l'arbre est à rafraîchir.
  useEffect(() => {
    if (occupePrec.current && !occupe) setPerime(true)
    occupePrec.current = occupe
  }, [occupe])

  // Visible et (vide ou périmé) : on inventorie — l'ancien arbre reste affiché
  // pendant le rafraîchissement.
  useEffect(() => {
    if (actif && !chargement && !occupe && (arbre === null || perime)) {
      charger()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, accountId, perime, occupe])

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

  const vider = async (nom: string) => {
    setArmeVider(null)
    setStatuts((st) => ({ ...st, [nom]: 'Suppression en cours…' }))
    try {
      const n = await api.trashFolder(accountId, nom)
      setStatuts((st) => ({ ...st, [nom]: `🗑️ ${n.toLocaleString('fr-FR')} mails supprimés (corbeille du compte)` }))
      setArbre(
        (a) => a?.map((d) => (d.name === nom ? { ...d, total: 0, unseen: 0 } : d)) ?? null
      )
      // L'aperçu affiché correspond aux mails supprimés : on le retire.
      setApercus((a) => {
        const suivant = { ...a }
        delete suivant[nom]
        return suivant
      })
    } catch (e) {
      const m = String(e)
      setStatuts((st) => ({ ...st, [nom]: m.includes('annulée') ? 'Annulé' : m }))
    }
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
          <button className="secondaire" onClick={charger} disabled={chargement}>
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
                      dossiers.map((d) => {
                        const sous = d.name.includes('/')
                          ? d.name.slice(racine.length + 1)
                          : '(racine)'
                        const apercu = apercus[d.name]
                        return (
                          <div key={d.name} style={{ marginLeft: 34, marginTop: 8 }}>
                            <div
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 10,
                                flexWrap: 'wrap'
                              }}
                            >
                              <span style={{ flex: 1, minWidth: 160 }}>{sous}</span>
                              <span className="aide">
                                {d.total.toLocaleString('fr-FR')} mails
                                {d.unseen > 0 ? ` · ${d.unseen.toLocaleString('fr-FR')} non lus` : ''}
                              </span>
                              <button
                                className="discret"
                                onClick={() => voirApercu(d.name)}
                                disabled={d.total === 0}
                              >
                                {apercu ? 'Masquer' : '👁 Aperçu'}
                              </button>
                              {armeVider === d.name ? (
                                <span
                                  style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}
                                >
                                  <span className="aide">
                                    Supprimer les {d.total.toLocaleString('fr-FR')} mails de ce
                                    libellé ? (récupérables ~30 jours dans la corbeille du compte)
                                  </span>
                                  <button className="danger" onClick={() => vider(d.name)}>
                                    Oui, supprimer
                                  </button>
                                  <button className="discret" onClick={() => setArmeVider(null)}>
                                    Non
                                  </button>
                                </span>
                              ) : (
                                <button
                                  className="discret"
                                  onClick={() => setArmeVider(d.name)}
                                  disabled={occupe || d.total === 0}
                                >
                                  🗑️ Supprimer les mails
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
                            )}
                          </div>
                        )
                      })}
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
