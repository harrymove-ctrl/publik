import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { PhantomWalletAdapter, SolflareWalletAdapter } from "@solana/wallet-adapter-wallets";
import { useMemo, type ReactNode } from "react";
import { resolveDevnetRpc } from "./adapter";

const resolved = resolveDevnetRpc(import.meta.env.VITE_SOLANA_RPC_URL);

export const rejectedMainnetRpc = resolved.rejectedMainnet;
export const resolvedCluster = resolved.cluster;
export const resolvedClusterLabel = resolved.clusterLabel;
export const resolvedRpcEndpoint = resolved.endpoint;
export function SolanaProviders({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter(), new SolflareWalletAdapter()], []);
  return (
    <ConnectionProvider endpoint={resolved.endpoint}>
      <WalletProvider autoConnect wallets={wallets}>
        {children}
      </WalletProvider>
    </ConnectionProvider>
  );
}
