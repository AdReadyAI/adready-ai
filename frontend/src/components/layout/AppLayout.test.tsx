import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session, User } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import AppLayout from "./AppLayout";

const authMocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("../../contexts/AuthContext", () => ({
  useAuth: authMocks.useAuth,
}));

function makeAuthValue(user: User | null = null) {
  return {
    user,
    session: user ? ({ user } as Session) : null,
    loading: false,
    signUp: vi.fn(),
    signIn: vi.fn(),
    signOut: authMocks.signOut,
    resetPassword: vi.fn(),
    updatePassword: vi.fn(),
    signInWithGoogle: vi.fn(),
  };
}

function renderLayout() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<p>Page body</p>} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AppLayout", () => {
  it("renders the signed-out header navigation", () => {
    authMocks.useAuth.mockReturnValue(makeAuthValue(null));

    renderLayout();

    expect(screen.getByText("AdReady AI")).toBeVisible();
    expect(screen.getByRole("link", { name: "Sign in" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Upload" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Result" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("renders the signed-in header navigation and wires sign out", async () => {
    const user = { id: "user-1", email: "user@example.com" } as User;
    authMocks.useAuth.mockReturnValue(makeAuthValue(user));

    renderLayout();

    expect(screen.getByRole("link", { name: "Upload" })).toBeVisible();
    expect(screen.getByRole("link", { name: "Result" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(authMocks.signOut).toHaveBeenCalledTimes(1);
  });
});
