"use client";
import { useEffect, useState } from "react";

export type IrisMood = "idle" | "working" | "happy";

export function useIrisStatus() {
  const [mood, setMood] = useState<IrisMood>("idle");
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let lastPending = 0;

    async function poll() {
      try {
        const res = await fetch("http://localhost:3000/approvals");
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