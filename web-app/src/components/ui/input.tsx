import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, ...props }: InputProps) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-base text-foreground shadow-none transition placeholder:text-muted focus:border-primary/70 focus:shadow-[0_0_0_3px_rgba(99,102,241,0.12)] focus:outline-none disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm",
        className,
      )}
      {...props}
    />
  );
}
