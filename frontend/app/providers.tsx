"use client";
import { SessionProvider } from "next-auth/react";
import { useUserSync } from "@/hooks/useUserSync";

function SyncUser() {
  useUserSync();
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <SyncUser />
      {children}
    </SessionProvider>
  );
}
