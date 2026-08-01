import { cn } from "@/lib/utils";

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  as?: React.ElementType;
}

/**
 * Shared glassmorphism surface. Falls back to `bg-surface` when
 * `backdrop-filter` is unsupported (see `.glass-card` in globals.css).
 */
export function GlassCard({ className, as: Component = "div", ...props }: GlassCardProps) {
  return <Component className={cn("glass-card rounded-2xl", className)} {...props} />;
}
