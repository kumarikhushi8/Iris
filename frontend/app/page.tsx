import { Mascot } from "@/components/Mascot";

export default function Home() {
  return (
    <main className="min-h-screen bg-cream flex flex-col items-center justify-center gap-8 px-6 text-center">
      <Mascot size={180} />
      <div className="space-y-3">
        <h1 className="text-4xl font-medium text-coral-900">Meet Iris</h1>
        <p className="text-lg text-coral-900/70 max-w-md">
          Iris watches your builds, figures out what broke, and only ever
          shows you a fix once she's actually tried it.
        </p>
      </div>
      <button className="bg-coral-600 hover:bg-coral-900 text-white px-6 py-3 rounded-2xl text-base font-medium shadow-lg shadow-coral-200/50 transition-colors">
        Connect a repo
      </button>
    </main>
  );
}