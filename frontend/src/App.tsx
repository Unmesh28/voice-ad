import { Routes, Route, Navigate } from 'react-router-dom';
import { Box } from '@mui/material';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Login from './pages/Login';
import Register from './pages/Register';
import Projects from './pages/Projects';
import ScriptGenerator from './pages/ScriptGenerator';
import Production from './pages/Production';
import TTSGenerator from './pages/TTSGenerator';
import MusicGenerator from './pages/MusicGenerator';
import AdFormBuilder from './pages/AdFormBuilder';
import ProtectedRoute from './components/ProtectedRoute';

function App() {
  return (
    <Box sx={{ display: 'flex', minHeight: '100vh' }}>
      <Routes>
        {/* Public routes */}
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Protected routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="script-generator" element={<ScriptGenerator />} />
          <Route path="tts-generator" element={<TTSGenerator />} />
          <Route path="music-generator" element={<MusicGenerator />} />
          <Route path="production/:id?" element={<Production />} />
          <Route path="ad-builder" element={<AdFormBuilder />} />
        </Route>

        {/* 404 */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Box>
  );
}

export default App;
