import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { currentRpcConfig } from "@/solana/adapter";
import {
  allowance,
  decodeVault,
  VAULT_PROGRAM_ID,
  vaultTokenAccount,
  type Allowance,
  type VaultState,
} from "@/solana/vault";
import { fetchAgentDelegation } from "./delegationApi";
import type { DelegationApiResponse, DelegationLiveState } from "./delegationTypes";

const VAULT_STORAGE_PREFIX = "publik.delegation.vault.";
const SETUP_STORAGE_PREFIX = "publik.delegation.setup.";

export function getStoredVaultAddress(agentId: string): string | null {
  try {
    const raw = localStorage.getItem(`${VAULT_STORAGE_PREFIX}${agentId}`);
    if (raw) {
      const parsed = JSON.parse(raw) as { vaultAddress?: string; address?: string };
      if (parsed.vaultAddress) return parsed.vaultAddress;
      if (parsed.address) return parsed.address;
    }
    const setupRaw = localStorage.getItem(`${SETUP_STORAGE_PREFIX}${agentId}`);
    if (setupRaw) {
      const setup = JSON.parse(setupRaw) as { vaultAddress?: string };
      if (setup.vaultAddress) return setup.vaultAddress;
    }
  } catch {
    // Ignore storage parse errors
  }
  return null;
}

export function storeVaultAddress(
  agentId: string,
  data: { vaultAddress: string; owner: string; vaultIdHex: string; executionKey: string; mint: string },
): void {
  try {
    localStorage.setItem(`${VAULT_STORAGE_PREFIX}${agentId}`, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
}

export function useAgentDelegation(agentId: string): DelegationLiveState {
  const { connection } = useConnection();
  const [state, setState] = useState<Omit<DelegationLiveState, "refresh">>({
    mode: "owner-signed",
    deployed: false,
    cluster: currentRpcConfig().cluster,
    clusterLabel: currentRpcConfig().clusterLabel,
    programId: VAULT_PROGRAM_ID.toBase58(),
    vault: null,
    vaultAddress: null,
    vaultBalanceBase: 0n,
    allowanceInfo: null,
    serverData: null,
    slot: null,
    readAt: null,
    loading: true,
    error: null,
  });

  const load = useCallback(async () => {
    if (!agentId) return;
    const rpcConf = currentRpcConfig();

    try {
      // 1. Check live program deployment on the connected cluster
      let isDeployed = false;
      let slot: number | null = null;
      try {
        const progInfo = await connection.getAccountInfo(VAULT_PROGRAM_ID, "confirmed");
        isDeployed = Boolean(progInfo && progInfo.executable);
        slot = await connection.getSlot("confirmed").catch(() => null);
      } catch (err) {
        console.warn("Could not check program deployment:", err);
      }

      // 2. Fetch server record
      const serverData: DelegationApiResponse | null = await fetchAgentDelegation(agentId).catch(() => null);

      // 3. Resolve vault address (from server or localStorage)
      let resolvedVaultAddr = serverData?.vault?.address ?? null;
      if (!resolvedVaultAddr) {
        resolvedVaultAddr = getStoredVaultAddress(agentId);
      }

      let vaultState: VaultState | null = null;
      let vaultBalance = 0n;
      let allowanceInfo: Allowance | null = null;

      if (resolvedVaultAddr) {
        try {
          const vaultPubkey = new PublicKey(resolvedVaultAddr);
          const accountInfo = await connection.getAccountInfo(vaultPubkey, "confirmed");
          if (accountInfo && accountInfo.data.length > 0) {
            vaultState = decodeVault(vaultPubkey, accountInfo.data, accountInfo.owner);

            // Read token balance from vault authority ATA
            const mintPubkey = new PublicKey(vaultState.mint);
            const vaultAta = vaultTokenAccount(vaultPubkey, mintPubkey);
            try {
              const ataBalance = await connection.getTokenAccountBalance(vaultAta, "confirmed");
              vaultBalance = BigInt(ataBalance.value.amount);
            } catch {
              vaultBalance = 0n;
            }

            const nowTs = BigInt(Math.floor(Date.now() / 1000));
            allowanceInfo = allowance(vaultState, nowTs, vaultBalance);
          }
        } catch (vaultErr) {
          console.warn("Could not decode vault on chain:", vaultErr);
        }
      }

      // Mode is delegated ONLY when program is deployed, vault is decoded, and vault is not revoked
      const isDelegated = Boolean(isDeployed && vaultState && !vaultState.revoked);

      setState({
        mode: isDelegated ? "delegated" : "owner-signed",
        deployed: isDeployed,
        cluster: rpcConf.cluster,
        clusterLabel: rpcConf.clusterLabel,
        programId: VAULT_PROGRAM_ID.toBase58(),
        vault: vaultState,
        vaultAddress: vaultState ? vaultState.address : resolvedVaultAddr,
        vaultBalanceBase: vaultBalance,
        allowanceInfo,
        serverData,
        slot,
        readAt: new Date().toLocaleTimeString(),
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((prev) => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [agentId, connection]);

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 15_000);
    return () => clearInterval(timer);
  }, [load]);

  return { ...state, refresh: load };
}
