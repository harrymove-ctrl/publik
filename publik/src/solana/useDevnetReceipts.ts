import { useConnection } from "@solana/wallet-adapter-react";
import { useEffect, useState } from "react";
import { devnetUsdcMint } from "./adapter";
import { fetchDevnetReceipts, type Receipt } from "./receipts";

export function useDevnetReceipts(address: string | null, enabled: boolean) {
  const { connection } = useConnection();
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [receipts, setReceipts] = useState<Receipt[]>([]);

  useEffect(() => {
    if (!enabled || !address) {
      setStatus("idle");
      setReceipts([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    fetchDevnetReceipts(connection, address, devnetUsdcMint())
      .then((next) => {
        if (cancelled) return;
        setReceipts(next);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [address, connection, enabled]);

  return { status, receipts };
}
