import { useEffect, useState } from "react";
import { examplePortfolio, fetchMainnetPortfolio, type MainnetPortfolio } from "./mainnetPortfolio";

export function useMainnetPortfolio(address: string | null) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [portfolio, setPortfolio] = useState<MainnetPortfolio>(() => examplePortfolio(new Date().toISOString()));

  useEffect(() => {
    if (!address) {
      setPortfolio(examplePortfolio(new Date().toISOString()));
      setStatus("ready");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetchMainnetPortfolio(address)
      .then((next) => {
        if (cancelled) return;
        setPortfolio(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { status, portfolio };
}
