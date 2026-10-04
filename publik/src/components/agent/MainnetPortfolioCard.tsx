import type { MainnetPortfolio } from "@/solana/mainnetPortfolio";

export function MainnetPortfolioCard({
  status,
  portfolio,
}: {
  status: "loading" | "ready" | "error";
  portfolio: MainnetPortfolio;
}) {
  const when = new Date(portfolio.readAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <section aria-label="Mainnet portfolio" className="mt-3 rounded-2xl border border-border bg-surface p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-base font-medium">Portfolio</h2>
        <p className="text-xs text-muted-foreground">{portfolio.example ? "Example data" : `Updated ${when}`}</p>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">Mainnet, view only. Publik cannot send, sign, or approve from this address.</p>
      {status === "loading" ? <p className="mt-3 text-sm text-muted-foreground">Reading mainnet…</p> : null}
      {status === "error" ? <p className="mt-3 text-sm">Could not read this mainnet address.</p> : null}
      {status === "ready" ? (
        <>
          <p className="mt-3 text-2xl font-medium tabular-nums">{portfolio.totalUsd === null ? "No price" : `$${portfolio.totalUsd}`}</p>
          <ul className="mt-2 divide-y divide-border">
            {portfolio.lines.map((line) => (
              <li className="flex items-center justify-between gap-3 py-2 text-sm" key={line.mint ?? line.symbol}>
                <span>{line.label}</span>
                <span className="text-right tabular-nums">
                  {line.amount}
                  <span className="block text-xs text-muted-foreground">{line.usd === null ? "No price" : `$${line.usd}`}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
