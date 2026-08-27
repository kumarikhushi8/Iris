"use client";
import { useEffect, useState } from "react";
import { getIrisUserId } from "@/hooks/useUserSync";

export type IrisMood = "idle" | "working" | "happy";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

export function useIrisStatus() {
  const [mood, setMood] = useState<IrisMood>("idle");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let lastPending = 0;

    async function poll() {
      try {
        const userId = getIrisUserId();
        const headers: Record<string, string> = {};
        if (userId) headers["x-user-id"] = userId;

        const res = await fetch(`${API}/approvals`, { headers });
        const approvals = await res.json();
        const pending = approvals.filter((a: any) => a.decision === "pending").length;

        if (pending > lastPending) {
          setMood("happy");
          setTimeout(() => setMood("idle"), 2500);
        } else {
          setMood((m) => (m === "happy" ? m : "idle"));
        }

        lastPending = pending;
        setPendingCount(pending);
      } catch (err) {
        console.warn("Iris status poll failed:", err);
      }
    }

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  return { mood, pendingCount };
}