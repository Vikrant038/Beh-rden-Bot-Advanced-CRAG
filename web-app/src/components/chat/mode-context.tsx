"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import type { ChatMode } from "@/lib/chat/types";

interface ModeContextValue {
  mode: ChatMode;
  setMode: (mode: ChatMode) => void;
}

const ModeContext = createContext<ModeContextValue | null>(null);

/**
 * Shares the Standard/Agentic answer mode across the chat surfaces: the mobile
 * top-bar dropdown (ChatLayout), the desktop header toggle, and the composer /
 * suggestions that submit in the chosen mode. Provided once per chat layout so
 * the choice persists across navigation between /chat and /chat/[id].
 */
export function ModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ChatMode>("agentic");
  return <ModeContext.Provider value={{ mode, setMode }}>{children}</ModeContext.Provider>;
}

export function useMode(): ModeContextValue {
  const value = useContext(ModeContext);
  if (!value) {
    throw new Error("useMode must be used within a ModeProvider");
  }
  return value;
}
