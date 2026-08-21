export default function Home() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 p-10">
      <h1 className="text-3xl font-bold tracking-tight">HackGuard</h1>
      <p className="text-neutral-400">
        Decision brain above Stripe&apos;s built-in retries: deterministic triage, model-timed
        retries, Visa/Mastercard compliance guardrails, and a hash-chained audit ledger.
      </p>
      <p className="rounded-md border border-neutral-800 bg-neutral-900 p-4 text-sm text-neutral-300">
        Scaffold stub — dashboard, decision feed, replay harness and explanation panel land in
        workstreams WS-B/WS-C (see <code>docs/architecture.md</code>).
      </p>
    </main>
  );
}
