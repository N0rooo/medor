import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api'
import type { ApplyProgress, Plan, SenderGroup } from '../types'
import { Newsletters } from './Dashboard'
import Mascotte from '../Mascotte'

/**
 * Onglet permanent « Newsletters » : la liste complète avec désabonnement et
 * corbeille, toujours disponible — alimentée par la dernière analyse
 * persistée, ou reconstruite en lisant les mails déjà rangés.
 */
export default function NewslettersVue({
  accountId,
  occupe,
  actif
}: {
  accountId: string
  occupe: boolean
  actif: boolean
}) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [perime, setPerime] = useState(false)
  const occupePrec = useRef(occupe)

  const noop: React.Dispatch<React.SetStateAction<ApplyProgress | null>> = () => {}

  // Changement de compte : recharge la dernière analyse persistée.
  useEffect(() => {
    setPlan(null)
    setErreur(null)
    let annule = false
    api
      .getLastPlan(accountId)
      .then((p) => {
        if (p && !annule) setPlan(p)
      })
      .catch(() => {})
    return () => {
      annule = true
    }
  }, [accountId])

  // Après une opération (analyse, rangement…), la liste peut avoir changé :
  // on recharge silencieusement la version persistée à la prochaine visite.
  useEffect(() => {
    if (occupePrec.current && !occupe) setPerime(true)
    occupePrec.current = occupe
  }, [occupe])
  useEffect(() => {
    if (actif && perime && !occupe) {
      setPerime(false)
      api
        .getLastPlan(accountId)
        .then((p) => {
          if (p) setPlan(p)
        })
        .catch(() => {})
    }
  }, [actif, perime, occupe, accountId])

  const parCle = useMemo(() => {
    const map = new Map<string, SenderGroup>()
    plan?.senders.forEach((s) => map.set(s.key, s))
    return map
  }, [plan])

  const inventorier = async () => {
    setChargement(true)
    setErreur(null)
    try {
      setPlan(await api.rescanOrganized(accountId))
    } catch (e) {
      const m = String(e)
      if (!m.includes('annulée')) setErreur(m)
    } finally {
      setChargement(false)
    }
  }

  return (
    <div className="colonne">
      <div className="carte ombre">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <Mascotte taille={40} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <h2 style={{ margin: 0 }}>Newsletters</h2>
            <p className="aide" style={{ margin: '2px 0 0' }}>
              {plan
                ? `${plan.newsletters.length.toLocaleString('fr-FR')} newsletters repérées${
                    plan.scannedAt
                      ? ` · analyse du ${new Date(plan.scannedAt * 1000).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
                      : ''
                  }`
                : 'Désabonnement en un clic et corbeille, toujours à portée de patte.'}
            </p>
          </div>
          <button className="secondaire" onClick={inventorier} disabled={chargement || occupe}>
            {chargement ? 'Inventaire…' : '↻ Ré-inventorier'}
          </button>
        </div>

        {erreur && (
          <div className="erreur" style={{ marginTop: 12 }}>
            {erreur}
          </div>
        )}

        {!plan && !chargement && (
          <p className="aide" style={{ marginTop: 14 }}>
            Aucune analyse connue pour ce compte : lancez une analyse depuis le tableau de bord,
            ou cliquez « Ré-inventorier » pour que Médor lise les mails déjà rangés.
          </p>
        )}
        {chargement && !plan && (
          <p className="aide" style={{ marginTop: 14 }}>
            Médor renifle les dossiers…
          </p>
        )}

        {plan && plan.newsletters.length === 0 && (
          <p className="aide" style={{ marginTop: 14 }}>
            Aucune newsletter repérée dans la dernière analyse.
          </p>
        )}

        {plan && plan.newsletters.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <Newsletters
              plan={plan}
              parCle={parCle}
              accountId={accountId}
              occupe={occupe}
              progresser={noop}
            />
          </div>
        )}
      </div>
    </div>
  )
}
