import { useState } from 'react'
import { couleurAuto } from './couleurs'

type LigneComptee = { nom: string; n: number }

/**
 * Compte-rendu d'un rangement, en accordéons par racine : chaque racine porte
 * sa couleur, son total et une barre proportionnelle ; un clic la déplie sur
 * ses sous-libellés (leurs barres sont relatives au total de la racine).
 * Les lignes hors format « … » — N mails s'affichent en liste sobre.
 */
export default function CompteRendu({ lignes }: { lignes: string[] }) {
  const [ouverts, setOuverts] = useState<Record<string, boolean>>({})

  const comptees: LigneComptee[] = []
  const brutes: string[] = []
  for (const brut of lignes) {
    const m = brut.match(/^« (.+) » — ([\d\s  ]+) mails?/)
    if (m) comptees.push({ nom: m[1], n: parseInt(m[2].replace(/\D/g, ''), 10) })
    else brutes.push(brut)
  }

  if (comptees.length === 0) {
    return (
      <ul className="cr-brut">
        {lignes.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    )
  }

  const groupes = new Map<string, { total: number; items: LigneComptee[] }>()
  for (const c of comptees) {
    const racine = c.nom.split('/')[0]
    const g = groupes.get(racine) ?? { total: 0, items: [] }
    g.total += c.n
    g.items.push(c)
    groupes.set(racine, g)
  }
  const liste = [...groupes.entries()].sort((a, b) => b[1].total - a[1].total)
  const max = Math.max(...liste.map(([, g]) => g.total), 1)
  // Échelle en racine carrée : un gros dossier (Newsletters…) n'écrase pas
  // visuellement tous les autres, tout reste comparable d'un coup d'œil.
  const largeur = (n: number, base: number) =>
    `${Math.max(4, Math.round((Math.sqrt(n) / Math.sqrt(Math.max(base, 1))) * 100))}%`

  return (
    <div className="cr-liste">
      {liste.map(([racine, g]) => {
        const teinte = couleurAuto(racine)
        const depliable = g.items.length > 1 || g.items[0].nom !== racine
        const ouvert = ouverts[racine] ?? false
        return (
          <div key={racine}>
            <div
              className="cr-ligne"
              onClick={
                depliable ? () => setOuverts((o) => ({ ...o, [racine]: !ouvert })) : undefined
              }
              style={depliable ? { cursor: 'pointer', userSelect: 'none' } : undefined}
            >
              <div
                className="cr-remplissage"
                style={{ width: largeur(g.total, max), background: teinte }}
              />
              <span className="cr-chevron">{depliable ? (ouvert ? '▾' : '▸') : ''}</span>
              <span className="cr-pastille" style={{ background: teinte }} />
              <span className="cr-nom">
                <strong>{racine}</strong>
                {g.items.length > 1 && <span> · {g.items.length} libellés</span>}
              </span>
              <span className="mono cr-nb">{g.total.toLocaleString('fr-FR')}</span>
            </div>
            {ouvert && (
              <div className="cr-enfants">
                {[...g.items]
                  .sort((a, b) => b.n - a.n)
                  .map((c) => (
                    <div className="cr-ligne cr-sous" key={c.nom}>
                      <div
                        className="cr-remplissage"
                        style={{ width: largeur(c.n, g.total), background: teinte }}
                      />
                      <span className="cr-nom">
                        {c.nom === racine ? '(à la racine)' : c.nom.slice(racine.length + 1)}
                      </span>
                      <span className="mono cr-nb">{c.n.toLocaleString('fr-FR')}</span>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )
      })}
      {brutes.length > 0 && (
        <ul className="cr-brut">
          {brutes.map((l, i) => (
            <li key={i}>{l}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
