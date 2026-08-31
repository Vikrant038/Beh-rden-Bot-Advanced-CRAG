import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { FileText } from "lucide-react";
import { GlassCard } from "@/components/ui/glass-card";
import { Skeleton, SkeletonList } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { CountUp } from "@/components/ui/count-up";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

let mockInView = true;
let mockReducedMotion = true;

vi.mock("framer-motion", () => ({
  useInView: () => mockInView,
  useReducedMotion: () => mockReducedMotion,
}));

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

  it("renders the requested number of lines with last line shortened", () => {
    const { container } = render(<Skeleton lines={3} />);
    const pulses = container.querySelectorAll(".animate-pulse");
    expect(pulses).toHaveLength(3);
    expect(pulses[2].classList.contains("w-2/3")).toBe(true);
  });

  it("renders non-text variants (card, avatar, button)", () => {
    const { container: card } = render(<Skeleton variant="card" />);
    expect(card.querySelector(".rounded-2xl")).toBeInTheDocument();

    const { container: avatar } = render(<Skeleton variant="avatar" />);
    expect(avatar.querySelector(".rounded-full")).toBeInTheDocument();

    const { container: button } = render(<Skeleton variant="button" />);
    expect(button.querySelector(".rounded-xl")).toBeInTheDocument();
  });

  it("renders SkeletonList with custom rows", () => {
    const { container } = render(<SkeletonList rows={2} />);
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(2);
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

describe("CountUp", () => {
  it("renders final formatted value with suffix and abbreviations", () => {
    mockReducedMotion = true;
    mockInView = true;
    const { rerender } = render(<CountUp value={2500} suffix="+" />);
    expect(screen.getByText("2.5k+")).toBeInTheDocument();

    rerender(<CountUp value={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();

    rerender(<CountUp value={98.75} decimals={2} suffix="%" />);
    expect(screen.getByText("98.75%")).toBeInTheDocument();
  });

  it("animates value via requestAnimationFrame when reduceMotion is false", () => {
    mockReducedMotion = false;
    mockInView = true;
    let animFrameCallback: ((time: number) => void) | null = null;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      animFrameCallback = cb;
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    render(<CountUp value={100} durationMs={1000} />);
    if (animFrameCallback) {
      act(() => {
        (animFrameCallback as (time: number) => void)(performance.now() + 500);
      });
      act(() => {
        (animFrameCallback as (time: number) => void)(performance.now() + 1000);
      });
    }
  });

  it("handles inView false immediately setting display value", () => {
    mockInView = false;
    mockReducedMotion = false;
    render(<CountUp value={50} />);
    expect(screen.getByText("50")).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("renders when open and triggers onConfirm", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={onOpenChange}
        title="Delete Item"
        description="Are you sure you want to delete this?"
        confirmLabel="Confirm Delete"
        onConfirm={onConfirm}
      />,
    );

    expect(screen.getByText("Delete Item")).toBeInTheDocument();
    expect(screen.getByText("Are you sure you want to delete this?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Confirm Delete" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("shows working state when isPending is true", () => {
    render(
      <ConfirmDialog
        open={true}
        onOpenChange={vi.fn()}
        title="Delete Item"
        description="Irreversible operation."
        isPending={true}
        onConfirm={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Working…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });
});
