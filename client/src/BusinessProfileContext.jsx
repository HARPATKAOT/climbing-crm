import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

export const DEFAULT_BUSINESS_PROFILE = Object.freeze({
  display_name: 'הרפתקאות',
  legal_name: '',
  logo_url: '/logo.png',
  phone: '',
  email: '',
  address: '',
  website_url: '',
});

const BusinessProfileContext = createContext({
  profile: DEFAULT_BUSINESS_PROFILE,
  loading: true,
  refresh: async () => {},
  applyProfile: () => {},
  legalName: DEFAULT_BUSINESS_PROFILE.display_name,
});

export function legalBusinessName(profile) {
  const legal = String(profile?.legal_name || '').trim();
  if (legal) return legal;
  return String(profile?.display_name || '').trim() || DEFAULT_BUSINESS_PROFILE.display_name;
}

export function BusinessProfileProvider({ children }) {
  const [profile, setProfile] = useState(DEFAULT_BUSINESS_PROFILE);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/public/business-profile');
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && typeof data === 'object') {
        setProfile({ ...DEFAULT_BUSINESS_PROFILE, ...data });
      }
    } catch {
      /* keep defaults */
    } finally {
      setLoading(false);
    }
  }, []);

  const applyProfile = useCallback((next) => {
    if (!next || typeof next !== 'object') return;
    setProfile({ ...DEFAULT_BUSINESS_PROFILE, ...next });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(() => ({
    profile,
    loading,
    refresh,
    applyProfile,
    legalName: legalBusinessName(profile),
  }), [profile, loading, refresh, applyProfile]);

  return (
    <BusinessProfileContext.Provider value={value}>
      {children}
    </BusinessProfileContext.Provider>
  );
}

export function useBusinessProfile() {
  return useContext(BusinessProfileContext);
}
