import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import LockIcon from "../../components/icons/LockIcon";
import { useAuth } from "../../contexts/AuthContext";

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Unable to update password";
}

export default function UpdatePasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }

    setSubmitting(true);
    const { error } = await updatePassword(password);
    setSubmitting(false);

    if (error) {
      setError(getErrorMessage(error));
      return;
    }

    navigate("/auth/signin");
  }

  return (
    <div className="flex min-h-[calc(100vh-112px)] items-center justify-center bg-white px-6">
      <div className="w-full max-w-[460px] rounded-2xl border border-gray-100 bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.08)] sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-[#1A1A1A]">Choose a new password</h1>
          <p className="text-sm text-[#64748B]">Enter a new password for your AdReady.ai account.</p>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="new-password" className="mb-1.5 block text-sm font-medium text-[#1A1A1A]">
              New password
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <LockIcon className="h-5 w-5" />
              </div>
              <input
                id="new-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your new password"
                autoComplete="new-password"
                className="w-full rounded-lg border border-transparent bg-[#F3F4F6] py-2.5 pl-10 pr-3 text-gray-900 placeholder-gray-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#5D4FCF]"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={`w-full rounded-lg px-4 py-3 font-medium text-white shadow-md transition-all ${
              submitting ? "cursor-not-allowed bg-[#7A6BD6]" : "bg-[#5D4FCF] hover:bg-[#4a3cb8]"
            }`}
          >
            {submitting ? "Updating..." : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
