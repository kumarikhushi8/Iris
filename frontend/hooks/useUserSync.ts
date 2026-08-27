"use client";
// Satisfies: FR-1 — ensures a User row exists in the Iris database the
// moment a GitHub OAuth session is established in the frontend.
//
// After NextAuth completes the GitHub OAuth flow, the browser has a session
// but the backend has no matching User record yet. This hook detects a
// freshly authenticated session and POSTs to POST /users/upsert, storing
// the returned Iris userId in localStorage so other hooks (useIrisStatus,
// approval page) can attach it as X-User-Id.

import { useEffect } from "react";
import { useSession } from "next-auth/react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const STORAGE_KEY = "iris_user_id";

export function useUserSync() {
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status !== "authenticated" || !session) return;

    // Already synced for this GitHub identity?
    const cached = localStorage.getItem(STORAGE_KEY);
    if (cached) return;

    const githubId = String((session as any).githubId ?? "");
    if (!githubId) return;

    fetch(`${API}/users/upsert`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        githubId,
        name: session.user?.name ?? undefined,
        email: session.user?.email ?? undefined,
      }),
    })
      .then((r) => r.json())
      .then((user) => {
        if (user?.id) {
          localStorage.setItem(STORAGE_KEY, user.id);
        }
      })
      .catch((err) => {
        console.warn("Iris user sync failed:", err);
      });
  }, [status, session]);
}

/**
 * Returns the Iris user ID stored after the first successful sync,
 * or null if not yet synced. Safe to call from any component.
 */
export function getIrisUserId(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(STORAGE_KEY);
}
