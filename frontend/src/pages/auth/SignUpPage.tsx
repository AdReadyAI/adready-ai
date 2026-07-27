import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../../contexts/AuthContext";

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "Sign up failed";
}

export default function SignUpPage() {
  const { signUp } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationSent, setConfirmationSent] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error, session } = await signUp(email, password);
    setSubmitting(false);
    if (error) {
      setError(getErrorMessage(error));
      return;
    }
    if (session) {
      navigate("/upload");
    } else {
      setConfirmationSent(true);
    }
  }

  if (confirmationSent) {
    return <p>Check your email to confirm your account, then sign in.</p>;
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Sign up</h1>
      <div>
        <label htmlFor="signup-email">Email</label>
        <input
          id="signup-email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </div>
      <div>
        <label htmlFor="signup-password">Password</label>
        <input
          id="signup-password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </div>
      {error && <p>{error}</p>}
      <button type="submit" disabled={submitting}>
        {submitting ? "Signing up..." : "Sign up"}
      </button>
      <p>
        Already have an account? <Link to="/auth/signin">Sign in</Link>
      </p>
    </form>
  );
}
