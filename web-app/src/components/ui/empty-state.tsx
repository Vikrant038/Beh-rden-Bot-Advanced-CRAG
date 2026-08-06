import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlassCard } from "@/components/ui/glass-card";

interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  className?: string;
}

/** Empty-state surface used across admin, chat, and pipeline surfaces. */
export function EmptyState({ title, description, icon: Icon, action, className }: EmptyStateProps) {
  return (
    <GlassCard
      className={cn("flex flex-col items-center gap-3 px-6 py-10 text-center sm:py-16", className)}
    >
      {Icon ? (
        <div className="grid h-10 w-10 place-items-center rounded-full bg-surface-hover sm:h-12 sm:w-12">
          <Icon className="h-5 w-5 text-muted sm:h-6 sm:w-6" />
        </div>
      ) : null}
      <div>
        <p className="font-medium text-foreground">{title}</p>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </GlassCard>
  );
}
