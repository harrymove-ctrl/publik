export type DelegatedGateInput = {
  deployed: boolean;
  transaction?: unknown;
  chainVerified?: boolean;
  vault?: {
    paused: boolean;
    revoked: boolean;
    executionKey: string;
    owner: string;
    recipients?: string[];
  } | null;
  agentKey?: string;
  recipient?: string;
};

/**
 * Gates whether the agent CLI may sign a delegated payment.
 *
 * Rules enforced:
 * - Must never sign a server-provided transaction (Publik never constructs executable txs).
 * - Program must be deployed on-chain.
 * - State must be verified directly against the chain, not API flags alone.
 * - Vault must not be paused or revoked.
 * - Agent execution key must match on-chain execution key and must not be the owner.
 * - Recipient must be on the on-chain allowlist (if checked).
 */
export function maySignDelegated(input: DelegatedGateInput): boolean {
  // Never sign a server-provided transaction
  if (input.transaction != null) return false;

  // Program must be deployed on-chain
  if (!input.deployed) return false;

  // Must be verified on-chain
  if (input.chainVerified !== true) return false;

  // If vault state is provided, check on-chain constraints
  if (input.vault) {
    if (input.vault.paused || input.vault.revoked) return false;
    if (input.agentKey) {
      if (input.agentKey === input.vault.owner) return false;
      if (input.agentKey !== input.vault.executionKey) return false;
    }
    if (input.recipient && input.vault.recipients && !input.vault.recipients.includes(input.recipient)) {
      return false;
    }
  }

  return true;
}
