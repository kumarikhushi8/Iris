"use client";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { useIrisStatus } from "@/hooks/useIrisStatus";

export default function Home() {
  const { data: session, status } = useSession();
  const { mood, pendingCount } = useIrisStatus();

  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center gap-8 px-6 text-center">
      <Mascot size={180} mood={mood} />
      <div className="space-y-3">
        <h1 className="text-4xl font-medium text-coral-900">Meet Iris</h1>
        <p className="text-lg text-coral-900/70 max-w-md">
          {status === "authenticated" && pendingCount > 0
            ? `Iris found ${pendingCount} fix${pendingCount > 1 ? "es" : ""} waiting for your review.`
            : "Iris watches your builds, figures out what broke, and only ever shows you a fix once she's actually tried it."}
        </p>
      </div>

      {status === "loading" && <p className="text-coral-900/40 text-sm">Checking who you are…</p>}

      {status === "unauthenticated" && (
        <button
          onClick={() => signIn("github")}
          className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-base font-medium shadow-lg shadow-coral-200/50 transition-colors"
        >
          Sign in with GitHub
        </button>
      )}

      {status === "authenticated" && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex gap-3">
            {pendingCount > 0 ? (
              <Link href="/approvals" className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-base font-medium shadow-lg shadow-coral-200/50 transition-colors">
                Review fixes
              </Link>
            ) : (
              <Link href="/repos" className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-base font-medium shadow-lg shadow-coral-200/50 transition-colors">
                Connect a repo
              </Link>
            )}
          </div>
          <p className="text-xs text-coral-900/40">
            Signed in as {session?.user?.name} · <button onClick={() => signOut()} className="underline hover:text-coral-900/70">sign out</button>
          </p>
        </div>
      )}
    </main>
  );
}