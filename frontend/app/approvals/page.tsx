"use client";
import { useEffect, useState } from "react";
import { Mascot } from "@/components/Mascot";

interface Approval {
  id: string;
  decision: string;
  diagnosis: {
    rootCause: string;
    fixType: string;
    confidence: number;
    proposedDiff: string | null;
    sandboxRuns: Array<{ result: string; testLog: string }>;
    build: { repo: { name: string }; commitSha: string; branch: string };
  };
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    const res = await fetch("http://localhost:3000/approvals");
    setApprovals(await res.json());
  }

  useEffect(() => { load(); }, []);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    await fetch(`http://localhost:3000/approvals/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reviewerId: null }),
    });
    await load();
    setBusyId(null);
  }

  return (
    <main className="min-h-screen bg-cream px-6 py-12">
      <div className="max-w-2xl mx-auto space-y-8">
        <div className="flex items-center gap-4">
          <Mascot size={64} mood={approvals.length ? "happy" : "idle"} />
          <div>
            <h1 className="text-2xl font-medium text-coral-900">Fixes waiting on you</h1>
            <p className="text-coral-900/60 text-sm">Each one already passed a real test run.</p>
          </div>
        </div>

        {approvals.length === 0 && (
          <p className="text-coral-900/50 text-center py-16">Nothing waiting right now — nice.</p>
        )}

        {approvals.map((a) => (
          <div key={a.id} className="bg-white rounded-2xl shadow-lg shadow-coral-200/40 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-sm text-coral-900/50">{a.diagnosis.build.repo.name} · {a.diagnosis.build.branch}</span>
              <span className="text-xs font-medium bg-seafoam-100 text-seafoam-600 px-3 py-1 rounded-full">
                {Math.round(a.diagnosis.confidence * 100)}% confident
              </span>
            </div>

            <p className="text-coral-900">{a.diagnosis.rootCause}</p>

            {a.diagnosis.proposedDiff && (
              <pre className="bg-cream rounded-xl p-4 text-xs overflow-x-auto text-coral-900/80">
                {a.diagnosis.proposedDiff}
              </pre>
            )}

            {a.diagnosis.sandboxRuns[0] && (
              <p className="text-xs text-seafoam-600">
                ✓ Sandbox validated this fix ({a.diagnosis.sandboxRuns[0].result})
              </p>
            )}

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => decide(a.id, "approve")}
                disabled={busyId === a.id}
                className="bg-coral-600 hover:bg-coral-900 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                {busyId === a.id ? "Working…" : "Approve and open PR"}
              </button>
              <button
                onClick={() => decide(a.id, "reject")}
                disabled={busyId === a.id}
                className="border border-coral-200 text-coral-900/70 hover:bg-coral-50 px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}