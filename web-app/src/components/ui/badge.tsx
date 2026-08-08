import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "outline" | "success" | "warning" | "danger" | "accent";

const VARIANTS: Record<BadgeVariant, string> = {
  default: "bg-primary/10 text-primary shadow-[0_0_14px_-6px_currentColor]",
  outline: "border border-border text-muted",
  success: "bg-success/10 text-success shadow-[0_0_14px_-6px_currentColor]",
  warning: "bg-warning/10 text-warning shadow-[0_0_14px_-6px_currentColor]",
  danger: "bg-destructive/10 text-destructive shadow-[0_0_14px_-6px_currentColor]",
  accent: "bg-accent/10 text-accent shadow-[0_0_14px_-6px_currentColor]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 truncate rounded-full px-2.5 py-0.5 text-xs font-medium",
        VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}
