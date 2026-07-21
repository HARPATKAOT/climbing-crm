import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';
import PublicHealthForm from './components/PublicHealthForm.jsx';
import PublicOnboardingForm from './components/PublicOnboardingForm.jsx';
import LeadIntakeForm from './components/LeadIntakeForm.jsx';
import PrivacyPolicy from './components/PrivacyPolicy.jsx';
import { getAccessToken } from './authClient.js';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

// Automatically route all /api calls directly to live cloud Render backend when running on Vercel
const originalFetch = window.fetch.bind(window);
window.fetch = async function (resource, init = {}) {
  const isApiRequest = typeof resource === 'string' && resource.startsWith('/api');
  if (isApiRequest) {
    const token = await getAccessToken();
    if (token) {
      const headers = new Headers(init.headers || {});
      headers.set('Authorization', `Bearer ${token}`);
      init = { ...init, headers };
    }
  }
  if (isApiRequest && window.location.hostname !== 'localhost') {
    resource = 'https://climbing-crm-api.onrender.com' + resource;
  }
  return originalFetch(resource, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/health" element={<PublicHealthForm />} />
        <Route path="/health/:slug" element={<PublicHealthForm />} />
        <Route path="/onboard" element={<PublicOnboardingForm />} />
        <Route path="/join" element={<LeadIntakeForm />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="*" element={<AuthGate><App /></AuthGate>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
