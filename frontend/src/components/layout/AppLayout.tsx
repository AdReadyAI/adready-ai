import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext'

const navLinkClasses = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-2 rounded-md text-sm font-medium ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
  }`

export default function AppLayout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
          <span className="text-lg font-semibold text-slate-900">AdReady AI</span>
          <nav className="flex items-center gap-2">
            {user && (
              <>
                <NavLink to="/upload" className={navLinkClasses}>Upload</NavLink>
                <NavLink to="/loading" className={navLinkClasses}>Loading</NavLink>
                <NavLink to="/result" className={navLinkClasses}>Result</NavLink>
                <button
                  onClick={() => signOut()}
                  className="px-3 py-2 rounded-md text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Sign out
                </button>
              </>
            )}
            {!user && (
              <NavLink to="/auth/signin" className={navLinkClasses}>Sign in</NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="mx-auto px-6 py-8 lg:px-13">
        <Outlet />
      </main>
    </div>
  )
}
