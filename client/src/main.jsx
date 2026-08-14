import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import AuthGate from './components/AuthGate.jsx';
import AppErrorBoundary from './components/AppErrorBoundary.jsx';
import { BusinessProfileProvider } from './BusinessProfileContext.jsx';
import { getAccessToken } from './authClient.js';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { installNumberInputWheelGuard } from './utils/numberInputWheelGuard.js';
import './index.css';

// Number and amount fields must never change accidentally while the user is
// scrolling. Select menus and other scrollable option lists remain untouched.
installNumberInputWheelGuard();

// A tab that stayed open during a deployment can still run the previous entry
// bundle while its lazy-loaded screen chunks have already been replaced. Vite
// emits this event before surfacing the failed import. Reload once so the tab
// picks up the current asset manifest; if that also fails, AppErrorBoundary
// shows a usable recovery screen instead of leaving the application blank.
const CHUNK_RELOAD_KEY = 'kirboaz:chunk-reload-at';
const CHUNK_RELOAD_COOLDOWN_MS = 30_000;

window.addEventListener('vite:preloadError', (event) => {
  let lastReloadAt = 0;
  try {
    lastReloadAt = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY)) || 0;
  } catch {
    // Storage can be unavailable in restrictive browser modes. The reload is
    // still preferable to a blank screen in that case.
  }

  if (Date.now() - lastReloadAt < CHUNK_RELOAD_COOLDOWN_MS) return;

  event.preventDefault();
  try {
    window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {
    // See the storage note above.
  }
  window.location.reload();
});

window.setTimeout(() => {
  try {
    window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // Nothing to clean up when storage is unavailable.
  }
}, CHUNK_RELOAD_COOLDOWN_MS);

// Public forms are heavy (signature pad, PDF libs) and only needed on their
// own routes — load them on demand so the CRM shell stays light.
const PublicOnboardingForm       = lazy(() => import('./components/PublicOnboardingForm.jsx'));
const PublicEmployeeOnboardForm  = lazy(() => import('./components/PublicEmployeeOnboardForm.jsx'));
const WhatsAppRedirect           = lazy(() => import('./public-site/components/WhatsAppRedirect.jsx'));
const PrivacyPolicy              = lazy(() => import('./components/PrivacyPolicy.jsx'));
const PublicActivityRegistration = lazy(() => import('./components/PublicActivityRegistration.jsx'));
const PublicHostPayment          = lazy(() => import('./components/PublicHostPayment.jsx'));
const PublicEquipmentPayment     = lazy(() => import('./components/PublicEquipmentPayment.jsx'));
const PublicShop                 = lazy(() => import('./components/PublicShopPurchase.jsx'));
const PublicPosCheckout          = lazy(() => import('./components/PublicPosCheckout.jsx'));
const PublicShiftSignup          = lazy(() => import('./components/PublicShiftSignup.jsx'));
const PublicMailingPreferences   = lazy(() => import('./components/PublicMailingPreferences.jsx'));
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
    <AppErrorBoundary>
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
            {/* זמינות למשמרות — הקישור שמחליף את הסקר בוואטסאפ. */}
            <Route path="/shift-signup/:token" element={<PublicShiftSignup />} />
            <Route path="/mailing-preferences/:token" element={<PublicMailingPreferences />} />
            {/* The retired lead form now sends every legacy link to WhatsApp. */}
            <Route path="/join" element={<WhatsAppRedirect />} />
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
    </AppErrorBoundary>
  </React.StrictMode>,
);
