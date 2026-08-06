import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeToggle } from "./theme-toggle";

const { mockUseTheme, setThemeMock } = vi.hoisted(() => ({
  mockUseTheme: vi.fn(),
  setThemeMock: vi.fn(),
}));

vi.mock("next-themes", () => ({
  useTheme: () => mockUseTheme(),
}));

describe("ThemeToggle", () => {
  beforeEach(() => {
    setThemeMock.mockClear();
    mockUseTheme.mockReturnValue({ resolvedTheme: "dark", setTheme: setThemeMock });
  });

  it("renders light/dark/system radios and highlights the resolved theme", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("radio", { name: "Light" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Dark" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "System" })).toHaveAttribute("aria-checked", "false");
  });

  it("switches the theme when a radio is clicked", () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole("radio", { name: "Light" }));
    expect(setThemeMock).toHaveBeenCalledWith("light");
    fireEvent.click(screen.getByRole("radio", { name: "System" }));
    expect(setThemeMock).toHaveBeenCalledWith("system");
  });

  it("renders a compact single-button toggle that flips the current theme", () => {
    mockUseTheme.mockReturnValue({ resolvedTheme: "light", setTheme: setThemeMock });
    render(<ThemeToggle compact />);

    const button = screen.getByRole("button", { name: "Switch to dark mode" });
    fireEvent.click(button);
    expect(setThemeMock).toHaveBeenCalledWith("dark");
  });

  it("labels the compact toggle for dark mode as switching to light", () => {
    render(<ThemeToggle compact />);

    expect(screen.getByRole("button", { name: "Switch to light mode" })).toBeInTheDocument();
  });
});
