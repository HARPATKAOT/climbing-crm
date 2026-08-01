import React, { createContext, useContext, useEffect, useMemo, useState, lazy, Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { authClient, authConfigured } from '../authClient.js';
import { useBusinessProfile } from '../BusinessProfileContext.jsx';
import { isPublicPath } from '../publicPaths.js';

// Lazy — these heavy public forms must not be bundled into the CRM shell.
// They render here only as defense in depth when a public URL hits the catch-all.
const PublicActivityRegistration = lazy(() => import('./PublicActivityRegistration.jsx'));
const PublicHostPayment          = lazy(() => import('./PublicHostPayment.jsx'));
const PublicEquipmentPayment     = lazy(() => import('./PublicEquipmentPayment.jsx'));
const PublicOnboardingForm       = lazy(() => import('./PublicOnboardingForm.jsx'));
const LeadIntakeForm             = lazy(() => import('./LeadIntakeForm.jsx'));
const PrivacyPolicy              = lazy(() => import('./PrivacyPolicy.jsx'));

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function LoginScreen() {
  const { profile } = useBusinessProfile();
  const brandName = profile.display_name || 'הרפתקאות';
  const brandLogo = profile.logo_url || '/logo.png';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [savePassword, setSavePassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    const trimmedEmail = email.trim();
    const { error: signInError } = await authClient.auth.signInWithPassword({
      email: trimmedEmail,
      password,
    });
    if (signInError) {
      setError('פרטי הכניסה אינם נכונים');
    } else if (savePassword && window.PasswordCredential && navigator.credentials?.store) {
      try {
        await navigator.credentials.store(new window.PasswordCredential({
          id: trimmedEmail,
          password,
          name: trimmedEmail,
        }));
      } catch {
        // Password saving remains under the browser's control.
      }
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError('יש להזין דואר אלקטרוני לאיפוס הסיסמה');
      setInfo('');
      return;
    }
    setResetting(true);
    setError('');
    setInfo('');
    const { error: resetError } = await authClient.auth.resetPasswordForEmail(trimmed, {
      redirectTo: window.location.origin,
    });
    if (resetError) {
      setError('לא הצלחנו לשלוח קישור לאיפוס. נסו שוב בעוד רגע.');
    } else {
      setInfo('נשלח קישור לאיפוס הסיסמה לדואר האלקטרוני שלכם.');
    }
    setResetting(false);
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <img src={brandLogo} alt={brandName} />
        </div>
        <h1>כניסה ל{brandName}</h1>
        <p>מערכת הניהול של קיר הטיפוס</p>
        <label className="form-label" htmlFor="crm-email">דואר אלקטרוני</label>
        <input
          id="crm-email"
          className="input"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label className="form-label" htmlFor="crm-password">סיסמה</label>
        <input
          id="crm-password"
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <label className="auth-save-password">
          <input
            type="checkbox"
            checked={savePassword}
            onChange={(event) => setSavePassword(event.target.checked)}
          />
          <span>שמירת הסיסמה במכשיר זה</span>
        </label>
        {error && <div className="alert alert-danger">{error}</div>}
        {info && <div className="alert alert-success">{info}</div>}
        <button className="btn btn-primary" type="submit" disabled={loading || resetting}>
          <LogIn size={17} />
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>
        <button
          className="btn btn-ghost"
          type="button"
          disabled={loading || resetting}
          onClick={handleResetPassword}
        >
          {resetting ? 'שולח קישור...' : 'שכחתי סיסמה'}
        </button>
      </form>
    </div>
  );
}

function NewPasswordScreen({ onDone }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    if (password.length < 6) {
      setError('הסיסמה חייבת לכלול לפחות 6 תווים');
      return;
    }
    if (password !== confirm) {
      setError('הסיסמאות אינן תואמות');
      return;
    }
    setLoading(true);
    setError('');
    const { error: updateError } = await authClient.auth.updateUser({ password });
    if (updateError) {
      setError('לא הצלחנו לעדכן את הסיסמה. נסו שוב.');
      setLoading(false);
      return;
    }
    setLoading(false);
    onDone?.();
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">
          <img src="/logo.png" alt="" />
        </div>
        <h1>סיסמה חדשה</h1>
        <p>בחרו סיסמה חדשה לחשבון שלכם</p>
        <label className="form-label" htmlFor="crm-new-password">סיסמה חדשה</label>
        <input
          id="crm-new-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={6}
        />
        <label className="form-label" htmlFor="crm-confirm-password">אימות סיסמה</label>
        <input
          id="crm-confirm-password"
          className="input"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          required
          minLength={6}
        />
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          <ShieldCheck size={17} />
          {loading ? 'שומר...' : 'שמירת סיסמה חדשה'}
        </button>
      </form>
    </div>
  );
}

export default function AuthGate({ children }) {
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recoveryMode, setRecoveryMode] = useState(false);
  // Identity only — token refresh must not remount the whole app.
  const userId = session?.user?.id || null;
  const onPublicPath = isPublicPath(location.pathname);

  useEffect(() => {
    if (onPublicPath) return undefined;
    if (!authClient) {
      setLoading(false);
      return undefined;
    }

    authClient.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      if (!data.session) setLoading(false);
    });
    const { data: subscription } = authClient.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecoveryMode(true);
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setRecoveryMode(false);
        setLoading(false);
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, [onPublicPath]);

  useEffect(() => {
    if (onPublicPath) return undefined;
    if (!userId || !session?.user) return;
    let active = true;
    const user = session.user;
    // Keep the existing UI visible when the same user is already loaded
    // (e.g. silent token refresh after switching browser tabs).
    const alreadyLoaded = profile?.id === userId;
    if (!alreadyLoaded) setLoading(true);

    const fallbackProfile = () => {
      const email = user?.email || '';
      const rawRole =
        user?.app_metadata?.crm_role ||
        user?.user_metadata?.crm_role ||
        '';
      const role = String(rawRole).toLowerCase();
      if (role === 'owner' || role === 'admin' || role === 'staff' || role === 'team') {
        return {
          id: user.id,
          email,
          name: user.user_metadata?.full_name || user.user_metadata?.name || email,
          role: role === 'admin' ? 'owner' : (role === 'team' ? 'staff' : role),
        };
      }
      return null;
    };

    fetch('/api/auth/me')
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || 'לא ניתן לאמת את ההרשאה');
        return body;
      })
      .then((body) => {
        if (active) {
          setProfile(body);
          setError('');
        }
      })
      .catch((loadError) => {
        if (!active) return;
        const localProfile = fallbackProfile();
        if (localProfile) {
          setProfile(localProfile);
          setError('');
          return;
        }
        setError(loadError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
    // Re-run only when the signed-in user changes — not on every token refresh.
  }, [userId, onPublicPath]); // eslint-disable-line react-hooks/exhaustive-deps -- intentionally keyed by userId only

  const value = useMemo(() => ({
    user: profile,
    role: profile?.role,
    isOwner: profile?.role === 'owner',
    signOut: () => authClient?.auth.signOut(),
  }), [profile]);

  // Public customer pages must never show staff login.
  // Prefer dedicated routes in main.jsx; this is defense in depth if a public URL hits the catch-all.
  if (onPublicPath) {
    const path = location.pathname;
    const publicFallback = <div style={{ padding: 40, textAlign: 'center', fontFamily: 'sans-serif' }}>טוען...</div>;
    let publicPage = null;
    if (path === '/health' || path.startsWith('/health/')) publicPage = <PublicOnboardingForm />;
    else if (path === '/onboard' || path.startsWith('/onboard/')) publicPage = <PublicOnboardingForm />;
    else if (path === '/join') publicPage = <LeadIntakeForm />;
    else if (path === '/privacy') publicPage = <PrivacyPolicy />;
    else if (path.startsWith('/event/')) publicPage = <PublicActivityRegistration />;
    else if (path.startsWith('/event-host/')) publicPage = <PublicHostPayment />;
    else if (path.startsWith('/equipment/')) publicPage = <PublicEquipmentPayment />;
    if (!publicPage) return null;
    return <Suspense fallback={publicFallback}>{publicPage}</Suspense>;
  }

  if (!authConfigured) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <ShieldCheck size={34} />
          <h1>הכניסה עדיין לא הוגדרה</h1>
          <p>יש להגדיר את כתובת Supabase ואת המפתח הציבורי בהגדרות האתר.</p>
        </div>
      </div>
    );
  }
  if (recoveryMode && session) {
    return (
      <NewPasswordScreen
        onDone={() => {
          setRecoveryMode(false);
          setLoading(true);
        }}
      />
    );
  }
  if (loading && !profile) return <div className="auth-page"><div className="auth-card">טוען את המערכת...</div></div>;
  if (!session) return <LoginScreen />;
  if (error || !profile) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <ShieldCheck size={34} />
          <h1>אין הרשאה לחשבון</h1>
          <p>{error || 'לחשבון הזה לא הוגדר תפקיד במערכת.'}</p>
          <button className="btn btn-ghost" type="button" onClick={() => authClient.auth.signOut()}>
            <LogOut size={17} /> יציאה
          </button>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
