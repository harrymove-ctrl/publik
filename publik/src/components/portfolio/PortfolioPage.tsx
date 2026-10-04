import { MainnetPortfolioCard } from "@/components/agent/MainnetPortfolioCard";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { holdingFiat, holdingQuantity } from "@/domain/format";
import { demoPortfolioUsd } from "@/domain/product";
import { configuredDemoMainnetAddress } from "@/solana/mainnetPortfolio";
import { useMainnetPortfolio } from "@/solana/useMainnetPortfolio";
import { useStore } from "@/state/store";

export function PortfolioPage() {
  const { state } = useStore();
  const demo = demoPortfolioUsd(state.agents);
  const mainnet = useMainnetPortfolio(configuredDemoMainnetAddress());
  const demoAgents = state.agents.filter((agent) => agent.walletMode === "demo");

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-6 sm:px-8">
      <h1 className="text-3xl font-medium tracking-tight">Portfolio</h1>
      <p className="mt-2 max-w-xl text-sm text-muted-foreground">Demo balances and the mainnet watch are separate. Publik cannot send from the mainnet address.</p>
      <section className="mt-6 rounded-2xl border border-border bg-surface p-4">
        <h2 className="text-base font-medium">Demo wallets</h2>
        <p className="mt-1 text-2xl tabular-nums">{demo.usd ? `$${demo.usd}` : "No price"}</p>
        <p className="text-sm text-muted-foreground">{demo.assets} assets across demo agents. This is not mainnet.</p>
        <ul className="mt-3 grid gap-2">
          {demoAgents.map((agent) => (
            <li key={agent.id}>
              <p className="text-sm">{agent.name}</p>
              <ul>
                {agent.holdings.map((holding) => (
                  <li className="flex justify-between gap-3 text-sm" key={`${agent.id}-${holding.symbol}`}>
                    <span>{holding.symbol}</span>
                    <span className="tabular-nums">{holdingQuantity(holding)} <span className="text-muted-foreground">{holdingFiat(holding) ?? "Price unavailable"}</span></span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
      <TooltipProvider>
        <p className="mt-4 text-sm">
          Mainnet portfolio · view only{" "}
          <Tooltip>
            <TooltipTrigger className="underline">What this means</TooltipTrigger>
            <TooltipContent>This address is observed only. Publik cannot send, sign, or approve from it.</TooltipContent>
          </Tooltip>
        </p>
      </TooltipProvider>
      <MainnetPortfolioCard portfolio={mainnet.portfolio} status={mainnet.status} />
    </div>
  );
}
