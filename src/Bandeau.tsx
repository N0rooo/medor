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
 *
 * Temps restant : projection figée à chaque progrès réel, avec une marge de
 * sécurité (mieux vaut finir en avance que voir le chiffre remonter), puis
 * vrai compte à rebours entre deux. Chrono écoulé sur les phases sans total.
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
  const [demandeAnnul, setDemandeAnnul] = useState(false)
  const [maintenant, setMaintenant] = useState(() => Date.now())
  const debutOp = useRef(Date.now())
  const debutPhase = useRef(Date.now())
  const reperePhase = useRef('')
  const etapePrec = useRef(-1)
  const estimeRestant = useRef(0)
  const dateEstime = useRef(Date.now())

  // Changement de phase (ou de nature d'opération) : on repart de zéro.
  const repere = scan ? `scan:${scan.phase}` : applique ? 'applique' : ''
  if (repere !== reperePhase.current) {
    reperePhase.current = repere
    debutPhase.current = Date.now()
    etapePrec.current = -1
    estimeRestant.current = 0
  }

  // Projection figée au moment où `done` avance. Marge plus large pour l'IA :
  // les lots parallèles finissent par les plus lents.
  const cible = scan
    ? scan.phase === 'ia' || scan.phase === 'lecture'
      ? scan
      : null
    : applique
  const marge = scan?.phase === 'ia' ? 1.35 : 1.15
  if (cible && cible.total > 0 && cible.done > 0 && cible.done !== etapePrec.current) {
    etapePrec.current = cible.done
    dateEstime.current = Date.now()
    estimeRestant.current =
      (((Date.now() - debutPhase.current) / 1000) * (cible.total - cible.done) * marge) /
      cible.done
  }

  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const ecouleOp = Math.max(0, Math.floor((maintenant - debutOp.current) / 1000))
  const ecoulePhase = Math.max(0, Math.floor((maintenant - debutPhase.current) / 1000))
  const decompte = Math.round(estimeRestant.current - (maintenant - dateEstime.current) / 1000)
  /** « ≈ 2 min 10 s restantes », « encore un peu… » si le décompte est à sec,
   * « ça se termine… » seulement sur la dernière étape. */
  const suffixeRestant = (done: number, total: number): string => {
    if (done <= 0 || done >= total) return ''
    if (decompte > 3) return ` · ≈ ${formatDuree(decompte)} restantes`
    return done >= total - 1 ? ' · ça se termine…' : ' · encore un peu…'
  }

  let titre = 'Médor s’active…'
  let note = `en cours depuis ${formatDuree(ecouleOp)}`
  let pct: number | null = null

  if (scan) {
    titre = 'Médor renifle la boîte…'
    note = scan.note ?? PHASES[scan.phase]
    if (scan.phase === 'lecture' && scan.total > 0) {
      note += ` (${scan.done}/${scan.total})` + suffixeRestant(scan.done, scan.total)
    } else if (scan.phase === 'ia' && scan.total > 0) {
      note += ` — étape ${scan.done}/${scan.total}`
      note +=
        scan.done === 0
          ? ` · lots lancés · ${formatDuree(ecoulePhase)}`
          : suffixeRestant(scan.done, scan.total)
    } else {
      note += ` · ${formatDuree(ecoulePhase)}`
    }
    pct = scan.total > 0 ? Math.round((scan.done / scan.total) * 100) : null
  } else if (applique) {
    titre = 'Médor range…'
    note = applique.label ? `${applique.label}` : 'Préparation…'
    if (applique.total > 0) {
      const unite =
        applique.label.startsWith('Nettoyage') || applique.label.includes('préparation')
          ? 'dossiers'
          : applique.label.startsWith('Désabonnements')
            ? 'newsletters'
            : 'mails'
      note += ` — ${applique.done.toLocaleString('fr-FR')}/${applique.total.toLocaleString('fr-FR')} ${unite}`
      note += suffixeRestant(applique.done, applique.total)
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
        {annule ? (
          <button className="discret" disabled>
            Annulation demandée…
          </button>
        ) : demandeAnnul ? (
          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
            Vraiment annuler ?
            <button
              className="danger"
              onClick={() => {
                setDemandeAnnul(false)
                setAnnule(true)
                onAnnuler()
              }}
            >
              Oui, annuler
            </button>
            <button className="discret" onClick={() => setDemandeAnnul(false)}>
              Non, continuer
            </button>
          </span>
        ) : (
          <button className="discret" onClick={() => setDemandeAnnul(true)}>
            Annuler
          </button>
        )}
      </div>
    </div>
  )
}
