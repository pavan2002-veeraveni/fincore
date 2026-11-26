import Link from 'next/link';

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-950 via-fincore-navy to-slate-900 text-white">
      <div className="bg-amber-400 px-4 py-2 text-center text-xs font-semibold text-slate-950">
        EDUCATIONAL SIMULATION PLATFORM — Synthetic Users, Synthetic INR Balances &amp; Sandbox Integrations Only
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <span className="text-xl font-bold tracking-tight">FinCore</span>
        <nav className="flex items-center gap-4">
          <Link
            href="/login"
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-200 hover:bg-white/10"
          >
            Sign In
          </Link>
          <Link
            href="/register"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-emerald-400"
          >
            Register Synthetic User
          </Link>
        </nav>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-16">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-emerald-400">
            Simulated Core Banking &amp; Payment Processing
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
            Double-Entry Ledger Engineering, Made Demonstrable.
          </h1>
          <p className="mt-5 text-base leading-relaxed text-slate-300">
            FinCore models production-grade fintech reliability: immutable balanced journals,
            deterministic row-locked transfers, idempotency fingerprinting, HMAC-signed sandbox
            webhooks, CSV statements, dispute workflows, reconciliation exceptions, and FastAPI
            Decimal risk analytics.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/login"
              className="rounded-lg bg-white px-5 py-2.5 text-sm font-semibold text-fincore-navy hover:bg-slate-100"
            >
              Launch Demo Console
            </Link>
            <Link
              href="/register"
              className="rounded-lg border border-slate-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Create Synthetic Account
            </Link>
          </div>
        </div>

        <section className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: 'Atomic Double-Entry Ledger',
              desc: 'PostgreSQL deferred balance constraint triggers + append-only ledger_entries and compensating refunds.',
            },
            {
              title: 'Consistency & Concurrency',
              desc: 'Idempotency-Key request hashing, sorted SELECT ... FOR UPDATE locks, and two-step active holds.',
            },
            {
              title: 'Operations, Risk & Reconciliation',
              desc: 'FastAPI Decimal risk scoring, reconciliation matching engine, support dispute queues, and immutable audit trail.',
            },
          ].map((card) => (
            <div
              key={card.title}
              className="rounded-xl border border-white/10 bg-white/5 p-6 backdrop-blur"
            >
              <h2 className="text-base font-semibold text-white">{card.title}</h2>
              <p className="mt-2 text-sm text-slate-300">{card.desc}</p>
            </div>
          ))}
        </section>
      </main>
    </div>
  );
}
