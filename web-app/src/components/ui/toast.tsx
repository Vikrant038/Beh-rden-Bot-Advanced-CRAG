"use client";

import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle2, Info, TriangleAlert, X, XCircle } from "lucide-react";
import type { ToastItem, ToastVariant } from "@/lib/toast";
import { cn } from "@/lib/utils";

const VARIANT_META: Record<
  ToastVariant,
  { icon: typeof Info; iconClassName: string; label: string }
> = {
  success: { icon: CheckCircle2, iconClassName: "text-success", label: "Success" },
  error: { icon: XCircle, iconClassName: "text-destructive", label: "Error" },
  warning: { icon: TriangleAlert, iconClassName: "text-warning", label: "Warning" },
  info: { icon: Info, iconClassName: "text-accent", label: "Info" },
};

interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

/**
 * Animated toast viewport (top-right, auto-dismiss). Announcements are
 * emitted to assistive technology via `aria-live="polite"`.
 */
export function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  return (
    <div
      aria-live="polite"
      aria-label="Notifications"
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2"
    >
      <AnimatePresence initial={false}>
        {toasts.map((toastItem) => {
          const meta = VARIANT_META[toastItem.variant];
          const Icon = meta.icon;
          return (
            <motion.div
              key={toastItem.id}
              layout
              initial={{ opacity: 0, y: -16, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, x: 24, scale: 0.96 }}
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
              className="pointer-events-auto flex items-start gap-3 rounded-xl border border-glass-border bg-surface px-4 py-3 shadow-glass backdrop-blur"
              role="status"
            >
              <Icon className={cn("mt-0.5 h-5 w-5 shrink-0", meta.iconClassName)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{toastItem.title}</p>
                {toastItem.description ? (
                  <p className="mt-0.5 text-xs text-muted">{toastItem.description}</p>
                ) : null}
                {toastItem.action ? (
                  <button
                    type="button"
                    onClick={() => {
                      toastItem.action?.onClick();
                      onDismiss(toastItem.id);
                    }}
                    className="mt-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary transition hover:bg-primary/20"
                  >
                    {toastItem.action.label}
                  </button>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => onDismiss(toastItem.id)}
                aria-label={`Dismiss notification: ${toastItem.title}`}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted transition hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
