import { Navigate, Route, Routes } from 'react-router-dom'
import AppLayout from './components/layout/AppLayout'
import UploadPage from './pages/UploadPage'
import LoadingPage from './pages/LoadingPage'
import ResultPage from './pages/ResultPage'
import { LoginPage } from './pages/LoginPage'

function App() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />

      <Route element={<AppLayout />}>
        <Route index element={<Navigate to="/upload" replace />} />
        <Route path="upload" element={<UploadPage />} />
        <Route path="loading" element={<LoadingPage />} />
        <Route path="result" element={<ResultPage />} />
      </Route>
    </Routes>
  )
}

export default App
