import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import type { Holding } from "@/domain/types";
import { estimateTransferFeeLamports, fetchDevnetHoldings } from "./adapter";

export function useDevnetHoldings(address: string | null, enabled: boolean) {
  const { connection } = useConnection();
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [feeLamports, setFeeLamports] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !address) {
      setStatus("idle");
      setHoldings([]);
      setFeeLamports(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    Promise.all([fetchDevnetHoldings(connection, address), estimateTransferFeeLamports(connection, address)])
      .then(([nextHoldings, fee]) => {
        if (cancelled) return;
        setHoldings(nextHoldings);
        setFeeLamports(fee);
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address, attempt, connection, enabled]);

  return { status, holdings, feeLamports, retry: () => setAttempt((value) => value + 1) };
}
