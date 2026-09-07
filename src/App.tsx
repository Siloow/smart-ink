import { lazy, Suspense, useCallback, useState } from 'react'
import LandingPage from './LandingPage'
import LoginPage from './LoginPage'
import InvitePage from './InvitePage'
import InviteCodeEntry from './InviteCodeEntry'
import BetaAdminPage from './BetaAdminPage'
import { useBetaAuth } from './auth/useBetaAuth'
import type { BetaSession } from './auth/types'

/**
 * The workspace (scene list + editor) pulls in three.js, drei and the storage
 * layers. Loading it lazily keeps the landing and login pages light; the
 * landing hero still needs three.js itself, which Vite keeps in a shared chunk.
 */
const Workspace = lazy(() => import('./Workspace'))

type GateView = 'landing' | 'login' | 'invite' | 'invite-code' | 'admin' | 'app'

function initialGateView(): { view: GateView; inviteCode: string | null } {
  if (typeof window === 'undefined') return { view: 'landing', inviteCode: null }
  const params = new URLSearchParams(window.location.search)
  if (params.get('admin') === '1') return { view: 'admin', inviteCode: null }
  const invite = params.get('invite')?.trim().toUpperCase() ?? null
  if (invite) return { view: 'invite', inviteCode: invite }
  return { view: 'landing', inviteCode: null }
}

function App() {
  const betaAuth = useBetaAuth()
  const [gateView, setGateView] = useState<GateView>(() => {
    const boot = initialGateView()
    if (betaAuth.session && boot.view !== 'invite' && boot.view !== 'admin') return 'app'
    return boot.view
  })
  const [inviteCode, setInviteCode] = useState<string | null>(() => initialGateView().inviteCode)

  const clearInviteQuery = useCallback(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.has('invite') || url.searchParams.has('admin')) {
      url.searchParams.delete('invite')
      url.searchParams.delete('admin')
      window.history.replaceState({}, '', url.pathname + url.search + url.hash)
    }
  }, [])

  const setBetaSession = betaAuth.setSession
  const enterApp = useCallback(
    (session?: BetaSession | null) => {
      if (session) setBetaSession(session)
      clearInviteQuery()
      setGateView('app')
    },
    [setBetaSession, clearInviteQuery]
  )

  const goHome = useCallback(() => {
    clearInviteQuery()
    setGateView('landing')
  }, [clearInviteQuery])

  const logout = betaAuth.logout
  const signOut = useCallback(() => {
    logout()
    goHome()
  }, [logout, goHome])

  if (gateView === 'landing') {
    return <LandingPage onNavigateToLogin={() => setGateView('login')} />
  }

  if (gateView === 'admin') {
    return (
      <BetaAdminPage
        unlocked={betaAuth.adminUnlocked}
        waitlist={betaAuth.waitlist}
        invites={betaAuth.invites}
        activeEmails={betaAuth.activeEmails}
        onUnlock={betaAuth.unlockAdmin}
        onLock={betaAuth.lockAdmin}
        onRefresh={betaAuth.refreshAdminData}
        onBack={goHome}
      />
    )
  }

  if (gateView === 'invite-code') {
    return (
      <InviteCodeEntry
        onBack={() => setGateView('login')}
        onContinue={(code) => {
          setInviteCode(code)
          setGateView('invite')
        }}
      />
    )
  }

  if (gateView === 'invite' && inviteCode) {
    return <InvitePage code={inviteCode} onBack={goHome} onAuthenticated={enterApp} />
  }

  if (gateView === 'login' || (gateView === 'invite' && !inviteCode)) {
    return (
      <LoginPage
        onAuthenticated={enterApp}
        onBackToLanding={goHome}
        onOpenInvite={() => setGateView('invite-code')}
      />
    )
  }

  const session = betaAuth.session
  if (!session) {
    return <LandingPage onNavigateToLogin={() => setGateView('login')} />
  }

  return (
    <Suspense fallback={<div className="app-loading">Loading Smart Ink…</div>}>
      <Workspace session={session} onHome={goHome} onSignOut={signOut} />
    </Suspense>
  )
}

export default App
