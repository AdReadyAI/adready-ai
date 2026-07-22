import { render, screen } from "@testing-library/react";
import type { Session, User } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ProtectedRoute from "./ProtectedRoute";

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: authMocks.useAuth,
}));

function makeUser(): User {
  return { id: "user-1", email: "user@example.com" } as User;
}

function makeAuthValue(overrides: Partial<ReturnType<typeof authMocks.useAuth>> = {}) {
  return {
    user: null,
    session: null,
    loading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    signInWithGoogle: vi.fn(),
    ...overrides,
  };
}

function renderProtectedRoute() {
  return render(
    <MemoryRouter initialEntries={["/private"]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="/private" element={<h1>Private content</h1>} />
        </Route>
        <Route path="/auth/signin" element={<h1>Sign in page</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ProtectedRoute", () => {
  it("renders nothing while auth is loading", () => {
    authMocks.useAuth.mockReturnValue(makeAuthValue({ loading: true }));

    const { container } = renderProtectedRoute();

    expect(container).toBeEmptyDOMElement();
  });

  it("redirects signed-out users to the sign-in page", async () => {
    authMocks.useAuth.mockReturnValue(makeAuthValue({ user: null, loading: false }));

    renderProtectedRoute();

    expect(await screen.findByRole("heading", { name: "Sign in page" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Private content" })).not.toBeInTheDocument();
  });

  it("renders the protected outlet when a user is present", () => {
    const user = makeUser();
    authMocks.useAuth.mockReturnValue(
      makeAuthValue({
        user,
        session: { user } as Session,
      }),
    );

    renderProtectedRoute();

    expect(screen.getByRole("heading", { name: "Private content" })).toBeVisible();
  });
});
