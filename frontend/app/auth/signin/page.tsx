"use client";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, Suspense } from "react";
import { Mascot } from "@/components/Mascot";

// NextAuth renders /auth/signin for its default sign-in page.
// We override it here so it matches the Iris design language.
// The `callbackUrl` param is forwarded to NextAuth so the user
// lands back where they started.

function SignInContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/";
  const error = searchParams.get("error");

  // Already signed in — redirect straight to where they were going
  useEffect(() => {
    if (status === "authenticated") {
      router.replace(callbackUrl);
    }
  }, [status, callbackUrl, router]);

  const errorMessages: Record<string, string> = {
    OAuthSignin: "Could not start the GitHub sign-in flow. Please try again.",
    OAuthCallback: "GitHub returned an unexpected response. Please try again.",
    OAuthCreateAccount: "Could not create an account. Please try again.",
    Callback: "Sign-in failed. Please try again.",
    Default: "Something went wrong during sign-in.",
  };

  const errorMessage = error ? (errorMessages[error] ?? errorMessages.Default) : null;

  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center gap-10 px-6">
      {/* Mascot + heading */}
      <div className="flex flex-col items-center gap-6 text-center" style={{ animation: "fadeIn 0.5s ease both" }}>
        <Mascot size={160} mood={status === "loading" ? "working" : "idle"} />
        <div className="space-y-2">
          <h1 className="text-3xl font-medium text-coral-900">Welcome to Iris</h1>
          <p className="text-coral-900/60 max-w-sm text-base leading-relaxed">
            Your AI copilot that watches builds, figures out what broke, and only ever shows you a
            fix once she's actually tried it.
          </p>
        </div>
      </div>

      {/* Error state */}
      {errorMessage && (
        <div
          className="bg-red-50 border border-red-100 rounded-2xl px-6 py-4 text-sm text-red-700 text-center max-w-sm w-full"
          style={{ animation: "slideUp 0.3s ease both" }}
        >
          {errorMessage}
        </div>
      )}

      {/* Sign-in card */}
      <div
        className="bg-white rounded-3xl shadow-xl shadow-coral-200/30 border border-coral-50 px-10 py-8 flex flex-col items-center gap-6 w-full max-w-sm"
        style={{ animation: "slideUp 0.4s ease 0.1s both" }}
      >
        <div className="text-center space-y-1">
          <p className="text-coral-900 font-medium">Sign in to continue</p>
          <p className="text-coral-900/50 text-sm">
            Uses your GitHub account — no separate password needed.
          </p>
        </div>

        <button
          id="github-signin-btn"
          onClick={() => signIn("github", { callbackUrl })}
          disabled={status === "loading"}
          className="w-full flex items-center justify-center gap-3 bg-coral-900 hover:bg-coral-900/80
            text-white py-3 rounded-2xl text-sm font-medium transition-colors
            shadow-lg shadow-coral-900/20 disabled:opacity-50"
        >
          {/* GitHub octicon SVG */}
          <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57
              0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695
              -.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99
              .105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225
              -.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405
              c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225
              0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3
              0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
          </svg>
          {status === "loading" ? "Signing in…" : "Continue with GitHub"}
        </button>

        <p className="text-xs text-coral-900/30 text-center leading-relaxed">
          Iris only requests read access to your repositories and the ability to post comments.
          You can revoke access at any time from GitHub settings.
        </p>
      </div>

      {/* Feature pills */}
      <div
        className="flex flex-wrap justify-center gap-3 max-w-sm"
        style={{ animation: "fadeIn 0.5s ease 0.3s both" }}
      >
        {[
          "🔍 Diagnoses failures",
          "🧪 Validates fixes in sandbox",
          "🔒 Human approval required",
          "💬 Posts PR comments",
        ].map((feat) => (
          <span
            key={feat}
            className="text-xs text-coral-900/60 bg-white border border-coral-100 px-3 py-1.5 rounded-full shadow-sm"
          >
            {feat}
          </span>
        ))}
      </div>
    </main>
  );
}

export default function SignInPage() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-cream flex items-center justify-center">
        <Mascot size={100} mood="working" />
      </main>
    }>
      <SignInContent />
    </Suspense>
  );
}
