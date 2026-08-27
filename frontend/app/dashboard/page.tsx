"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { getIrisUserId } from "@/hooks/useUserSync";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface DashboardStats {
  builds: { success: number; failed: number; total: number };
  diagnoses: { total: number; validated: number };
  evaluationTrend: { runAt: string; accuracyScore: number }[];
}

type PageState = "loading" | "error" | "ready";

export default function DashboardPage() {
  const { data: session, status } = useSession();
  const [pageState, setPageState] = useState<PageState>("loading");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [errorMsg, setErrorMsg] = useState("");

  const loadStats = useCallback(async () => {
    if (!session) return;
    try {
      const userId = getIrisUserId();
      if (!userId) {
        throw new Error("Could not sync user with backend");
      }

      const res = await fetch(`${API}/dashboard/stats`, {
        headers: { "X-User-Id": userId },
      });

      if (!res.ok) {
        throw new Error(`Failed to fetch stats: ${res.status}`);
      }

      const data = await res.json();
      setStats(data);
      setPageState("ready");
    } catch (err: any) {
      console.error(err);
      setErrorMsg(err.message || "An unexpected error occurred");
      setPageState("error");
    }
  }, [session]);

  useEffect(() => {
    if (status === "unauthenticated") {
      signIn("github");
    } else if (status === "authenticated") {
      loadStats();
    }
  }, [status, loadStats]);

  if (status === "loading" || status === "unauthenticated") {
    return (
      <div className="flex items-center justify-center h-full min-h-[50vh] animate-pulse">
        <Mascot mood="working" size={120} />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12">
      <header className="mb-12">
        <div className="flex items-center gap-4 mb-2">
          <Mascot mood="happy" size={48} />
          <h1 className="text-3xl font-serif text-coral-950 font-medium tracking-tight">
            Iris Product Dashboard
          </h1>
        </div>
        <p className="text-coral-900/60 font-sans tracking-wide">
          Operational metrics, build health, and diagnosis accuracy.
        </p>
      </header>

      {pageState === "error" && (
        <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-8 font-sans text-sm">
          {errorMsg}
        </div>
      )}

      {pageState === "loading" && !stats && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-pulse">
          <div className="h-32 bg-coral-50 rounded-2xl w-full" />
          <div className="h-32 bg-coral-50 rounded-2xl w-full" />
          <div className="h-48 bg-coral-50 rounded-2xl w-full md:col-span-2" />
        </div>
      )}

      {pageState === "ready" && stats && (
        <div className="space-y-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Build Health */}
            <div className="bg-white rounded-2xl border border-coral-50 p-6 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-sans font-semibold tracking-wider text-coral-900/50 uppercase mb-1">
                  Build Health
                </h2>
                <div className="text-4xl font-serif text-coral-950">
                  {stats.builds.total > 0
                    ? Math.round((stats.builds.success / stats.builds.total) * 100)
                    : 0}
                  <span className="text-2xl text-coral-900/40 ml-1">%</span>
                </div>
              </div>
              <div className="mt-4 flex gap-4 text-sm font-sans text-coral-900/60">
                <div><span className="font-medium text-seafoam-600">{stats.builds.success}</span> passed</div>
                <div><span className="font-medium text-coral-600">{stats.builds.failed}</span> failed</div>
              </div>
            </div>

            {/* Diagnoses */}
            <div className="bg-white rounded-2xl border border-coral-50 p-6 flex flex-col justify-between">
              <div>
                <h2 className="text-sm font-sans font-semibold tracking-wider text-coral-900/50 uppercase mb-1">
                  Diagnoses
                </h2>
                <div className="text-4xl font-serif text-coral-950">
                  {stats.diagnoses.total}
                </div>
              </div>
              <div className="mt-4 text-sm font-sans text-coral-900/60">
                <span className="font-medium text-seafoam-600">{stats.diagnoses.validated}</span> validated fixes awaiting or finished review
              </div>
            </div>
          </div>

          {/* Accuracy Trend */}
          <div className="bg-white rounded-2xl border border-coral-50 p-6">
            <h2 className="text-sm font-sans font-semibold tracking-wider text-coral-900/50 uppercase mb-4">
              Evaluation Accuracy Trend
            </h2>
            {stats.evaluationTrend.length === 0 ? (
              <div className="text-center py-8 text-coral-900/40 text-sm font-sans">
                No evaluation runs recorded yet.
              </div>
            ) : (
              <div className="space-y-3">
                {stats.evaluationTrend.map((run, i) => (
                  <div key={i} className="flex justify-between items-center text-sm font-sans border-b border-coral-50/50 pb-2 last:border-0 last:pb-0">
                    <span className="text-coral-900/60">{new Date(run.runAt).toLocaleString()}</span>
                    <span className="font-medium text-seafoam-600 bg-seafoam-50 px-2 py-0.5 rounded-md">
                      {(run.accuracyScore * 100).toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <footer className="mt-16 flex gap-4 border-t border-coral-50 pt-8">
        <Link
          href="/approvals"
          className="text-sm font-sans text-coral-600 hover:text-coral-800 transition-colors"
        >
          &larr; Back to Approvals
        </Link>
        <Link
          href="/repos"
          className="text-sm font-sans text-coral-600 hover:text-coral-800 transition-colors"
        >
          Manage Repositories
        </Link>
      </footer>
    </div>
  );
}
