import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './contexts/AuthContext'
import AppLayout from './components/layout/AppLayout'
import ProtectedRoute from './components/auth/ProtectedRoute'
import UploadPage from './pages/UploadPage'
import ResultPage from './pages/ResultPage'
import ReviewsPage from './pages/ReviewsPage'
import ForgotPasswordPage from './pages/auth/ForgotPasswordPage'
import AuthCallbackPage from './pages/auth/AuthCallbackPage'
import SignInPage from './pages/auth/SignInPage'
import UpdatePasswordPage from './pages/auth/UpdatePasswordPage'
import PrivacyPage from './pages/legal/PrivacyPage'
import TermsPage from './pages/legal/TermsPage'

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/upload" replace />} />
          <Route path="auth/callback" element={<AuthCallbackPage />} />
          <Route path="auth/signin" element={<SignInPage />} />
          <Route path="auth/signup" element={<SignInPage initialMode="signup" />} />
          <Route path="auth/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="auth/update-password" element={<UpdatePasswordPage />} />
          <Route path="terms" element={<TermsPage />} />
          <Route path="privacy" element={<PrivacyPage />} />
          <Route element={<ProtectedRoute />}>
            <Route path="upload" element={<UploadPage />} />
            <Route path="reviews" element={<ReviewsPage />} />
            {/* The batch id lives in the URL so results survive a refresh and
                can be shared or revisited. Router state does not survive either. */}
            <Route path="result/:batchId" element={<ResultPage />} />
            <Route path="result" element={<ResultPage />} />
          </Route>
        </Route>
      </Routes>
    </AuthProvider>
  )
}

export default App
