import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import EyeIcon from "../../components/icons/EyeIcon";
import EyeOffIcon from "../../components/icons/EyeOffIcon";
import GoogleIcon from "../../components/icons/GoogleIcon";
import LockIcon from "../../components/icons/LockIcon";
import MailIcon from "../../components/icons/MailIcon";
import MagnifyingGlassIcon from "../../components/icons/MagnifyingGlassIcon";
import RocketIcon from "../../components/icons/RocketIcon";
import TrophyIcon from "../../components/icons/TrophyIcon";
import { useAuth } from "../../contexts/AuthContext";

type AuthMode = "signin" | "signup";

type SignInPageProps = {
  initialMode?: AuthMode;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return fallback;
}

export default function SignInPage({ initialMode = "signin" }: SignInPageProps) {
  const { signIn, signUp, signInWithGoogle } = useAuth();
  const navigate = useNavigate();
  const rememberedEmail =
    typeof window === "undefined" ? "" : window.localStorage.getItem("adready:signin-email") ?? "";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(rememberedEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(Boolean(rememberedEmail));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  const isSignUp = mode === "signup";

  useEffect(() => {
    setMode(initialMode);
    setError(null);
    setConfirmationSent(false);
    setPassword("");
  }, [initialMode]);

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setError(null);
    setConfirmationSent(false);
    setPassword("");
  }

  function validateForm() {
    if (!email.trim()) {
      setError("Email is required.");
      return false;
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError("Please enter a valid email address.");
      return false;
    }

    if (!password) {
      setError("Password is required.");
      return false;
    }

    if (isSignUp && password.length < 6) {
      setError("Password must be at least 6 characters.");
      return false;
    }

    return true;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setConfirmationSent(false);
    if (!validateForm()) return;

    setSubmitting(true);

    if (isSignUp) {
      const { error, session } = await signUp(email, password);
      setSubmitting(false);

      if (error) {
        setError(getErrorMessage(error, "Sign up failed"));
        return;
      }

      if (session) {
        navigate("/upload");
        return;
      }

      setConfirmationSent(true);
      return;
    }

    const { error } = await signIn(email, password);
    setSubmitting(false);

    if (error) {
      setError(getErrorMessage(error, "Log in failed"));
      return;
    }

    if (rememberMe) {
      window.localStorage.setItem("adready:signin-email", email);
    } else {
      window.localStorage.removeItem("adready:signin-email");
    }

    navigate("/upload");
  }

  async function handleGoogleSignIn() {
    setError(null);
    setConfirmationSent(false);
    const { error } = await signInWithGoogle();
    if (error) setError(getErrorMessage(error, "Google sign-in failed"));
  }

  return (
    <div className="flex min-h-[calc(100vh-112px)] overflow-hidden rounded-2xl border border-slate-100 bg-white shadow-[0_8px_30px_rgb(15,23,42,0.08)]">
      <div className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-[#F5F3FF] p-12 lg:flex">
        <div className="pointer-events-none absolute right-[-12%] top-[-24%] h-[520px] w-[520px] rounded-full bg-purple-200 opacity-50 blur-[80px]" />

        <div className="relative z-10">
          <div className="mb-12 flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-[#5D4FCF]" />
            <span className="text-3xl font-bold text-[#3D3D3D]">AdReady AI</span>
          </div>

          <h1 className="mb-4 text-[42px] font-bold leading-[1.1] text-[#1A1A1A]">
            Ship ads with confidence
          </h1>
          <p className="mb-16 text-lg text-[#64748B]">
            Review AI-generated ads before launch.
          </p>

          <div className="space-y-10">
            <FeatureItem
              icon={<MagnifyingGlassIcon className="h-6 w-6 text-[#1A1A1A]" />}
              title="Verify product claims"
              description="Catch false or unsupported claims before they go live"
            />
            <FeatureItem
              icon={<RocketIcon className="h-6 w-6 text-[#1A1A1A]" />}
              title="Detect missing CTAs"
              description="Make sure every ad drives action"
            />
            <FeatureItem
              icon={<TrophyIcon className="h-6 w-6 text-[#1A1A1A]" />}
              title="Rank best creative"
              description="Know which video to ship with confidence"
            />
          </div>
        </div>

        <div className="relative z-10 mt-10 flex items-center gap-2 text-sm text-[#64748B]">
          <LockIcon className="h-4 w-4" />
          <span>Secure. Private. Built for performance.</span>
        </div>
      </div>

      <div className="flex flex-1 items-center justify-center bg-white p-6 sm:p-8">
        <div className="w-full max-w-[460px] rounded-2xl border border-gray-100 bg-white p-8 shadow-[0_8px_30px_rgb(0,0,0,0.08)] sm:p-10">
          <div className="mb-8 text-center lg:hidden">
            <div className="mb-3 flex items-center justify-center gap-3">
              <div className="h-8 w-8 rounded-full bg-[#5D4FCF]" />
              <span className="text-2xl font-bold text-[#3D3D3D]">AdReady AI</span>
            </div>
            <p className="text-sm font-medium text-[#64748B]">Ship ads with confidence</p>
          </div>

          <div className="mb-6 rounded-lg bg-[#F3F4F6] p-1">
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => switchMode("signin")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  !isSignUp ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#64748B] hover:text-[#1A1A1A]"
                }`}
              >
                Log in
              </button>
              <button
                type="button"
                onClick={() => switchMode("signup")}
                className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                  isSignUp ? "bg-white text-[#1A1A1A] shadow-sm" : "text-[#64748B] hover:text-[#1A1A1A]"
                }`}
              >
                Sign up
              </button>
            </div>
          </div>

          <div className="mb-8 text-center">
            <h2 className="mb-2 text-3xl font-bold text-[#1A1A1A]">
              {isSignUp ? "Create your account" : "Welcome back"}
            </h2>
            <p className="text-sm text-[#64748B]">
              {isSignUp ? "Start reviewing ads with AdReady.ai" : "Log in to your AdReady.ai account"}
            </p>
          </div>

          {error && (
            <div className="mb-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">
              {error}
            </div>
          )}

          {confirmationSent && (
            <div className="mb-6 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
              Check your email to confirm your account, then log in.
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-200 bg-white py-2.5 transition-colors hover:bg-gray-50"
          >
            <GoogleIcon className="h-5 w-5" />
            <span className="text-sm font-medium text-gray-700">Continue with Google</span>
          </button>

          <div className="relative flex items-center py-6">
            <div className="flex-grow border-t border-gray-200" />
            <span className="mx-4 flex-shrink text-xs font-medium text-gray-400">or</span>
            <div className="flex-grow border-t border-gray-200" />
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="auth-email" className="mb-1.5 block text-sm font-medium text-[#1A1A1A]">
                Email
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <MailIcon className="h-5 w-5" />
                </div>
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  autoComplete="email"
                  className="w-full rounded-lg border border-transparent bg-[#F3F4F6] py-2.5 pl-10 pr-3 text-gray-900 placeholder-gray-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#5D4FCF]"
                />
              </div>
            </div>

            <div>
              <label htmlFor="auth-password" className="mb-1.5 block text-sm font-medium text-[#1A1A1A]">
                Password
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-gray-400">
                  <LockIcon className="h-5 w-5" />
                </div>
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignUp ? "Create a password" : "Enter your password"}
                  autoComplete={isSignUp ? "new-password" : "current-password"}
                  className="w-full rounded-lg border border-transparent bg-[#F3F4F6] py-2.5 pl-10 pr-10 text-gray-900 placeholder-gray-400 transition-all focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[#5D4FCF]"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 transition-colors hover:text-gray-600 focus:outline-none"
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                </button>
              </div>
            </div>

            {!isSignUp && (
              <div className="mt-4 flex items-center justify-between">
                <label className="flex cursor-pointer items-center text-sm text-[#64748B]">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="mr-2 h-4 w-4 rounded border-gray-300 text-[#5D4FCF] focus:ring-[#5D4FCF]"
                  />
                  Remember me
                </label>
                <Link
                  to="/auth/forgot-password"
                  className="text-sm font-medium text-[#5D4FCF] transition-colors hover:text-[#4a3cb8]"
                >
                  Forgot password?
                </Link>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className={`w-full rounded-lg px-4 py-3 font-medium text-white shadow-md transition-all ${
                submitting ? "cursor-not-allowed bg-[#7A6BD6]" : "bg-[#5D4FCF] hover:bg-[#4a3cb8]"
              }`}
            >
              {submitting ? (isSignUp ? "Creating account..." : "Logging in...") : isSignUp ? "Sign up" : "Log in"}
            </button>
          </form>

          <div className="mt-8 text-center text-sm text-[#64748B]">
            <span>{isSignUp ? "Already have an account? " : "New to AdReady.ai? "}</span>
            <button
              type="button"
              onClick={() => switchMode(isSignUp ? "signin" : "signup")}
              className="font-medium text-[#5D4FCF] transition-colors hover:text-[#4a3cb8]"
            >
              {isSignUp ? "Log in" : "Create an account"}
            </button>
          </div>

          <div className="mt-4 text-center text-xs text-[#9CA3AF]">
            By continuing, you agree to our{" "}
            <Link to="/terms" className="underline transition-colors hover:text-[#5D4FCF]">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link to="/privacy" className="underline transition-colors hover:text-[#5D4FCF]">
              Privacy Policy
            </Link>
            .
          </div>
        </div>
      </div>
    </div>
  );
}

function FeatureItem({
  icon,
  title,
  description,
}: {
  icon: ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-4">
      <div className="flex-shrink-0 rounded-lg border border-gray-100 bg-white/80 p-2 shadow-sm">
        {icon}
      </div>
      <div>
        <h2 className="font-semibold text-[#1A1A1A]">{title}</h2>
        <p className="mt-0.5 text-sm text-[#64748B]">{description}</p>
      </div>
    </div>
  );
}
