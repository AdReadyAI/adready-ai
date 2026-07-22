import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import SignInPage from "./SignInPage";

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithGoogle: vi.fn(),
  signOut: vi.fn(),
  resetPassword: vi.fn(),
  updatePassword: vi.fn(),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: () => ({
    user: null,
    session: null,
    loading: false,
    signIn: authMocks.signIn,
    signUp: authMocks.signUp,
    signInWithGoogle: authMocks.signInWithGoogle,
    signOut: authMocks.signOut,
    resetPassword: authMocks.resetPassword,
    updatePassword: authMocks.updatePassword,
  }),
}));

function renderAuthRoutes(initialEntry = "/auth/signin") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/auth/signin" element={<SignInPage />} />
        <Route path="/auth/signup" element={<SignInPage initialMode="signup" />} />
        <Route path="/upload" element={<h1>Upload route</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

function submitButton(name: RegExp) {
  const form = screen.getByLabelText("Email").closest("form");
  if (!form) throw new Error("Expected auth form to render");
  return within(form).getByRole("button", { name });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  authMocks.signIn.mockResolvedValue({ error: null });
  authMocks.signUp.mockResolvedValue({ error: null, session: null });
  authMocks.signInWithGoogle.mockResolvedValue({ error: null });
});

describe("SignInPage", () => {
  it("calls signIn on valid submit and navigates on success", async () => {
    const user = userEvent.setup();
    renderAuthRoutes();

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(submitButton(/^log in$/i));

    expect(authMocks.signIn).toHaveBeenCalledWith("person@example.com", "password123", false);
    expect(await screen.findByRole("heading", { name: "Upload route" })).toBeVisible();
  });

  it("renders the sign-in error message on failure", async () => {
    const user = userEvent.setup();
    authMocks.signIn.mockResolvedValue({ error: { message: "Invalid credentials" } });
    renderAuthRoutes();

    await user.type(screen.getByLabelText("Email"), "person@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(submitButton(/^log in$/i));

    expect(await screen.findByText("Invalid credentials")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Upload route" })).not.toBeInTheDocument();
  });

  it("calls signInWithGoogle when the Google button is clicked", async () => {
    const user = userEvent.setup();
    renderAuthRoutes();

    await user.click(screen.getByRole("button", { name: "Continue with Google" }));

    expect(authMocks.signInWithGoogle).toHaveBeenCalledTimes(1);
  });
});

describe("SignUpPage", () => {
  it("calls signUp on valid submit and navigates when a session is returned", async () => {
    const user = userEvent.setup();
    authMocks.signUp.mockResolvedValue({
      error: null,
      session: { access_token: "signup-token" } as Session,
    });
    renderAuthRoutes("/auth/signup");

    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(submitButton(/^sign up$/i));

    expect(authMocks.signUp).toHaveBeenCalledWith("new@example.com", "password123");
    expect(await screen.findByRole("heading", { name: "Upload route" })).toBeVisible();
  });

  it("renders the sign-up error message on failure", async () => {
    const user = userEvent.setup();
    authMocks.signUp.mockResolvedValue({
      error: { message: "Email already registered" },
      session: null,
    });
    renderAuthRoutes("/auth/signup");

    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(submitButton(/^sign up$/i));

    expect(await screen.findByText("Email already registered")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Upload route" })).not.toBeInTheDocument();
  });

  it("shows the confirmation prompt when signUp succeeds without a session", async () => {
    const user = userEvent.setup();
    renderAuthRoutes("/auth/signup");

    await user.type(screen.getByLabelText("Email"), "new@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm password"), "password123");
    await user.click(submitButton(/^sign up$/i));

    await waitFor(() => expect(authMocks.signUp).toHaveBeenCalledWith("new@example.com", "password123"));
    expect(screen.getByText("Check your email to confirm your account, then log in.")).toBeVisible();
  });
});
