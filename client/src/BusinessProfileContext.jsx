import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

/**
 * Must match `server/businessProfile.js` exactly.
 *
 * The two had drifted into contradicting each other — the client called the
 * business "הרפתקאות" with no legal name, the server called it "קיר בועז"
 * with "הרפתקאות" as the legal one. That value is interpolated into the
 * liability waiver a parent signs, so a failed profile fetch produced a waiver
 * naming whichever entity the fallback happened to be. "קיר בועז" is the trade
 * name customers know; "הרפתקאות" is the registered business, and it is the
 * one that belongs in a waiver or a privacy policy.
 */
export const DEFAULT_BUSINESS_PROFILE = Object.freeze({
  display_name: 'קיר בועז',
  legal_name: 'הרפתקאות',
  vat_id: '',
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
