import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import MailIcon from "../../components/icons/MailIcon";
import { useAuth } from "../../contexts/AuthContext";
import { getErrorMessage } from "../../lib/errorMessage";

export default function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSent(false);

    if (!email.trim()) {
      setError("Email is required.");
      return;
    }

    setSubmitting(true);
    const { error } = await resetPassword(email);
    setSubmitting(false);

    if (error) {
      setError(getErrorMessage(error, "Unable to send password reset email"));
      return;
    }

    setSent(true);
  }

  return (
    <div className="flex min-h-[calc(100vh-112px)] items-center justify-center bg-white px-6">
      <div className="w-full max-w-[460px] rounded-2xl border border-gray-100 bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.08)] sm:p-10">
        <div className="mb-8 text-center">
          <h1 className="mb-2 text-3xl font-bold text-[#1A1A1A]">Reset your password</h1>
          <p className="text-sm text-[#64748B]">
            Enter your email and we will send you a password reset link.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {sent && (
          <div className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            Check your email for the reset link.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="reset-email" className="mb-1.5 block text-sm font-medium text-[#1A1A1A]">
              Email
            </label>
            <div className="relative">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                <MailIcon className="h-5 w-5" />
              </div>
              <input
                id="reset-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
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
            {submitting ? "Sending..." : "Send reset link"}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-[#64748B]">
          <Link to="/auth/signin" className="font-medium text-[#5D4FCF] transition-colors hover:text-[#4a3cb8]">
            Back to sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
