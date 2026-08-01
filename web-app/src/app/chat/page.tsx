"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/trpc/client";

export default function NewChatPage() {
  const router = useRouter();
  const createMutation = api.conversation.create.useMutation();

  useEffect(() => {
    if (!createMutation.isPending && !createMutation.data) {
      createMutation.mutate(
        {},
        {
          onSuccess: (conversation) => router.replace(`/chat/${conversation.id}`),
        },
      );
    }
  }, [createMutation, router]);

  return (
    <div className="grid h-full place-items-center text-sm text-muted">
      Starting a new conversation…
    </div>
  );
}
