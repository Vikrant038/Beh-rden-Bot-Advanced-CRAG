"use client";

import { createContext, useContext, useState, type ReactNode } from "react";

export interface ChatActions {
  /** Copy the conversation transcript to the clipboard. */
  onCopy: () => void;
  /** Open the clear/delete confirmation. Absent for read-only views (an admin
   * inspecting another user's conversation cannot modify it). */
  onClear?: () => void;
}

interface ChatActionsContextValue {
  actions: ChatActions | null;
  setActions: (actions: ChatActions | null) => void;
}

const ChatActionsContext = createContext<ChatActionsContextValue | null>(null);

/**
 * Shares the conversation actions (copy / delete) from ChatInterface to the
 * mobile top-bar overflow menu in ChatLayout. A conversation registers its
 * handlers on mount; the new-chat page registers none, so the menu hides.
 */
export function ChatActionsProvider({ children }: { children: ReactNode }) {
  const [actions, setActions] = useState<ChatActions | null>(null);
  return (
    <ChatActionsContext.Provider value={{ actions, setActions }}>
      {children}
    </ChatActionsContext.Provider>
  );
}

export function useChatActions(): ChatActionsContextValue {
  const value = useContext(ChatActionsContext);
  if (!value) {
    throw new Error("useChatActions must be used within a ChatActionsProvider");
  }
  return value;
}
