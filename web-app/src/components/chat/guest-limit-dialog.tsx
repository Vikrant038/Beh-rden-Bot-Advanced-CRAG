"use client";

import { useRouter } from "next/navigation";
import { LogIn } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { GUEST_PROMPT_LIMIT } from "@/lib/guest";

interface GuestLimitDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Shown when a guest hits the free-tier prompt cap. The only way forward is to
 * sign in, so the dialog leads with a "Sign in" button that redirects to the
 * login page; closing it just dismisses the notice.
 */
export function GuestLimitDialog({ open, onOpenChange }: GuestLimitDialogProps) {
  const router = useRouter();

  const signIn = () => {
    onOpenChange(false);
    router.push("/login");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="max-w-sm">
        <DialogHeader className="pr-0">
          <DialogTitle className="text-base font-semibold">Limit finished</DialogTitle>
          <DialogDescription className="text-sm text-muted">
            Free guest browsing includes {GUEST_PROMPT_LIMIT} prompts. Sign in to keep chatting —
            your existing conversations will be saved to your account automatically.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" size="md" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button variant="primary" size="md" onClick={signIn}>
            <LogIn className="h-4 w-4" />
            Sign in
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
