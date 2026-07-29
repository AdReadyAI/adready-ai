import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabaseClient";

export default function AuthCallbackPage() {
  const navigate = useNavigate();

  useEffect(() => {
    supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN") {
        navigate("/upload", { replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <p className="text-sm text-slate-500">Completing sign-in…</p>
    </div>
  );
}
