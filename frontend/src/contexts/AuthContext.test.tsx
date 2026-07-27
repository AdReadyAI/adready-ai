import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";

import { AuthProvider, useAuth } from "./AuthContext";

const supabaseMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signUp: vi.fn(),
  signInWithPassword: vi.fn(),
  signOut: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  updateUser: vi.fn(),
  signInWithOAuth: vi.fn(),
  setAuthSessionPersistence: vi.fn(),
}));

vi.mock("../lib/supabaseClient", () => ({
  setAuthSessionPersistence: supabaseMocks.setAuthSessionPersistence,
  supabase: {
    auth: {
      getSession: supabaseMocks.getSession,
      onAuthStateChange: supabaseMocks.onAuthStateChange,
      signUp: supabaseMocks.signUp,
      signInWithPassword: supabaseMocks.signInWithPassword,
      signOut: supabaseMocks.signOut,
      resetPasswordForEmail: supabaseMocks.resetPasswordForEmail,
      updateUser: supabaseMocks.updateUser,
      signInWithOAuth: supabaseMocks.signInWithOAuth,
    },
  },
}));

function makeUser(id: string, email = `${id}@example.com`): User {
  return {
    id,
    email,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-01-01T00:00:00.000Z",
  } as User;
}

function makeSession(user: User): Session {
  return {
    access_token: `access-token-${user.id}`,
    refresh_token: `refresh-token-${user.id}`,
    expires_in: 3600,
    token_type: "bearer",
    user,
  } as Session;
}

function mockAuthSubscription(unsubscribe = vi.fn()) {
  supabaseMocks.onAuthStateChange.mockReturnValue({
    data: {
      subscription: { unsubscribe },
    },
  });
  return unsubscribe;
}

function AuthStatus() {
  const auth = useAuth();

  return (
    <div>
      <div data-testid="loading">{auth.loading ? "loading" : "ready"}</div>
      <div data-testid="user">{auth.user?.email ?? "signed-out"}</div>
      <div data-testid="session">{auth.session?.access_token ?? "no-session"}</div>
    </div>
  );
}

function AuthActions() {
  const auth = useAuth();
  const [result, setResult] = useState("idle");

  return (
    <div>
      <AuthStatus />
      <div data-testid="result">{result}</div>
      <button
        type="button"
        onClick={async () => {
          const { error, session } = await auth.signUp("signup@example.com", "password123");
          setResult(`signup:${error ? "error" : "ok"}:${session ? "session" : "no-session"}`);
        }}
      >
        Sign up action
      </button>
      <button
        type="button"
        onClick={async () => {
          const { error } = await auth.signIn("signin@example.com", "password123", true);
          setResult(`signin:${error ? "error" : "ok"}`);
        }}
      >
        Sign in action
      </button>
      <button
        type="button"
        onClick={async () => {
          const { error } = await auth.signOut();
          setResult(`signout:${error ? "error" : "ok"}`);
        }}
      >
        Sign out action
      </button>
    </div>
  );
}

function renderAuthProvider(ui: ReactNode) {
  return render(<AuthProvider>{ui}</AuthProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
  mockAuthSubscription();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("AuthProvider", () => {
  it("hydrates the session on mount and flips loading to false", async () => {
    const user = makeUser("hydrated-user", "hydrated@example.com");
    const session = makeSession(user);
    supabaseMocks.getSession.mockResolvedValue({ data: { session }, error: null });

    renderAuthProvider(<AuthStatus />);

    expect(screen.getByTestId("loading")).toHaveTextContent("loading");

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));

    expect(screen.getByTestId("user")).toHaveTextContent("hydrated@example.com");
    expect(screen.getByTestId("session")).toHaveTextContent("access-token-hydrated-user");
    expect(supabaseMocks.getSession).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.onAuthStateChange).toHaveBeenCalledTimes(1);
  });

  it("reacts to auth state changes and unsubscribes on unmount", async () => {
    const unsubscribe = vi.fn();
    let authStateHandler: ((event: string, session: Session | null) => void) | undefined;
    supabaseMocks.onAuthStateChange.mockImplementation((handler) => {
      authStateHandler = handler;
      return {
        data: {
          subscription: { unsubscribe },
        },
      };
    });

    const { unmount } = renderAuthProvider(<AuthStatus />);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    expect(screen.getByTestId("user")).toHaveTextContent("signed-out");

    const user = makeUser("signed-in-user", "signedin@example.com");
    const session = makeSession(user);

    act(() => {
      authStateHandler?.("SIGNED_IN", session);
    });

    expect(screen.getByTestId("user")).toHaveTextContent("signedin@example.com");
    expect(screen.getByTestId("session")).toHaveTextContent("access-token-signed-in-user");

    act(() => {
      authStateHandler?.("SIGNED_OUT", null);
    });

    expect(screen.getByTestId("user")).toHaveTextContent("signed-out");
    expect(screen.getByTestId("session")).toHaveTextContent("no-session");

    unmount();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("updates context state when signUp succeeds", async () => {
    const user = makeUser("signup-user", "signup@example.com");
    const session = makeSession(user);
    supabaseMocks.signUp.mockResolvedValue({ data: { user, session }, error: null });

    renderAuthProvider(<AuthActions />);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    await userEvent.click(screen.getByRole("button", { name: "Sign up action" }));

    expect(supabaseMocks.signUp).toHaveBeenCalledWith({
      email: "signup@example.com",
      password: "password123",
    });
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("signup@example.com"));
    expect(screen.getByTestId("session")).toHaveTextContent("access-token-signup-user");
    expect(screen.getByTestId("result")).toHaveTextContent("signup:ok:session");
  });

  it("returns the signUp error without touching existing state", async () => {
    const existingUser = makeUser("existing-user", "existing@example.com");
    supabaseMocks.getSession.mockResolvedValue({
      data: { session: makeSession(existingUser) },
      error: null,
    });
    supabaseMocks.signUp.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Email already exists" },
    });

    renderAuthProvider(<AuthActions />);

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("existing@example.com"));
    await userEvent.click(screen.getByRole("button", { name: "Sign up action" }));

    expect(screen.getByTestId("result")).toHaveTextContent("signup:error:no-session");
    expect(screen.getByTestId("user")).toHaveTextContent("existing@example.com");
    expect(screen.getByTestId("session")).toHaveTextContent("access-token-existing-user");
  });

  it("updates context state when signIn succeeds", async () => {
    const user = makeUser("signin-user", "signin@example.com");
    const session = makeSession(user);
    supabaseMocks.signInWithPassword.mockResolvedValue({ data: { user, session }, error: null });

    renderAuthProvider(<AuthActions />);

    await waitFor(() => expect(screen.getByTestId("loading")).toHaveTextContent("ready"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in action" }));

    expect(supabaseMocks.setAuthSessionPersistence).toHaveBeenCalledWith(true);
    expect(supabaseMocks.signInWithPassword).toHaveBeenCalledWith({
      email: "signin@example.com",
      password: "password123",
    });
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("signin@example.com"));
    expect(screen.getByTestId("session")).toHaveTextContent("access-token-signin-user");
    expect(screen.getByTestId("result")).toHaveTextContent("signin:ok");
  });

  it("returns the signIn error without touching existing state", async () => {
    const existingUser = makeUser("existing-user", "existing@example.com");
    supabaseMocks.getSession.mockResolvedValue({
      data: { session: makeSession(existingUser) },
      error: null,
    });
    supabaseMocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: "Invalid credentials" },
    });

    renderAuthProvider(<AuthActions />);

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("existing@example.com"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in action" }));

    expect(screen.getByTestId("result")).toHaveTextContent("signin:error");
    expect(screen.getByTestId("user")).toHaveTextContent("existing@example.com");
    expect(screen.getByTestId("session")).toHaveTextContent("access-token-existing-user");
  });

  it("clears user and session when signOut succeeds", async () => {
    const existingUser = makeUser("existing-user", "existing@example.com");
    supabaseMocks.getSession.mockResolvedValue({
      data: { session: makeSession(existingUser) },
      error: null,
    });
    supabaseMocks.signOut.mockResolvedValue({ error: null });

    renderAuthProvider(<AuthActions />);

    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("existing@example.com"));
    await userEvent.click(screen.getByRole("button", { name: "Sign out action" }));

    expect(supabaseMocks.signOut).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("user")).toHaveTextContent("signed-out"));
    expect(screen.getByTestId("session")).toHaveTextContent("no-session");
    expect(screen.getByTestId("result")).toHaveTextContent("signout:ok");
  });
});
