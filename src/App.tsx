import { useCallback, useEffect, useState } from 'react'
import type { AccountConfig, AppBootstrap } from './types'
import Accueil from './views/Accueil'
import Dashboard from './views/Dashboard'
import Journal from './views/Journal'
import MaBoite from './views/MaBoite'
import NewslettersVue from './views/NewslettersVue'
import Reglages from './views/Reglages'
import Mascotte from './Mascotte'
import Bandeau from './Bandeau'
import { api, onApplyProgress, onBoucleProgress, onOpEtat, onScanProgress } from './api'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import type { ApplyProgress, BoucleProgress, ScanProgress } from './types'

type Vue = 'accueil' | 'tableau' | 'boite' | 'newsletters' | 'journal' | 'reglages'

export default function App() {
  const [boot, setBoot] = useState<AppBootstrap | null>(null)
  const [vue, setVue] = useState<Vue>('accueil')
  const [compteId, setCompteId] = useState<string | null>(null)
  // Le MÊME bandeau d'activité que sur le tableau de bord, pour les autres vues.
  const [scanGlobal, setScanGlobal] = useState<ScanProgress | null>(null)
  const [appliqueGlobal, setAppliqueGlobal] = useState<ApplyProgress | null>(null)
  const [boucleGlobal, setBoucleGlobal] = useState<BoucleProgress | null>(null)
  // Rangement automatique en retard au lancement : on demande, on n'impose pas.
  const [autoPopup, setAutoPopup] = useState(false)
  // Mise à jour de l'app disponible (vérifiée au lancement, choix à l'utilisateur).
  const [maj, setMaj] = useState<Update | null>(null)
  const [majEtat, setMajEtat] = useState<'choix' | 'telechargement' | 'redemarrage'>('choix')
  // Nombre d'opérations réellement en cours, annoncé par le backend (op-etat)
  // au moment où il prend/relâche le verrou : le bandeau ne devine plus rien.
  const [opsActives, setOpsActives] = useState(0)

  useEffect(() => {
    const desabos = [
      onScanProgress((p) => {
        setScanGlobal(p)
        setAppliqueGlobal(null)
      }),
      onApplyProgress((p) => {
        setAppliqueGlobal(p)
        setScanGlobal(null)
      }),
      onBoucleProgress((p) => setBoucleGlobal(p)),
      onOpEtat((e) => setOpsActives((n) => Math.max(0, n + (e.actif ? 1 : -1))))
    ]
    return () => {
      desabos.forEach((d) => d.then((fn) => fn()))
    }
  }, [])

  // Fin d'opération : on efface le contenu un instant après (le délai absorbe
  // les micro-transitions de verrou d'un « Range tout » entre deux passes).
  useEffect(() => {
    if (opsActives > 0) return
    const t = setTimeout(() => {
      setScanGlobal(null)
      setAppliqueGlobal(null)
      setBoucleGlobal(null)
    }, 1200)
    return () => clearTimeout(t)
  }, [opsActives])

  useEffect(() => {
    check()
      .then((u) => {
        if (u) setMaj(u)
      })
      .catch(() => {})
  }, [])

  const lancerMaj = async () => {
    if (!maj) return
    setMajEtat('telechargement')
    try {
      await maj.downloadAndInstall()
      setMajEtat('redemarrage')
      await relaunch()
    } catch {
      setMajEtat('choix')
    }
  }

  const rafraichir = useCallback(async () => {
    const state = await api.getState()
    setBoot(state)
    return state
  }, [])

  useEffect(() => {
    rafraichir().then((state) => {
      setVue(state.accounts.length === 0 ? 'accueil' : 'tableau')
      setCompteId(state.accounts[0]?.id ?? null)
      if (state.accounts.length > 0) {
        api.autoPending().then(setAutoPopup).catch(() => {})
      }
    })
  }, [rafraichir])

  if (!boot) {
    return (
      <div className="app">
        <div className="liseret" />
      </div>
    )
  }

  const compteAjoute = async (compte: AccountConfig) => {
    await rafraichir()
    setCompteId(compte.id)
    setVue('tableau')
  }

  const navVisible = boot.accounts.length > 0

  return (
    <div className="app">
      <div className="liseret" />
      <header className="entete" data-tauri-drag-region>
        <Mascotte taille={30} />
        <div className="marque-bloc" data-tauri-drag-region>
          <span className="marque">Médor</span>
          <span className="devise">Le chien qui range votre boîte mail</span>
        </div>
        {navVisible && (
          <nav>
            <button className={vue === 'tableau' ? 'actif' : ''} onClick={() => setVue('tableau')}>
              Tableau de bord
            </button>
            <button className={vue === 'boite' ? 'actif' : ''} onClick={() => setVue('boite')}>
              Ma boîte
            </button>
            <button
              className={vue === 'newsletters' ? 'actif' : ''}
              onClick={() => setVue('newsletters')}
            >
              Newsletters
            </button>
            <button className={vue === 'accueil' ? 'actif' : ''} onClick={() => setVue('accueil')}>
              Comptes
            </button>
            <button className={vue === 'journal' ? 'actif' : ''} onClick={() => setVue('journal')}>
              Journal
            </button>
            <button className={vue === 'reglages' ? 'actif' : ''} onClick={() => setVue('reglages')}>
              Réglages
            </button>
          </nav>
        )}
      </header>
      <main className="contenu">
        {vue === 'accueil' && (
          <Accueil boot={boot} onAccountAdded={compteAjoute} onOpenSettings={() => setVue('reglages')} />
        )}
        {/* Le tableau de bord reste monté en arrière-plan : changer d'onglet
            ne perd pas l'analyse en cours ni le plan affiché. */}
        {compteId && (
          <div style={{ display: vue === 'tableau' ? 'block' : 'none' }}>
            <Dashboard
              boot={boot}
              occupe={opsActives > 0}
              accountId={compteId}
              onSelectAccount={setCompteId}
              onAddAccount={() => setVue('accueil')}
            />
          </div>
        )}
        {compteId && (
          <div style={{ display: vue === 'boite' ? 'block' : 'none' }}>
            <MaBoite accountId={compteId} occupe={opsActives > 0} actif={vue === 'boite'} />
          </div>
        )}
        {compteId && (
          <div style={{ display: vue === 'newsletters' ? 'block' : 'none' }}>
            <NewslettersVue
              accountId={compteId}
              occupe={opsActives > 0}
              actif={vue === 'newsletters'}
            />
          </div>
        )}
        {vue === 'journal' && <Journal bloque={opsActives > 0} />}
        {vue === 'reglages' && <Reglages boot={boot} occupe={opsActives > 0} onChanged={rafraichir} />}
        {maj && (
          <div className="popup-auto">
            <div className="popup-auto-tete">
              <Mascotte taille={34} />
              <div>
                <strong>Nouvelle version {maj.version} disponible</strong>
                <p>
                  {majEtat === 'telechargement'
                    ? 'Téléchargement de la mise à jour…'
                    : majEtat === 'redemarrage'
                      ? 'Redémarrage de Médor…'
                      : 'Une mise à jour de Médor est prête. L’installer maintenant ?'}
                </p>
              </div>
            </div>
            {majEtat === 'choix' && (
              <div className="popup-auto-actions">
                <button className="secondaire" onClick={() => setMaj(null)}>
                  Plus tard
                </button>
                <button className="principal" onClick={lancerMaj}>
                  Mettre à jour
                </button>
              </div>
            )}
          </div>
        )}
        {!maj && autoPopup && opsActives === 0 && !scanGlobal && !appliqueGlobal && (
          <div className="popup-auto">
            <div className="popup-auto-tete">
              <Mascotte taille={34} />
              <div>
                <strong>Rangement automatique en attente</strong>
                <p>
                  Médor devait ranger pendant que l'app était fermée. Lancer la
                  passe maintenant ?
                </p>
              </div>
            </div>
            <div className="popup-auto-actions">
              <button
                className="secondaire"
                onClick={() => {
                  setAutoPopup(false)
                  api.autoDefer()
                }}
              >
                Plus tard
              </button>
              <button
                className="principal"
                onClick={() => {
                  setAutoPopup(false)
                  api.autoRunNow()
                }}
              >
                🦴 Lancer maintenant
              </button>
            </div>
          </div>
        )}
        {(opsActives > 0 || scanGlobal || appliqueGlobal || boucleGlobal) && (
          <Bandeau
            scan={scanGlobal}
            applique={appliqueGlobal}
            boucle={boucleGlobal}
            onAnnuler={() => {
              if (compteId) api.cancelOperation(compteId)
            }}
          />
        )}
      </main>
    </div>
  )
}
