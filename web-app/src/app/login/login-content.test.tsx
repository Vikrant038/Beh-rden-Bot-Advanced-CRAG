import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LoginContent } from "./login-content";

// vi.mock factories are hoisted above imports, so mutable references shared
// with the mocks must be created via vi.hoisted.
const { mockReplace, mockPush, mockUseSession, paramsRef } = vi.hoisted(() => ({
  mockReplace: vi.fn(),
  mockPush: vi.fn(),
  mockUseSession: vi.fn(),
  paramsRef: { current: new URLSearchParams() },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mockReplace, push: mockPush }),
  useSearchParams: () => paramsRef.current,
}));

vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
  signIn: vi.fn(),
}));

describe("LoginContent", () => {
  beforeEach(() => {
    mockReplace.mockClear();
    mockPush.mockClear();
    paramsRef.current = new URLSearchParams();
    mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the login card for unauthenticated visitors", () => {
    render(<LoginContent />);

    expect(screen.getByText("Welcome to Behörden-Bot")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Continue with GitHub" })).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("redirects an already signed-in user straight to /chat", () => {
    mockUseSession.mockReturnValue({ data: {}, status: "authenticated" });
    render(<LoginContent />);

    expect(mockReplace).toHaveBeenCalledWith("/chat");
  });

  it("keeps the login page when an OAuth error is present so the banner stays visible", () => {
    paramsRef.current = new URLSearchParams("error=AccessDenied");
    mockUseSession.mockReturnValue({ data: {}, status: "authenticated" });
    render(<LoginContent />);

    expect(mockReplace).not.toHaveBeenCalled();
    expect(
      screen.getByText("Access was denied. You may not have permission to sign in."),
    ).toBeInTheDocument();
  });

  it("shows the friendly OAuth error banner for unauthenticated visitors", () => {
    paramsRef.current = new URLSearchParams("error=OAuthAccountNotLinked");
    render(<LoginContent />);

    expect(
      screen.getByText(
        "Another account already uses this email. Sign in with the provider you used before.",
      ),
    ).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("falls back to the generic message for unknown OAuth errors", () => {
    paramsRef.current = new URLSearchParams("error=SomeMysteryError");
    render(<LoginContent />);

    expect(
      screen.getByText("Something went wrong during sign-in. Please try again."),
    ).toBeInTheDocument();
  });

  it("starts guest browsing and pushes to /chat on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    render(<LoginContent />);

    await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/chat"));
  });

  it("shows a pending state while the guest request is in flight", async () => {
    let resolveFetch!: (value: { ok: boolean }) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            resolveFetch = resolve;
          }),
      ),
    );
    render(<LoginContent />);

    fireEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
    expect(screen.getByRole("button", { name: "Starting…" })).toBeInTheDocument();

    resolveFetch({ ok: true });
    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/chat"));
  });

  it("shows the server error when the guest request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Guest browsing is unavailable right now." }),
      }),
    );
    render(<LoginContent />);

    await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
    expect(await screen.findByText("Guest browsing is unavailable right now.")).toBeInTheDocument();
  });

  it("falls back to a generic error when the guest request throws", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    render(<LoginContent />);

    await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
    expect(
      await screen.findByText("Could not start guest browsing. Please try again."),
    ).toBeInTheDocument();
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("falls back to a generic error when the guest response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => {
          throw new Error("not json");
        },
      }),
    );
    render(<LoginContent />);

    await userEvent.click(screen.getByRole("button", { name: "Continue as guest" }));
    expect(
      await screen.findByText("Could not start guest browsing. Please try again."),
    ).toBeInTheDocument();
  });
});
