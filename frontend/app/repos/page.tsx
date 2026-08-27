"use client";
import { useEffect, useState, useCallback } from "react";
import { useSession, signIn } from "next-auth/react";
import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { getIrisUserId } from "@/hooks/useUserSync";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

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
  const [form, setForm] = useState({
    githubRepoId: "",
    name: "",
    installationId: "",
    autonomyLevel: "comment_only" as "comment_only" | "draft_pr_eligible",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setErr("");
    try {
      const userId = getIrisUserId();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (userId) headers["x-user-id"] = userId;

      const res = await fetch(`${API}/repos`, {
        method: "POST",
        headers,
        body: JSON.stringify(form),
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
            You'll need your GitHub App installation ID and the numeric repository ID.
          </p>
        </div>

        <div className="space-y-4">
          <Field
            label="Repository name"
            placeholder="owner/repo-name"
            value={form.name}
            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
            required
          />
          <Field
            label="GitHub Repository ID"
            placeholder="Numeric repo ID (e.g. 123456789)"
            value={form.githubRepoId}
            onChange={(v) => setForm((f) => ({ ...f, githubRepoId: v }))}
            required
          />
          <Field
            label="GitHub App Installation ID"
            placeholder="Installation ID from GitHub App settings"
            value={form.installationId}
            onChange={(v) => setForm((f) => ({ ...f, installationId: v }))}
            required
          />

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
            disabled={saving}
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
  const [repos, setRepos] = useState<Repo[]>([]);
  const [pageState, setPageState] = useState<PageState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [showModal, setShowModal] = useState(false);
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

      <main className="min-h-screen bg-cream px-4 py-10">
        <div className="max-w-2xl mx-auto space-y-8" style={{ animation: "fadeIn 0.4s ease both" }}>
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Mascot size={56} mood={status === "loading" ? "working" : "idle"} />
              <div>
                <h1 className="text-2xl font-medium text-coral-900">Connected repositories</h1>
                <p className="text-coral-900/50 text-sm">
                  {session?.user?.name ? `Signed in as ${session.user.name}` : "Manage what Iris watches"}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Link href="/approvals" className="text-xs text-coral-900/50 hover:text-coral-900 transition-colors">
                Review queue →
              </Link>
              <button
                onClick={() => setShowModal(true)}
                className="bg-coral-600 hover:bg-coral-900 text-white px-4 py-2 rounded-xl text-sm font-medium transition-colors shadow-sm"
              >
                + Connect repo
              </button>
            </div>
          </div>

          {/* Loading */}
          {pageState === "loading" && (
            <div className="space-y-3">
              <SkeletonRepo />
              <SkeletonRepo />
            </div>
          )}

          {/* Error */}
          {pageState === "error" && (
            <div className="bg-red-50 border border-red-100 rounded-2xl p-6 text-center space-y-3">
              <p className="text-red-700 font-medium text-sm">Could not load repositories</p>
              <p className="text-red-500 text-xs font-mono">{errorMsg}</p>
              <button onClick={load} className="text-xs text-red-600 underline">
                Try again
              </button>
            </div>
          )}

          {/* Empty state */}
          {pageState === "ready" && repos.length === 0 && (
            <div
              className="bg-white rounded-3xl border-2 border-dashed border-coral-100 p-12 text-center space-y-4"
              style={{ animation: "fadeIn 0.4s ease both" }}
            >
              <div className="text-5xl">🔗</div>
              <div>
                <p className="text-coral-900 font-medium">No repositories connected yet</p>
                <p className="text-coral-900/50 text-sm mt-1">
                  Connect a repo and Iris will start watching it for CI failures.
                </p>
              </div>
              <button
                onClick={() => setShowModal(true)}
                className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-sm font-medium transition-colors shadow-sm"
              >
                Connect first repository
              </button>
            </div>
          )}

          {/* Repo list */}
          {pageState === "ready" && repos.length > 0 && (
            <div className="space-y-3" style={{ animation: "fadeIn 0.4s ease both" }}>
              {repos.map((repo, idx) => {
                const info = AUTONOMY_LABELS[repo.autonomyLevel] ?? AUTONOMY_LABELS.comment_only;
                const isChanging = changingId === repo.id;

                return (
                  <div
                    key={repo.id}
                    className="bg-white rounded-2xl border border-coral-50 shadow-sm p-5 space-y-4"
                    style={{ animation: `slideUp 0.35s ease ${idx * 0.05}s both` }}
                  >
                    {/* Repo name + badge */}
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div>
                        <p className="font-medium text-coral-900">{repo.name}</p>
                        <p className="text-xs text-coral-900/40 mt-0.5 font-mono">
                          id: {repo.githubRepoId}
                        </p>
                      </div>
                      <span className={`text-xs font-medium px-3 py-1 rounded-full border ${info.color}`}>
                        {info.label}
                      </span>
                    </div>

                    {/* Autonomy selector */}
                    <div className="space-y-2">
                      <p className="text-xs text-coral-900/50 font-medium">Autonomy level</p>
                      <div className="grid grid-cols-2 gap-2">
                        {(["comment_only", "draft_pr_eligible"] as const).map((level) => {
                          const lInfo = AUTONOMY_LABELS[level];
                          const isActive = repo.autonomyLevel === level;
                          return (
                            <button
                              key={level}
                              onClick={() => !isActive && setAutonomy(repo.id, level)}
                              disabled={isChanging}
                              className={`text-left p-3 rounded-xl border text-xs transition-all
                                ${isActive
                                  ? "border-coral-600 bg-coral-50 ring-1 ring-coral-600/20 cursor-default"
                                  : "border-coral-100 hover:border-coral-200 bg-white cursor-pointer"
                                }
                                disabled:opacity-60`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-coral-900">{lInfo.label}</span>
                                {isActive && <span className="text-coral-600 text-[10px]">● Active</span>}
                              </div>
                              <div className="text-coral-900/50 mt-0.5 leading-snug">{lInfo.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Footer: disconnect */}
                    <div className="flex justify-end pt-1">
                      <button
                        onClick={() => disconnect(repo.id, repo.name)}
                        className="text-xs text-coral-900/30 hover:text-red-500 transition-colors"
                      >
                        Disconnect
                      </button>
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
