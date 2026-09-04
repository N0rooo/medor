import { useEffect, useState } from 'react'
import { api } from '../api'
import type { JournalEntry } from '../types'
import Mascotte from '../Mascotte'

const KINDS: Record<JournalEntry['kind'], { icone: string; titre: string }> = {
  rangement: { icone: '•', titre: 'Rangement' },
  auto: { icone: '•', titre: 'Rangement automatique' },
  corbeille: { icone: '•', titre: 'Mise à la corbeille' },
  restauration: { icone: '•', titre: 'Restauration' }
}

function resume(e: JournalEntry): string {
  const morceaux: string[] = []
  if (e.archived > 0) morceaux.push(`${e.archived.toLocaleString('fr-FR')} mails rangés`)
  if (e.labelsCreated > 0) morceaux.push(`${e.labelsCreated} libellés créés`)
  if (e.junked > 0) morceaux.push(`${e.junked} vers les indésirables`)
  if (e.trashed > 0) morceaux.push(`${e.trashed.toLocaleString('fr-FR')} mails à la corbeille`)
  if (e.restored > 0)
    morceaux.push(`${e.restored.toLocaleString('fr-FR')} mails remis en boîte de réception`)
  return morceaux.length > 0 ? morceaux.join(' · ') : 'aucun changement'
}

export default function Journal({ bloque }: { bloque: boolean }) {
  const [entrees, setEntrees] = useState<JournalEntry[] | null>(null)
  const [arme, setArme] = useState<string | null>(null)
  const [occupe, setOccupe] = useState(false)
  const [statut, setStatut] = useState<string | null>(null)

  const charger = () => {
    api.getJournal().then(setEntrees)
  }
  useEffect(charger, [])

  const annuler = async (e: JournalEntry) => {
    setOccupe(true)
    setArme(null)
    setStatut(null)
    try {
      const res = await api.undoJournal(e.id)
      setStatut(
        `${res.restored.toLocaleString('fr-FR')} mails remis dans la boîte de réception de ${e.accountEmail}, ${res.foldersDeleted} libellés supprimés.`
      )
      charger()
    } catch (err) {
      setStatut(String(err))
    } finally {
      setOccupe(false)
    }
  }

  return (
    <div className="colonne etroite">
      <h1>
        <Mascotte taille={38} style={{ marginRight: 10, verticalAlign: -6 }} />
        Journal de Médor
      </h1>
      <p className="sous-titre">
        Tout ce que Médor a fait, noir sur blanc — et l'annulation ciblée d'un rangement.
      </p>

      {statut && <div className="info">{statut}</div>}

      {entrees === null && <p className="aide">Chargement…</p>}
      {entrees !== null && entrees.length === 0 && (
        <div className="carte">
          <p className="aide" style={{ margin: 0 }}>
            Rien pour l'instant : le journal se remplira au premier rangement.
          </p>
        </div>
      )}

      {entrees?.map((e, index) => (
        <div className="carte" key={e.id} style={{ padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 18 }}>{KINDS[e.kind]?.icone ?? '•'}</span>
            <strong>{KINDS[e.kind]?.titre ?? e.kind}</strong>
            <span className="mono" style={{ color: 'var(--gris)', fontSize: 12 }}>
              {new Date(e.ts * 1000).toLocaleString('fr-FR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
            <span className="mono" style={{ color: 'var(--gris)', fontSize: 12 }}>
              {e.accountEmail}
            </span>
          </div>
          <p className="aide" style={{ margin: '6px 0 0' }}>
            {resume(e)}
            {e.labels.length > 0 && e.kind !== 'restauration' && (
              <> · {e.labels.length} libellés touchés</>
            )}
          </p>
          {(e.detail?.length ?? 0) > 0 && (
            <details style={{ marginTop: 6 }}>
              <summary className="aide" style={{ cursor: 'pointer' }}>
                Voir le détail ({e.detail!.length})
              </summary>
              <ul className="aide" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                {e.detail!.map((ligne, i) => (
                  <li key={i}>{ligne}</li>
                ))}
              </ul>
            </details>
          )}
          {(e.kind === 'rangement' || e.kind === 'auto') && e.labels.length > 0 && index !== 0 && (
            <p className="aide" style={{ margin: '8px 0 0', fontStyle: 'italic' }}>
              Annulable seulement tant que c'est la dernière action — des rangements plus
              récents ont retouché la boîte depuis.
            </p>
          )}
          {(e.kind === 'rangement' || e.kind === 'auto') && e.labels.length > 0 && index === 0 && (
            <div style={{ marginTop: 10 }}>
              {arme === e.id ? (
                <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="aide">
                    Vider les {e.labels.length} libellés de ce rangement vers la boîte de
                    réception ? (les libellés seront supprimés, aucun mail perdu)
                  </span>
                  <button className="danger" disabled={occupe || bloque} onClick={() => annuler(e)}>
                    {occupe ? 'En cours…' : 'Oui, annuler'}
                  </button>
                  <button className="secondaire" onClick={() => setArme(null)}>
                    Non
                  </button>
                </span>
              ) : (
                <button className="discret" disabled={occupe || bloque} onClick={() => setArme(e.id)}>
                  ↩︎ Annuler ce rangement
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
