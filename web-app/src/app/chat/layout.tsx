import { ChatLayout } from "@/components/chat/chat-layout";

export default function ChatRootLayout({ children }: { children: React.ReactNode }) {
  return <ChatLayout>{children}</ChatLayout>;
}
