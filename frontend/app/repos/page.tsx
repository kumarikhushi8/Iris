"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { getIrisUserId } from "@/hooks/useUserSync";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";
const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG ?? "iris-copilot"; // Fallback placeholder

interface Repo {
  id: string;
  name: string;
  githubRepoId: string;
  installationId: string;
  autonomyLevel: "comment_only" | "draft_pr_eligible";
  createdAt: string;
}

type PageState = "loading" | "error" | "ready";

const AUTONOMY_LABELS: Record<string, { label: string; desc: string; color: string }> = {
  comment_only: {
    label: "Comment only",
    desc: "Iris posts a diagnosis comment on PRs. No code is ever touched.",
    color: "bg-coral-50 text-coral-600 border-coral-100",
  },
  draft_pr_eligible: {
    label: "Draft PR",
    desc: "A validated, approved fix can be opened as a draft pull request.",
    color: "bg-seafoam-100 text-seafoam-600 border-seafoam-100",
  },
};

function SkeletonRepo() {
  return (
    <div className="bg-white rounded-2xl border border-coral-50 p-5 flex items-center justify-between gap-4 animate-pulse">
      <div className="space-y-2 flex-1">
        <div className="h-4 bg-coral-50 rounded w-48" />
        <div className="h-3 bg-coral-50 rounded w-28" />
      </div>
      <div className="h-8 bg-coral-50 rounded-xl w-32" />
    </div>
  );
}

function ConnectModal({ onClose, onConnected }: { onClose: () => void; onConnected: () => void }) {
  const searchParams = useSearchParams();
  const initialInstallationId = searchParams?.get("installation_id") ?? "";

  const [form, setForm] = useState({
    installationId: initialInstallationId,
    autonomyLevel: "comment_only" as "comment_only" | "draft_pr_eligible",
  });
  const [selectedRepo, setSelectedRepo] = useState<{id: number; full_name: string} | null>(null);
  
  const [availableRepos, setAvailableRepos] = useState<any[]>([]);
  const [fetchingRepos, setFetchingRepos] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const fetchRepos = async () => {
    if (!form.installationId) return;
    setFetchingRepos(true);
    setErr("");
    try {
      const userId = getIrisUserId();
      const headers: Record<string, string> = {};
      if (userId) headers["x-user-id"] = userId;

      const res = await fetch(`${API}/repos/installation/${form.installationId}/repositories`, { headers });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Failed to fetch repos: ${res.status}`);
      }
      const data = await res.json();
      setAvailableRepos(data);
      if (data.length > 0) setSelectedRepo(data[0]);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setFetchingRepos(false);
    }
  };

  useEffect(() => {
    if (initialInstallationId) fetchRepos();
  }, [initialInstallationId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedRepo) {
      setErr("Please select a repository");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const userId = getIrisUserId();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userId) headers["x-user-id"] = userId;

      const res = await fetch(`${API}/repos`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          githubRepoId: selectedRepo.id.toString(),
          name: selectedRepo.full_name,
          installationId: form.installationId,
          autonomyLevel: form.autonomyLevel,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.message ?? `Server error ${res.status}`);
      }
      onConnected();
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center px-4"
      style={{ animation: "fadeIn 0.2s ease both" }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-coral-900/20 backdrop-blur-sm" onClick={onClose} />

      <form
        onSubmit={submit}
        className="relative bg-white rounded-3xl shadow-2xl shadow-coral-200/40 w-full max-w-md p-8 space-y-5 z-10"
        style={{ animation: "slideUp 0.3s ease both" }}
      >
        <div>
          <h2 className="text-xl font-medium text-coral-900">Connect a repository</h2>
          <p className="text-coral-900/50 text-sm mt-1">
            Install the GitHub App to give Iris access, then select your repository.
          </p>
        </div>

        <div className="space-y-4">
          <div className="bg-coral-50 border border-coral-100 rounded-xl p-5 text-center space-y-3">
            <p className="text-sm text-coral-900">
              Don't have an Installation ID? Install the app first:
            </p>
            <a
              href={`https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`}
              className="inline-block px-5 py-2.5 bg-coral-600 hover:bg-coral-900 text-white rounded-xl text-sm font-medium transition-colors"
            >
              Install GitHub App
            </a>
          </div>

          <div className="flex items-end gap-2 mt-4">
            <div className="flex-1">
              <Field
                label="GitHub App Installation ID"
                placeholder="e.g. 12345678"
                value={form.installationId}
                onChange={(v) => setForm((f) => ({ ...f, installationId: v }))}
                required
              />
            </div>
            <button
              type="button"
              onClick={fetchRepos}
              disabled={fetchingRepos || !form.installationId}
              className="px-4 py-2.5 bg-coral-50 border border-coral-200 hover:bg-coral-200 text-coral-900 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
            >
              {fetchingRepos ? "..." : "Fetch Repos"}
            </button>
          </div>

          {availableRepos.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-coral-900/70">Select Repository</label>
              <select
                className="w-full border border-coral-100 rounded-xl px-4 py-2.5 text-sm text-coral-900 bg-white focus:border-coral-600 focus:ring-2 focus:ring-coral-600/10 outline-none"
                value={selectedRepo?.id || ""}
                onChange={(e) => {
                  const r = availableRepos.find(r => r.id.toString() === e.target.value);
                  if (r) setSelectedRepo(r);
                }}
              >
                {availableRepos.map(r => (
                  <option key={r.id} value={r.id}>{r.full_name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-coral-900/70">Autonomy level</label>
            <div className="grid grid-cols-2 gap-3">
              {(["comment_only", "draft_pr_eligible"] as const).map((level) => {
                const info = AUTONOMY_LABELS[level];
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, autonomyLevel: level }))}
                    className={`text-left p-3 rounded-xl border text-xs transition-all
                      ${form.autonomyLevel === level
                        ? "border-coral-600 bg-coral-50 ring-1 ring-coral-600/20"
                        : "border-coral-100 bg-white hover:border-coral-200"
                      }`}
                  >
                    <div className="font-medium text-coral-900 mb-0.5">{info.label}</div>
                    <div className="text-coral-900/50 leading-snug">{info.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {err && (
          <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{err}</p>
        )}

        <div className="flex gap-3 pt-1">
          <button
            type="submit"
            disabled={saving || !selectedRepo}
            className="flex-1 bg-coral-600 hover:bg-coral-900 text-white py-2.5 rounded-xl text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {saving && (
              <span
                className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full"
                style={{ animation: "spin 0.8s linear infinite" }}
              />
            )}
            {saving ? "Connecting…" : "Connect repository"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl text-sm text-coral-900/60 hover:bg-coral-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({
  label, placeholder, value, onChange, required,
}: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-coral-900/70">{label}</label>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full border border-coral-100 rounded-xl px-4 py-2.5 text-sm text-coral-900
          placeholder:text-coral-900/30 outline-none focus:border-coral-600 focus:ring-2
          focus:ring-coral-600/10 transition-all bg-white"
      />
    </div>
  );
}

export default function ReposPage() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const initialInstallationId = searchParams?.get("installation_id") ?? "";

  const [repos, setRepos] = useState<Repo[]>([]);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [showModal, setShowModal] = useState(!!initialInstallationId);
  const [changingId, setChangingId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const showToast = (msg: string, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    try {
      const userId = getIrisUserId();
      if (!userId) { setPageState("ready"); return; }

      const res = await fetch(`${API}/repos`, {
        headers: { "x-user-id": userId },
      });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      setRepos(await res.json());
      setPageState("ready");
    } catch (err) {
      setErrorMsg((err as Error).message);
      setPageState("error");
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") load();
  }, [status, load]);

  async function setAutonomy(repoId: string, level: "comment_only" | "draft_pr_eligible") {
    setChangingId(repoId);
    try {
      const userId = getIrisUserId();
      const res = await fetch(`${API}/repos/${repoId}/autonomy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(userId ? { "x-user-id": userId } : {}) },
        body: JSON.stringify({ autonomyLevel: level }),
      });
      if (!res.ok) throw new Error("Failed to update autonomy level");
      setRepos((prev) => prev.map((r) => r.id === repoId ? { ...r, autonomyLevel: level } : r));
      showToast(`Updated to "${AUTONOMY_LABELS[level].label}"`);
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setChangingId(null);
    }
  }

  async function disconnect(repoId: string, name: string) {
    if (!confirm(`Disconnect ${name} from Iris? This will stop all future diagnosis.`)) return;
    try {
      const userId = getIrisUserId();
      const res = await fetch(`${API}/repos/${repoId}`, {
        method: "DELETE",
        headers: userId ? { "x-user-id": userId } : {},
      });
      if (!res.ok) throw new Error("Failed to disconnect repository");
      setRepos((prev) => prev.filter((r) => r.id !== repoId));
      showToast(`${name} disconnected`);
    } catch (err) {
      showToast((err as Error).message, false);
    }
  }

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (status === "unauthenticated") {
    return (
      <main className="min-h-screen bg-cream flex flex-col items-center justify-center gap-6 px-6 text-center">
        <Mascot size={120} mood="idle" />
        <div className="space-y-2">
          <h1 className="text-2xl font-medium text-coral-900">Sign in to manage repositories</h1>
          <p className="text-coral-900/60 text-sm max-w-xs">Connect and configure your GitHub repos from one place.</p>
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

  return (
    <>
      {/* Toast */}
      {toast && (
        <div
          className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-2xl text-sm font-medium shadow-lg
            ${toast.ok ? "bg-seafoam-400 text-white" : "bg-coral-600 text-white"}`}
          style={{ animation: "slideUp 0.3s ease both" }}
        >
          {toast.msg}
        </div>
      )}

      {showModal && (
        <ConnectModal
          onClose={() => setShowModal(false)}
          onConnected={load}
        />
      )}

      <main className="min-h-screen bg-cream">
        {/* Top Navigation */}
        <nav className="w-full border-b border-coral-100/50 bg-white/60 backdrop-blur-md px-6 py-4 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-3">
            <Mascot size={32} mood={status === "loading" ? "working" : "idle"} />
            <span className="font-semibold text-coral-900 tracking-tight">Iris Copilot</span>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/dashboard" className="text-sm font-medium text-coral-900/60 hover:text-coral-900 transition-colors">Dashboard</Link>
            <Link href="/approvals" className="text-sm font-medium text-coral-900/60 hover:text-coral-900 transition-colors">Review Queue</Link>
            <div className="w-px h-4 bg-coral-100" />
            <span className="text-xs font-medium text-coral-900/40">
               {session?.user?.name ? session.user.name : "Signed in"}
            </span>
          </div>
        </nav>

        <div className="max-w-3xl mx-auto px-4 py-12 space-y-8" style={{ animation: "fadeIn 0.4s ease both" }}>
          {/* Header */}
          <div className="flex items-end justify-between">
            <div>
              <h1 className="text-3xl font-semibold text-coral-900 tracking-tight">Repositories</h1>
              <p className="text-coral-900/50 text-sm mt-1">
                Manage the repositories Iris is actively monitoring.
              </p>
            </div>
            <button
              onClick={() => setShowModal(true)}
              className="bg-coral-600 hover:bg-coral-900 text-white px-5 py-2.5 rounded-xl text-sm font-medium transition-all shadow-md shadow-coral-200/50 hover:shadow-lg hover:-translate-y-0.5"
            >
              + Connect repo
            </button>
          </div>

          {/* Loading */}
          {pageState === "loading" && (
            <div className="space-y-4">
              <SkeletonRepo />
              <SkeletonRepo />
            </div>
          )}

          {/* Error */}
          {pageState === "error" && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center space-y-3">
              <p className="text-red-700 font-medium text-sm">Could not load repositories</p>
              <p className="text-red-500 text-xs font-mono">{errorMsg}</p>
              <button onClick={load} className="text-xs text-red-600 underline hover:text-red-800 transition-colors">
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {pageState === "ready" && repos.length === 0 && (
            <div
              className="bg-white rounded-3xl border-2 border-dashed border-coral-100 p-12 text-center space-y-4 shadow-sm"
              style={{ animation: "fadeIn 0.4s ease both" }}
            >
              <div className="text-5xl opacity-80">🔗</div>
              <div>
                <p className="text-coral-900 font-medium text-lg">No repositories connected yet</p>
                <p className="text-coral-900/50 text-sm mt-1">
                  Connect a repo and Iris will start watching it for CI failures.
                </p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-sm font-medium transition-all shadow-sm hover:shadow-md hover:-translate-y-0.5"
              >
                Connect first repository
              </button>
            </div>
          )}

          {/* Repo list */}
          {pageState === "ready" && repos.length > 0 && (
            <div className="space-y-4" style={{ animation: "fadeIn 0.4s ease both" }}>
              {repos.map((repo, idx) => {
                const info = AUTONOMY_LABELS[repo.autonomyLevel] ?? AUTONOMY_LABELS.comment_only;
                const isChanging = changingId === repo.id;

                return (
                  <div
                    key={repo.id}
                    className="group bg-white rounded-2xl border border-coral-50 shadow-sm hover:shadow-md transition-all duration-300 p-6 flex flex-col gap-2 hover:-translate-y-0.5"
                    style={{ animation: `slideUp 0.35s ease ${idx * 0.05}s both` }}
                  >
                    {/* Top Row: Name & Disconnect */}
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-lg font-semibold text-coral-900 tracking-tight">{repo.name}</p>
                        <p className="text-xs text-coral-900/40 mt-1 font-mono bg-coral-50/50 inline-block px-2 py-0.5 rounded-md">
                          id: {repo.githubRepoId}
                        </p>
                      </div>
                      <button
                        onClick={() => disconnect(repo.id, repo.name)}
                        className="opacity-0 group-hover:opacity-100 text-xs font-medium text-coral-900/40 hover:text-red-600 transition-all bg-coral-50/50 hover:bg-red-50 px-3 py-1.5 rounded-lg"
                      >
                        Disconnect
                      </button>
                    </div>

                    {/* Bottom Row: Autonomy toggle */}
                    <div>
                      <div className="flex items-center gap-4 pt-4 border-t border-coral-50/50 mt-3">
                        <span className="text-sm font-medium text-coral-900/60 w-32">Autonomy Mode</span>
                        <div className="flex bg-coral-50/50 p-1 rounded-xl w-64 relative">
                          {(["comment_only", "draft_pr_eligible"] as const).map((level) => {
                            const lInfo = AUTONOMY_LABELS[level];
                            const isActive = repo.autonomyLevel === level;
                            return (
                              <button
                                key={level}
                                onClick={() => !isActive && setAutonomy(repo.id, level)}
                                disabled={isChanging}
                                className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-medium transition-all duration-300 z-10
                                  ${isActive
                                    ? "bg-white text-coral-900 shadow-sm border border-coral-100/50"
                                    : "text-coral-900/50 hover:text-coral-900 hover:bg-coral-50"
                                  }
                                  disabled:opacity-60`}
                              >
                                {isActive && (
                                  <span className={`w-1.5 h-1.5 rounded-full ${level === "comment_only" ? "bg-coral-500" : "bg-seafoam-500"}`} />
                                )}
                                {lInfo.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                      <p className="text-[11px] text-coral-900/40 mt-2 ml-[144px]">
                        {info.desc}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
