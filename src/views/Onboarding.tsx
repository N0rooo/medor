import { useState } from 'react'
import { DEFAULT_CATEGORIES, type OnboardingAnswers } from '../types'

interface Props {
  onDone: (answers: OnboardingAnswers) => void
}

export default function Onboarding({ onDone }: Props) {
  const [etape, setEtape] = useState(0)
  const [usage, setUsage] = useState<OnboardingAnswers['usage']>('mixte')
  const [categories, setCategories] = useState<string[]>([
    'Factures & reçus',
    'Banque & finance',
    'Shopping & livraisons',
    'Voyages & réservations',
    'Newsletters',
    'Sécurité & comptes'
  ])
  const [notes, setNotes] = useState('')
  const [granularity, setGranularity] = useState<'large' | 'fin'>('fin')
  const [horizon, setHorizon] = useState(12)
  const [archiveNews, setArchiveNews] = useState(true)

  const basculerCategorie = (c: string) => {
    setCategories((prev) => (prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]))
  }

  const terminer = () => {
    onDone({
      usage,
      categories,
      granularity,
      horizonMonths: horizon,
      archiveReadNewsletters: archiveNews,
      notes
    })
  }

  return (
    <div className="colonne etroite">
      <div className="etapes">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`point ${i <= etape ? 'fait' : ''}`} />
        ))}
      </div>

      {etape === 0 && (
        <>
          <h1>Comment utilisez-vous cette boîte&nbsp;?</h1>
          <p className="sous-titre">
            Cela oriente les libellés proposés : une boîte pro n’est pas rangée comme une boîte
            perso.
          </p>
          <div className="choix-cartes trois">
            {(
              [
                ['perso', 'Personnel', 'Achats, factures, voyages, newsletters…'],
                ['pro', 'Professionnel', 'Clients, projets, outils de travail…'],
                ['mixte', 'Les deux', 'Un peu de tout, Rangemail équilibre.']
              ] as const
            ).map(([val, titre, detail]) => (
              <button
                key={val}
                className={`choix-carte ${usage === val ? 'choisi' : ''}`}
                onClick={() => setUsage(val)}
              >
                <span className="titre">{titre}</span>
                <span className="detail">{detail}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {etape === 1 && (
        <>
          <h1>Quelles catégories vous parlent&nbsp;?</h1>
          <p className="sous-titre">
            Elles serviront de premier niveau de rangement. Vous pourrez toujours ajuster ensuite.
          </p>
          <div className="jetons">
            {DEFAULT_CATEGORIES.map((c) => (
              <button
                key={c}
                className={`jeton ${categories.includes(c) ? 'choisi' : ''}`}
                onClick={() => basculerCategorie(c)}
              >
                {c}
              </button>
            ))}
          </div>
          <label className="champ">
            <span>Autre chose à savoir sur votre boîte&nbsp;? (facultatif)</span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ex. : je suis développeur freelance, je veux garder à part tout ce qui concerne mes clients…"
            />
          </label>
        </>
      )}

      {etape === 2 && (
        <>
          <h1>Quel style de rangement&nbsp;?</h1>
          <p className="sous-titre">Deux écoles : quelques grands tiroirs, ou des dossiers précis.</p>
          <div className="choix-cartes deux">
            <button
              className={`choix-carte ${granularity === 'large' ? 'choisi' : ''}`}
              onClick={() => setGranularity('large')}
            >
              <span className="titre">Simple</span>
              <span className="detail">Une dizaine de grands libellés (« Voyages », « Factures »…)</span>
            </button>
            <button
              className={`choix-carte ${granularity === 'fin' ? 'choisi' : ''}`}
              onClick={() => setGranularity('fin')}
            >
              <span className="titre">Détaillé</span>
              <span className="detail">
                Des sous-libellés précis (« Voyages/SNCF », « Dev & outils/GitHub »…)
              </span>
            </button>
          </div>
          <h2 style={{ marginTop: 24 }}>Jusqu’où remonter&nbsp;?</h2>
          <div className="choix-cartes trois" style={{ marginTop: 12 }}>
            {(
              [
                [3, '3 derniers mois', 'Rapide, pour essayer.'],
                [12, '12 derniers mois', 'Le bon équilibre.'],
                [0, 'Toute la boîte', 'Jusqu’à 3 000 mails traités par analyse.']
              ] as const
            ).map(([val, titre, detail]) => (
              <button
                key={val}
                className={`choix-carte ${horizon === val ? 'choisi' : ''}`}
                onClick={() => setHorizon(val)}
              >
                <span className="titre">{titre}</span>
                <span className="detail">{detail}</span>
              </button>
            ))}
          </div>
        </>
      )}

      {etape === 3 && (
        <>
          <h1>Et les newsletters lues&nbsp;?</h1>
          <p className="sous-titre">
            Rangemail n’archive que les mails déjà lus — les non-lus restent bien visibles dans la
            boîte de réception.
          </p>
          <div className="choix-cartes deux">
            <button
              className={`choix-carte ${archiveNews ? 'choisi' : ''}`}
              onClick={() => setArchiveNews(true)}
            >
              <span className="titre">Archiver aussi les newsletters</span>
              <span className="detail">Une fois lues, elles filent dans leur libellé.</span>
            </button>
            <button
              className={`choix-carte ${!archiveNews ? 'choisi' : ''}`}
              onClick={() => setArchiveNews(false)}
            >
              <span className="titre">Les laisser en place</span>
              <span className="detail">Rangemail les liste, mais n’y touche pas.</span>
            </button>
          </div>
          <div className="info" style={{ marginTop: 22 }}>
            Prochaine étape : Rangemail analyse la boîte et vous montre son plan de rangement.
            Rien n’est déplacé sans votre validation.
          </div>
        </>
      )}

      <div className="pied-etape">
        {etape > 0 ? (
          <button className="secondaire" onClick={() => setEtape(etape - 1)}>
            Retour
          </button>
        ) : (
          <span />
        )}
        {etape < 3 ? (
          <button className="principal" onClick={() => setEtape(etape + 1)}>
            Continuer
          </button>
        ) : (
          <button className="principal large" onClick={terminer}>
            Voir mon plan de rangement
          </button>
        )}
      </div>
    </div>
  )
}
