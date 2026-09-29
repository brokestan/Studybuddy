"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { clearProfile, loadProfile, saveProfile, type Profile } from "@/lib/client/profile";

interface Ctx {
  profile: Profile | null;
  ready: boolean;
  setProfile: (p: Profile) => void;
  signOut: () => void;
}
const C = createContext<Ctx | null>(null);

export function ProfileProvider({ children }: { children: React.ReactNode }) {
  const [profile, setP] = useState<Profile | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setP(loadProfile());
    setReady(true);
  }, []);
  const setProfile = useCallback((p: Profile) => {
    saveProfile(p);
    setP(p);
  }, []);
  const signOut = useCallback(() => {
    clearProfile();
    setP(null);
  }, []);
  const v = useMemo(() => ({ profile, ready, setProfile, signOut }), [profile, ready, setProfile, signOut]);
  return <C.Provider value={v}>{children}</C.Provider>;
}

export function useProfile(): Ctx {
  const v = useContext(C);
  if (!v) throw new Error("useProfile must be used inside ProfileProvider");
  return v;
}
