import { useCallback, useEffect, useState } from 'react'
import { api } from './api'
import type { AccountConfig, AppBootstrap } from './types'
import Accueil from './views/Accueil'
import Onboarding from './views/Onboarding'
import Dashboard from './views/Dashboard'
import Reglages from './views/Reglages'

type Vue = 'accueil' | 'onboarding' | 'tableau' | 'reglages'

export default function App() {
  const [boot, setBoot] = useState<AppBootstrap | null>(null)
  const [vue, setVue] = useState<Vue>('accueil')
  const [compteId, setCompteId] = useState<string | null>(null)

  const rafraichir = useCallback(async () => {
    const state = await api.getState()
    setBoot(state)
    return state
  }, [])

  useEffect(() => {
    rafraichir().then((state) => {
      if (state.accounts.length === 0) setVue('accueil')
      else if (!state.onboarding) setVue('onboarding')
      else setVue('tableau')
      setCompteId(state.accounts[0]?.id ?? null)
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
    const state = await rafraichir()
    setCompteId(compte.id)
    setVue(state.onboarding ? 'tableau' : 'onboarding')
  }

  const navVisible = boot.accounts.length > 0 && boot.onboarding !== null

  return (
    <div className="app">
      <div className="liseret" />
      <header className="entete" data-tauri-drag-region>
        <span className="marque">Médor</span>
        <span className="devise">Le chien qui range votre boîte mail</span>
        {navVisible && (
          <nav>
            <button className={vue === 'tableau' ? 'actif' : ''} onClick={() => setVue('tableau')}>
              Tableau de bord
            </button>
            <button className={vue === 'accueil' ? 'actif' : ''} onClick={() => setVue('accueil')}>
              Comptes
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
        {vue === 'onboarding' && (
          <Onboarding
            initial={boot.onboarding}
            onCancel={boot.onboarding ? () => setVue('tableau') : undefined}
            onDone={async (answers) => {
              await api.setOnboarding(answers)
              await rafraichir()
              setVue('tableau')
            }}
          />
        )}
        {vue === 'tableau' && compteId && (
          <Dashboard
            boot={boot}
            accountId={compteId}
            onSelectAccount={setCompteId}
            onAddAccount={() => setVue('accueil')}
            onEditOnboarding={() => setVue('onboarding')}
          />
        )}
        {vue === 'reglages' && (
          <Reglages boot={boot} onChanged={rafraichir} onEditOnboarding={() => setVue('onboarding')} />
        )}
      </main>
    </div>
  )
}
