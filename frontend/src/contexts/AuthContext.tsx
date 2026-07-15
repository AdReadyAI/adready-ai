import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { User, Session } from "@supabase/supabase-js";
import { supabase } from "../lib/supabaseClient";
import { signUp, signIn, signOut, signInWithGoogle } from "../lib/auth";

type AuthContextValue = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signUp: (email: string, password: string) => Promise<{ error: unknown }>;
  signIn: (email: string, password: string) => Promise<{ error: unknown }>;
  signOut: () => Promise<{ error: unknown }>;
  signInWithGoogle: () => Promise<{ error: unknown }>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signUp: async (email, password) => {
          const { data, error } = await signUp(email, password);
          if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
          }
          return { error };
        },
        signIn: async (email, password) => {
          const { data, error } = await signIn(email, password);
          if (data.session) {
            setSession(data.session);
            setUser(data.session.user);
          }
          return { error };
        },
        signOut: async () => {
          const { error } = await signOut();
          if (!error) {
            setSession(null);
            setUser(null);
          }
          return { error };
        },
        signInWithGoogle: async () => {
          const { error } = await signInWithGoogle();
          return { error };
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
