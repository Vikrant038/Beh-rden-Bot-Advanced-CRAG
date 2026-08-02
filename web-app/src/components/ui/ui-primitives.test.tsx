import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FileText } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

describe("GlassCard", () => {
  it("applies the glass-card surface classes", () => {
    const { container } = render(<GlassCard>content</GlassCard>);
    const card = container.firstElementChild;
    expect(card?.classList.contains("glass-card")).toBe(true);
    expect(card?.classList.contains("rounded-2xl")).toBe(true);
  });

  it("merges custom className", () => {
    const { container } = render(<GlassCard className="p-5">content</GlassCard>);
    expect(container.firstElementChild?.classList.contains("p-5")).toBe(true);
  });

  it("renders as a custom element", () => {
    const { container } = render(
      <GlassCard as="section" data-testid="section">
        content
      </GlassCard>,
    );
    expect(container.firstElementChild?.tagName).toBe("SECTION");
  });
});

describe("Skeleton", () => {
  it("renders a single placeholder block by default", () => {
    const { container } = render(<Skeleton />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(1);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders the requested number of lines", () => {
    const { container } = render(<Skeleton lines={3} />);
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });
});

describe("EmptyState", () => {
  it("renders title and description", () => {
    render(<EmptyState title="No documents" description="Seed the knowledge base." />);
    expect(screen.getByText("No documents")).toBeInTheDocument();
    expect(screen.getByText("Seed the knowledge base.")).toBeInTheDocument();
  });

  it("renders an icon and action node", () => {
    const { container } = render(
      <EmptyState title="Empty" icon={FileText} action={<button type="button">Add one</button>} />,
    );
    expect(screen.getByRole("button", { name: "Add one" })).toBeInTheDocument();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});

describe("ErrorState", () => {
  it("renders message and code", () => {
    render(<ErrorState message="Unsupported content type" code="INVALID_CONTENT_TYPE" />);
    expect(screen.getByText("Unsupported content type")).toBeInTheDocument();
    expect(screen.getByText("Error INVALID_CONTENT_TYPE")).toBeInTheDocument();
  });

  it("invokes retry handler", () => {
    const retry = vi.fn();
    render(<ErrorState message="Failed" retry={retry} />);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
