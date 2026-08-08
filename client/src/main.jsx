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
const PublicOnboardingForm       = lazy(() => import('./components/PublicOnboardingForm.jsx'));
const PublicEmployeeOnboardForm  = lazy(() => import('./components/PublicEmployeeOnboardForm.jsx'));
const LeadIntakeForm             = lazy(() => import('./components/LeadIntakeForm.jsx'));
const PrivacyPolicy              = lazy(() => import('./components/PrivacyPolicy.jsx'));
const PublicActivityRegistration = lazy(() => import('./components/PublicActivityRegistration.jsx'));
const PublicHostPayment          = lazy(() => import('./components/PublicHostPayment.jsx'));
const PublicEquipmentPayment     = lazy(() => import('./components/PublicEquipmentPayment.jsx'));
const PublicShop                 = lazy(() => import('./components/PublicShopPurchase.jsx'));
const PublicPosCheckout          = lazy(() => import('./components/PublicPosCheckout.jsx'));
const PublicSite                 = lazy(() => import('./public-site/PublicSite.jsx'));

/**
 * One deployment serves two things: the CRM on `app.<domain>` (and locally /
 * on Vercel previews, where staff work), and the public marketing site on the
 * bare domain. `?preview=site` forces the site so it can be reviewed before
 * the domain is switched over.
 */
function showsCrmShell() {
  if (new URLSearchParams(window.location.search).get('preview') === 'site') return false;
  const host = window.location.hostname;
  return (
    host.startsWith('app.') ||
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.endsWith('.vercel.app')
  );
}

// Attach the current session to API calls. In production, Vercel's rewrite
// proxies /api to Render on the same origin, avoiding browser CORS failures.
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
  return originalFetch(resource, init);
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BusinessProfileProvider>
        <Suspense fallback={<div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>טוען...</div>}>
          <Routes>
            {/* One form, three addresses. /register is its name — it collects
                details, health answers and a signature, so calling it /health
                described a third of it. /health and /onboard are the addresses
                already sitting in WhatsApp templates and in messages families
                have; they keep working and always will. */}
            <Route path="/register" element={<PublicOnboardingForm />} />
            <Route path="/register/:slug" element={<PublicOnboardingForm />} />
            <Route path="/health" element={<PublicOnboardingForm />} />
            <Route path="/health/:slug" element={<PublicOnboardingForm />} />
            <Route path="/onboard" element={<PublicOnboardingForm />} />
            <Route path="/onboard/:slug" element={<PublicOnboardingForm />} />
            <Route path="/staff-onboard" element={<PublicEmployeeOnboardForm />} />
            <Route path="/join" element={<LeadIntakeForm />} />
            <Route path="/privacy" element={<PrivacyPolicy />} />
            <Route path="/event/:slug" element={<PublicActivityRegistration />} />
            <Route path="/event-host/:token" element={<PublicHostPayment />} />
            <Route path="/equipment/:token" element={<PublicEquipmentPayment />} />
            <Route path="/shop" element={<PublicShop />} />
            <Route path="/shop/:slug" element={<PublicShop />} />
            {/* A cart the counter could not charge yet: sign what is missing,
                then pay. The token carries the cart and who it is for. */}
            <Route path="/checkout/:token" element={<PublicPosCheckout />} />
            <Route
              path="*"
              element={showsCrmShell() ? <AuthGate><App /></AuthGate> : <PublicSite />}
            />
          </Routes>
        </Suspense>
      </BusinessProfileProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
