import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

export const LoginPage: React.FC = () => {
  const navigate = useNavigate();

  // State Management
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // 1. Client-side validation (non-empty, valid email format)
  const validateForm = () => {
    setError(null);

    if (!email.trim()) {
      setError('Email is required.');
      return false;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      setError('Please enter a valid email address.');
      return false;
    }

    if (!password) {
      setError('Password is required.');
      return false;
    }

    return true;
  };

  // 2. Form submission handler (UI only, no backend call)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // If validation fails, stop execution
    if (!validateForm()) return;

    // Validation passed, show loading state
    setLoading(true);

    // Simulating a slight delay for UX (Prevent double clicks, no backend)
    setTimeout(() => {
      setLoading(false);
      
      console.log('✅ Client-side validation passed.');
      console.log('👉 Replace the `setTimeout` block with your actual Supabase sign-in logic later.');
      console.log('🚀 Redirecting to /dashboard (Change this path according to Task 3)');

      // Trigger redirect on success (Task 3)
      navigate('/dashboard'); 
    }, 400);
  };

  return (
    <div className="flex min-h-screen bg-white">
      {/* Left Side: Branding & Features */}
      <div className="hidden lg:flex flex-1 flex-col justify-between bg-[#F5F3FF] p-16 relative overflow-hidden">
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-purple-200 rounded-full blur-[80px] opacity-50 pointer-events-none" />
        
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-8 h-8 rounded-full bg-[#5D4FCF]" />
            <h1 className="text-3xl font-bold text-[#3D3D3D]">AdReady AI</h1>
          </div>

          <h2 className="text-[42px] leading-[1.1] font-bold text-[#1A1A1A] mb-4">
            Ship ads with <span className="text-[#1E1E1E]">confidence.</span>
          </h2>
          <p className="text-[#64748B] text-lg mb-16">
            Review AI-generated ads before launch.
          </p>

          <div className="space-y-10">
            <FeatureItem
              icon={<MagnifyingGlassIcon />}
              title="Verify product claims"
              description="Catch false or unsupported claims before they go live"
            />
            <FeatureItem
              icon={<RocketIcon />}
              title="Detect missing CTAs"
              description="Make sure every ad drives action"
            />
            <FeatureItem
              icon={<TrophyIcon />}
              title="Rank best creative"
              description="Know which video to ship with confidence"
            />
          </div>
        </div>

        <div className="relative z-10 flex items-center gap-2 text-sm text-[#64748B] mt-10">
          <LockIcon className="w-4 h-4" />
          <span>Secure. Private. Built for performance.</span>
        </div>
      </div>

      {/* Right Side: Login Form */}
      <div className="flex-1 flex items-center justify-center p-8 bg-white">
        <div className="w-full max-w-[460px] bg-white shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-2xl p-10 border border-gray-100">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-[#1A1A1A] mb-2">Welcome back</h2>
            <p className="text-[#64748B] text-sm">Sign in to your AdReady.ai account</p>
          </div>

          {/* Error message (Visible and non-crashing) */}
          {error && (
            <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-md text-red-600 text-sm flex items-center">
              <span className="mr-2">⚠️</span>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            {/* Email Input */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-[#1A1A1A] mb-1.5">
                Email
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <MailIcon className="w-5 h-5" />
                </div>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-10 pr-3 py-2.5 bg-[#F3F4F6] border border-transparent rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5D4FCF] focus:border-transparent transition-all"
                />
              </div>
            </div>

            {/* Password Input */}
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-[#1A1A1A] mb-1.5">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
                  <LockIcon className="w-5 h-5" />
                </div>
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full pl-10 pr-10 py-2.5 bg-[#F3F4F6] border border-transparent rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#5D4FCF] focus:border-transparent transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600 focus:outline-none"
                >
                  {showPassword ? <EyeOffIcon className="w-5 h-5" /> : <EyeIcon className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between mt-4">
              <label className="flex items-center cursor-pointer text-sm text-[#64748B]">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 text-[#5D4FCF] border-gray-300 rounded focus:ring-[#5D4FCF] mr-2"
                />
                Remember me
              </label>
              <a href="#" className="text-sm font-medium text-[#5D4FCF] hover:text-[#4a3cb8] transition-colors">
                Forgot password?
              </a>
            </div>

            {/* Sign In Button */}
            <button
              type="submit"
              disabled={loading}
              className={`w-full py-3 px-4 rounded-lg text-white font-medium shadow-md transition-all
                ${loading ? 'bg-[#7A6BD6] cursor-not-allowed' : 'bg-[#5D4FCF] hover:bg-[#4a3cb8]'}`}
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </form>

          <div className="relative flex py-6 items-center">
            <div className="flex-grow border-t border-gray-200"></div>
            <span className="flex-shrink mx-4 text-xs text-gray-400 font-medium">or</span>
            <div className="flex-grow border-t border-gray-200"></div>
          </div>

          <button
            type="button"
            className="w-full flex items-center justify-center gap-3 py-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            <GoogleIcon className="w-5 h-5" />
            <span className="text-sm font-medium text-gray-700">Continue with Google</span>
          </button>

          <div className="mt-8 text-center text-sm text-[#64748B]">
            <span>New to AdReady.ai? </span>
            <a href="#" className="font-medium text-[#5D4FCF] hover:text-[#4a3cb8]">
              Create an account
            </a>
          </div>
          <div className="mt-4 text-center text-xs text-[#9CA3AF]">
            By continuing, you agree to our <a href="#" className="underline hover:text-[#5D4FCF]">Terms of Service</a> and <a href="#" className="underline hover:text-[#5D4FCF]">Privacy Policy</a>.
          </div>
        </div>
      </div>
    </div>
  );
};

// --- Helper Components & SVG Icons (Inline to avoid 3rd-party dependencies) ---

const FeatureItem = ({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) => (
  <div className="flex items-start gap-4">
    <div className="flex-shrink-0 p-2 bg-white/80 rounded-lg shadow-sm border border-gray-100">
      {icon}
    </div>
    <div>
      <h4 className="font-semibold text-[#1A1A1A]">{title}</h4>
      <p className="text-sm text-[#64748B] mt-0.5">{description}</p>
    </div>
  </div>
);

const MagnifyingGlassIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>);
const RocketIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.5-.6.6-1.5.5-2.5l-1.5-1.5-.5.5c-1 1-2 2-1.5 1.5zM12 2c-6 8-6 12-6 12 .7 2 3 4 6 4s5.3-2 6-4c0 0 0-4-6-12z" /><path d="M11 8a1 1 0 1 0 2 0 1 1 0 0 0-2 0M12 14a4 4 0 0 0-4 4v1h8v-1a4 4 0 0 0-4-4" /></svg>);
const TrophyIcon = () => (<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1A1A1A" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" /><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" /><path d="M4 22h16" /><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" /><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" /><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" /></svg>);
const LockIcon = ({ className }: { className?: string }) => (<svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>);
const MailIcon = ({ className }: { className?: string }) => (<svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>);
const EyeIcon = ({ className }: { className?: string }) => (<svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" /><circle cx="12" cy="12" r="3" /></svg>);
const EyeOffIcon = ({ className }: { className?: string }) => (<svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" /><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" /><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" /><line x1="2" x2="22" y1="2" y2="22" /></svg>);
const GoogleIcon = ({ className }: { className?: string }) => (<svg className={className} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4" /><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" /><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" /><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" /></svg>);