import { useEffect, useRef, useState } from 'react'
import type { ApplyProgress, BoucleProgress, ScanProgress } from './types'
import Mascotte from './Mascotte'

export const PHASES: Record<ScanProgress['phase'], string> = {
  connexion: 'Connexion au serveur…',
  liste: 'Inventaire de la boîte de réception…',
  lecture: 'Lecture des en-têtes…',
  classement: 'Regroupement par expéditeur…',
  ia: 'Classement intelligent par l’IA…'
}

export function formatDuree(s: number): string {
  if (s < 60) return `${s} s`
  return `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, '0')} s`
}

/**
 * LE bandeau d'activité de Médor — le même partout dans l'app, non bloquant,
 * ancré en bas à droite, avec progression et annulation.
 */
export default function Bandeau({
  scan,
  applique,
  boucle,
  onAnnuler
}: {
  scan: ScanProgress | null
  applique: ApplyProgress | null
  boucle: BoucleProgress | null
  onAnnuler: () => void
}) {
  const [annule, setAnnule] = useState(false)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const debutPhase = useRef(Date.now())
  const phasePrec = useRef(scan?.phase ?? '')
  /** Estimation FIGÉE à chaque étape franchie : entre deux, on décompte
   * vraiment au lieu de reprojeter (sinon le restant… augmente). */
  const etapePrec = useRef(-1)
  const estimeRestant = useRef(0)
  const dateEstime = useRef(Date.now())
  if (scan && scan.phase !== phasePrec.current) {
    phasePrec.current = scan.phase
    debutPhase.current = Date.now()
    etapePrec.current = -1
  }
  if (scan && scan.phase === 'ia' && scan.done !== etapePrec.current) {
    etapePrec.current = scan.done
    dateEstime.current = Date.now()
    estimeRestant.current =
      scan.done > 0 && scan.total > 0
        ? (((Date.now() - debutPhase.current) / 1000) * (scan.total - scan.done)) / scan.done
        : 0
  }
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  let titre = 'Médor s’active…'
  let note = ''
  let pct: number | null = null

  if (scan) {
    titre = 'Médor renifle la boîte…'
    note = PHASES[scan.phase]
    if (scan.phase === 'lecture' && scan.total > 0) note += ` (${scan.done}/${scan.total})`
    if (scan.phase === 'ia' && scan.total > 0) {
      note += ` — étape ${scan.done}/${scan.total}`
      if (scan.done > 0 && scan.done < scan.total) {
        const restant = Math.round(
          estimeRestant.current - (maintenant - dateEstime.current) / 1000
        )
        note += restant > 3 ? ` · ≈ ${formatDuree(restant)} restantes` : ' · ça se termine…'
      }
    }
    pct = scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : null
  } else if (applique) {
    titre = 'Médor range…'
    note = applique.label ? `${applique.label}` : 'Préparation…'
    if (applique.total > 0) {
      note += ` — ${applique.done.toLocaleString('fr-FR')}/${applique.total.toLocaleString('fr-FR')} mails`
    }
    pct = applique.total > 0 ? Math.round((applique.done / applique.total) * 100) : null
  }

  return (
    <div className="bandeau-medor">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <Mascotte taille={34} humeur="renifle" />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 13.5 }}>{titre}</div>
          <div className="note" style={{ margin: 0, fontSize: 12 }}>
            {note}
          </div>
          {boucle && (
            <div className="note" style={{ margin: 0, fontSize: 12 }}>
              Range tout — passe {boucle.passe} · {boucle.archivesCumules.toLocaleString('fr-FR')}{' '}
              mails rangés
            </div>
          )}
        </div>
      </div>
      <div className="rail" style={{ marginTop: 8 }}>
        <div className="avancement" style={{ width: pct !== null ? `${pct}%` : '100%' }} />
      </div>
      <div style={{ marginTop: 8, textAlign: 'right' }}>
        <button
          className="discret"
          disabled={annule}
          onClick={() => {
            setAnnule(true)
            onAnnuler()
          }}
        >
          {annule ? 'Annulation demandée…' : 'Annuler'}
        </button>
      </div>
    </div>
  )
}
