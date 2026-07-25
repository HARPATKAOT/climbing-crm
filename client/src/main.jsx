import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';
import { BusinessProfileProvider } from './BusinessProfileContext.jsx';
import { getAccessToken } from './authClient.js';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import './index.css';

// Public forms are heavy (signature pad, PDF libs) and only needed on their
// own routes — load them on demand so the CRM shell stays light.
const PublicHealthForm           = lazy(() => import('./components/PublicHealthForm.jsx'));
const PublicOnboardingForm       = lazy(() => import('./components/PublicOnboardingForm.jsx'));
const LeadIntakeForm             = lazy(() => import('./components/LeadIntakeForm.jsx'));
const PrivacyPolicy              = lazy(() => import('./components/PrivacyPolicy.jsx'));
const PublicActivityRegistration = lazy(() => import('./components/PublicActivityRegistration.jsx'));
const PublicHostPayment          = lazy(() => import('./components/PublicHostPayment.jsx'));
const PublicEquipmentPayment     = lazy(() => import('./components/PublicEquipmentPayment.jsx'));

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
  if (isApiRequest && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    resource = 'https://climbing-crm-api.onrender.com' + resource;
  }
  return originalFetch(resource, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BusinessProfileProvider>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>טוען...</div>}>
          <Routes>
            <Route path="/health" element={<PublicHealthForm />} />
            <Route path="/health/:slug" element={<PublicHealthForm />} />
            <Route path="/onboard" element={<PublicOnboardingForm />} />
            <Route path="/join" element={<LeadIntakeForm />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/event/:slug" element={<PublicActivityRegistration />} />
            <Route path="/event-host/:token" element={<PublicHostPayment />} />
            <Route path="/equipment/:token" element={<PublicEquipmentPayment />} />
            <Route path="*" element={<AuthGate><App /></AuthGate>} />
          </Routes>
        </Suspense>
      </BusinessProfileProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
