import { useState } from 'react'
import type { OnboardingAnswers } from '../types'

interface Props {
  /** Réponses existantes : pré-remplit le questionnaire pour l'ajuster. */
  initial?: OnboardingAnswers | null
  onDone: (answers: OnboardingAnswers) => void
  /** Fourni quand on modifie des réponses existantes : permet d'annuler. */
  onCancel?: () => void
}

export default function Onboarding({ initial, onDone, onCancel }: Props) {
  const [etape, setEtape] = useState(0)
  const [usage, setUsage] = useState<OnboardingAnswers['usage']>(initial?.usage ?? 'mixte')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [granularity, setGranularity] = useState<'large' | 'fin'>(initial?.granularity ?? 'fin')
  const [horizon, setHorizon] = useState(initial?.horizonMonths ?? 12)
  const [archiveNews, setArchiveNews] = useState(initial?.archiveReadNewsletters ?? true)

  const terminer = () => {
    onDone({
      usage,
      // L'IA choisit elle-même les catégories : plus de sélection manuelle.
      categories: [],
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
                ['mixte', 'Les deux', 'Un peu de tout, Médor équilibre.']
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
          <h1>Des consignes particulières&nbsp;?</h1>
          <p className="sous-titre">
            L’IA invente elle-même les catégories adaptées à votre boîte. Ici, vous pouvez lui
            préciser vos règles à vous — elle les suivra en priorité. Sinon, passez simplement à
            la suite.
          </p>
          <label className="champ">
            <span>Expliquez avec vos mots comment ranger (facultatif, mais très efficace)</span>
            <textarea
              rows={5}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                'L’IA suit ces consignes en priorité. Par exemple :\n' +
                '« Je suis développeur freelance : un libellé par client (Acme, Globex…). »\n' +
                '« Tout ce qui touche à l’école des enfants dans un dossier École. »\n' +
                '« Les mails de ma copropriété dans Immobilier/Copro. »'
              }
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
            À chaque analyse, vous choisirez la portée : mails lus, non lus, ou toute la boîte.
            Cette question règle juste le sort des newsletters dans le plan proposé.
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
              <span className="detail">Médor les liste, mais n’y touche pas.</span>
            </button>
          </div>
          <div className="info" style={{ marginTop: 22 }}>
            Prochaine étape : Médor analyse la boîte et vous montre son plan de rangement.
            Rien n’est déplacé sans votre validation.
          </div>
        </>
      )}

      <div className="pied-etape">
        {etape > 0 ? (
          <button className="secondaire" onClick={() => setEtape(etape - 1)}>
            Retour
          </button>
        ) : onCancel ? (
          <button className="secondaire" onClick={onCancel}>
            Annuler
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
            {initial ? 'Enregistrer mes préférences' : 'Voir mon plan de rangement'}
          </button>
        )}
      </div>
    </div>
  )
}
