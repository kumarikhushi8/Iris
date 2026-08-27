"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { getIrisUserId } from "@/hooks/useUserSync";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

interface SandboxRun { result: string; testLog: string }
interface Approval {
  id: string;
  decision: string;
  diagnosis: {
    rootCause: string;
    fixType: string;
    confidence: number;
    proposedDiff: string | null;
    sandboxRuns: SandboxRun[];
    build: { repo: { name: string }; commitSha: string; branch: string };
  };
}

type Action = "approve" | "reject" | "request-changes";
type PageState = "loading" | "error" | "empty" | "ready";

// Skeleton card shown while data is loading
function SkeletonCard() {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-coral-50 p-6 space-y-3 animate-pulse">
      <div className="flex justify-between">
        <div className="h-3 bg-coral-50 rounded w-40" />
        <div className="h-5 bg-seafoam-100 rounded-full w-20" />
      </div>
      <div className="h-4 bg-coral-50 rounded w-full" />
      <div className="h-4 bg-coral-50 rounded w-3/4" />
      <div className="h-24 bg-coral-50 rounded-xl w-full" />
      <div className="flex gap-3 pt-1">
        <div className="h-9 bg-coral-200 rounded-xl w-36 opacity-50" />
        <div className="h-9 bg-coral-50 rounded-xl w-28" />
        <div className="h-9 bg-coral-50 rounded-xl w-36" />
      </div>
    </div>
  );
}

// Diff viewer with +/- line colouring
function DiffViewer({ diff }: { diff: string }) {
  const lines = diff.split("\n");
  return (
    <div className="rounded-xl overflow-hidden border border-coral-50 text-xs font-mono">
      <div className="bg-coral-900/5 px-4 py-2 text-coral-900/50 text-[11px] font-sans font-medium tracking-wide">
        Proposed diff
      </div>
      <div className="overflow-x-auto max-h-64 overflow-y-auto">
        {lines.map((line, i) => {
          const bg =
            line.startsWith("+") && !line.startsWith("+++")
              ? "bg-seafoam-100 text-seafoam-600"
              : line.startsWith("-") && !line.startsWith("---")
              ? "bg-red-50 text-red-600"
              : line.startsWith("@@")
              ? "bg-coral-50 text-coral-900/40"
              : "text-coral-900/70";
          return (
            <div key={i} className={`px-4 py-0.5 whitespace-pre ${bg}`}>
              {line || " "}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Badge for fix types
function FixTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    lint: "bg-yellow-50 text-yellow-700",
    test: "bg-blue-50 text-blue-700",
    dependency: "bg-purple-50 text-purple-700",
    infra: "bg-orange-50 text-orange-700",
    unknown: "bg-coral-50 text-coral-900/60",
  };
  return (
    <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${colors[type] ?? colors.unknown}`}>
      {type}
    </span>
  );
}

export default function ApprovalsPage() {
  const { data: session, status } = useSession();
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedLog, setExpandedLog] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3500);
  };

  const load = useCallback(async () => {
    try {
      const userId = getIrisUserId();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userId) headers["x-user-id"] = userId;

      const res = await fetch(`${API}/approvals`, { headers });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data: Approval[] = await res.json();
      const pending = data.filter((a) => a.decision === "pending");
      setApprovals(pending);
      setPageState(pending.length ? "ready" : "empty");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setPageState("error");
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") load();
  }, [status, load]);

  // Poll for new approvals every 10s
  useEffect(() => {
    if (status !== "authenticated") return;
    const interval = setInterval(load, 10_000);
    return () => clearInterval(interval);
  }, [status, load]);

  async function decide(id: string, action: Action) {
    setBusyId(id);
    try {
      const userId = getIrisUserId();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userId) headers["x-user-id"] = userId;

      const res = await fetch(`${API}/approvals/${id}/${action}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ reviewerId: userId ?? null }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }

      const label = action === "approve" ? "Approved ✓" : action === "reject" ? "Rejected" : "Changes requested";
      showToast(label, action === "approve");
      await load();
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setBusyId(null);
    }
  }

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (status === "unauthenticated") {
    return (
      <main className="min-h-screen bg-cream flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Mascot size={120} mood="idle" />
        <div className="space-y-2">
          <h1 className="text-2xl font-medium text-coral-900">Sign in to review fixes</h1>
          <p className="text-coral-900/60 text-sm max-w-xs">
            Iris needs to know who you are before showing pending fixes.
          </p>
        </div>
        <button
          onClick={() => signIn("github")}
          className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-base font-medium shadow-lg shadow-coral-200/50 transition-colors"
        >
          Sign in with GitHub
        </button>
      </main>
    );
  }

  const mood =
    pageState === "loading"
      ? "working"
      : approvals.length > 0
      ? "happy"
      : "idle";

  return (
    <main className="min-h-screen bg-cream px-4 py-10">
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-sm font-medium shadow-lg transition-all
            ${toast.ok ? "bg-seafoam-400 text-white" : "bg-coral-600 text-white"}`}
          style={{ animation: "slideUp 0.3s ease both" }}
        >
          {toast.msg}
        </div>
      )}

      <div className="max-w-2xl mx-auto space-y-8" style={{ animation: "fadeIn 0.4s ease both" }}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Mascot size={56} mood={mood} />
            <div>
              <h1 className="text-2xl font-medium text-coral-900">
                {pageState === "loading"
                  ? "Loading fixes…"
                  : approvals.length > 0
                  ? `${approvals.length} fix${approvals.length > 1 ? "es" : ""} waiting`
                  : "Queue is clear"}
              </h1>
              <p className="text-coral-900/50 text-sm">Each fix already passed a real sandbox test run.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/repos"
              className="text-xs text-coral-900/50 hover:text-coral-900 transition-colors"
            >
              My repos →
            </Link>
            <Link
              href="/dashboard"
              className="text-xs text-coral-900/50 hover:text-coral-900 transition-colors"
            >
              Dashboard →
            </Link>
            <button
              onClick={load}
              className="text-xs text-coral-900/40 hover:text-coral-600 transition-colors"
              title="Refresh"
            >
              ↻ Refresh
            </button>
          </div>
        </div>

        {/* Loading skeletons */}
        {pageState === "loading" && (
          <div className="space-y-4">
            {[0, 1].map((i) => <SkeletonCard key={i} />)}
          </div>
        )}

        {/* Error state */}
        {pageState === "error" && (
          <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center space-y-3">
            <p className="text-red-700 font-medium text-sm">Could not load the approval queue</p>
            <p className="text-red-500 text-xs font-mono">{errorMsg}</p>
            <button
              onClick={load}
              className="text-xs text-red-600 underline hover:no-underline"
            >
              Try again
            </button>
          </div>
        )}

        {/* Empty state */}
        {pageState === "empty" && (
          <div className="text-center py-20 space-y-3">
            <div className="text-4xl">🌿</div>
            <p className="text-coral-900/60 font-medium">Nothing to review right now.</p>
            <p className="text-coral-900/40 text-sm">
              Iris will notify you when a validated fix arrives.
            </p>
            <Link href="/" className="text-xs text-coral-600 underline hover:no-underline">
              Back to home
            </Link>
          </div>
        )}

        {/* Approval cards */}
        {pageState === "ready" && (
          <div className="space-y-5">
            {approvals.map((a, idx) => (
              <div
                key={a.id}
                className="bg-white rounded-2xl shadow-lg shadow-coral-200/30 border border-coral-50 p-6 space-y-4"
                style={{ animation: `slideUp 0.35s ease ${idx * 0.05}s both` }}
              >
                {/* Top row: repo + badge */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2 text-sm text-coral-900/50">
                    <span className="font-medium text-coral-900">{a.diagnosis.build.repo.name}</span>
                    <span>·</span>
                    <span className="font-mono text-xs">{a.diagnosis.build.branch}</span>
                    <span>·</span>
                    <span className="font-mono text-xs">{a.diagnosis.build.commitSha.slice(0, 7)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <FixTypeBadge type={a.diagnosis.fixType} />
                    <span
                      className="text-xs font-semibold px-3 py-1 rounded-full"
                      style={{
                        background: `hsl(${Math.round(a.diagnosis.confidence * 120)}, 60%, 92%)`,
                        color: `hsl(${Math.round(a.diagnosis.confidence * 120)}, 55%, 35%)`,
                      }}
                    >
                      {Math.round(a.diagnosis.confidence * 100)}% confidence
                    </span>
                  </div>
                </div>

                {/* Root cause */}
                <p className="text-coral-900 leading-relaxed">{a.diagnosis.rootCause}</p>

                {/* Diff */}
                {a.diagnosis.proposedDiff && (
                  <DiffViewer diff={a.diagnosis.proposedDiff} />
                )}

                {/* Sandbox result */}
                {a.diagnosis.sandboxRuns[0] && (
                  <div className="flex items-start gap-3 bg-seafoam-100 rounded-xl p-4">
                    <span className="text-seafoam-600 text-lg mt-0.5">✓</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-seafoam-600 text-sm font-medium">
                        Sandbox passed ({a.diagnosis.sandboxRuns[0].result})
                      </p>
                      {a.diagnosis.sandboxRuns[0].testLog && (
                        <button
                          onClick={() =>
                            setExpandedLog(expandedLog === a.id ? null : a.id)
                          }
                          className="text-seafoam-600/70 text-xs underline hover:no-underline mt-1"
                        >
                          {expandedLog === a.id ? "Hide log" : "Show test log"}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Expanded test log */}
                {expandedLog === a.id && a.diagnosis.sandboxRuns[0]?.testLog && (
                  <pre className="bg-coral-900 text-seafoam-400 rounded-xl p-4 text-xs overflow-x-auto overflow-y-auto max-h-48 whitespace-pre-wrap">
                    {a.diagnosis.sandboxRuns[0].testLog}
                  </pre>
                )}

                {/* Action buttons */}
                <div className="flex flex-wrap gap-3 pt-1">
                  <button
                    id={`approve-${a.id}`}
                    onClick={() => decide(a.id, "approve")}
                    disabled={busyId === a.id}
                    className="bg-coral-600 hover:bg-coral-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40 flex items-center gap-2"
                  >
                    {busyId === a.id ? (
                      <span
                        className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                        style={{ animation: "spin 0.8s linear infinite" }}
                      />
                    ) : (
                      "✓"
                    )}
                    Approve & open PR
                  </button>

                  <button
                    id={`changes-${a.id}`}
                    onClick={() => decide(a.id, "request-changes")}
                    disabled={busyId === a.id}
                    className="border border-coral-200 text-coral-900/70 hover:bg-coral-50 px-5 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    Request changes
                  </button>

                  <button
                    id={`reject-${a.id}`}
                    onClick={() => decide(a.id, "reject")}
                    disabled={busyId === a.id}
                    className="text-coral-900/40 hover:text-coral-600 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-40"
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}