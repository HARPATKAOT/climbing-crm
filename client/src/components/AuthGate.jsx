import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { LogIn, LogOut, ShieldCheck } from 'lucide-react';
import { authClient, authConfigured } from '../authClient.js';

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    const { error: signInError } = await authClient.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (signInError) setError('פרטי הכניסה אינם נכונים');
    setLoading(false);
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-logo">🧗</div>
        <h1>כניסה ל־My Wall</h1>
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
        {error && <div className="alert alert-danger">{error}</div>}
        <button className="btn btn-primary" type="submit" disabled={loading}>
          <LogIn size={17} />
          {loading ? 'מתחבר...' : 'כניסה'}
        </button>
      </form>
    </div>
  );
}

export default function AuthGate({ children }) {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!authClient) {
      setLoading(false);
      return undefined;
    }

    authClient.auth.getSession().then(({ data }) => {
      setSession(data.session || null);
      if (!data.session) setLoading(false);
    });
    const { data: subscription } = authClient.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      if (!nextSession) {
        setProfile(null);
        setLoading(false);
      }
    });
    return () => subscription.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    let active = true;
    setLoading(true);

    const fallbackProfile = () => {
      const email = session.user?.email || '';
      const rawRole =
        session.user?.app_metadata?.crm_role ||
        session.user?.user_metadata?.crm_role ||
        '';
      const role = String(rawRole).toLowerCase();
      if (role === 'owner' || role === 'admin' || role === 'staff' || role === 'team') {
        return {
          id: session.user.id,
          email,
          name: session.user.user_metadata?.full_name || session.user.user_metadata?.name || email,
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
  }, [session]);

  const value = useMemo(() => ({
    user: profile,
    role: profile?.role,
    isOwner: profile?.role === 'owner',
    signOut: () => authClient?.auth.signOut(),
  }), [profile]);

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
  if (loading) return <div className="auth-page"><div className="auth-card">טוען את המערכת...</div></div>;
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
