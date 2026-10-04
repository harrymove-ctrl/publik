import { Dialog } from "@/components/ui/dialog";
import { devnetExplorerTx } from "@/solana/adapter";
import { shortAddress } from "@/domain/format";
import type { TxStepState } from "./delegationTypes";

export interface AccountMetaRow {
  pubkey: string;
  name: string;
  isSigner: boolean;
  isWritable: boolean;
}

interface TxReviewDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  instructionName: string;
  accounts: AccountMetaRow[];
  expectedVersion?: string | number | bigint | null;
  effect: string;
  status: TxStepState;
  signature?: string | null;
  errorMessage?: string | null;
  onConfirm: () => void;
  confirmLabel?: string;
  disabled?: boolean;
}

export function TxReviewDialog({
  open,
  onClose,
  title,
  instructionName,
  accounts,
  expectedVersion,
  effect,
  status,
  signature,
  errorMessage,
  onConfirm,
  confirmLabel = "Sign transaction",
  disabled = false,
}: TxReviewDialogProps) {
  const isBusy = status === "awaiting-signature" || status === "submitted";
  const explorerUrl = signature ? devnetExplorerTx(signature) : null;

  return (
    <Dialog
      description="Inspect transaction details before signing. Solana executes transactions atomically."
      onClose={isBusy ? () => {} : onClose}
      open={open}
      title={title}
      wide
    >
      <div className="space-y-4 text-sm">
        {/* Instruction and version summary */}
        <div className="rounded-xl border border-border bg-surface/60 p-3.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-mono">Instruction</span>
            <span className="font-mono font-medium text-foreground bg-muted/60 px-2 py-0.5 rounded text-xs">
              {instructionName}
            </span>
          </div>
          {expectedVersion !== undefined && expectedVersion !== null && (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Expected policy version</span>
              <span className="font-mono text-foreground font-medium">v{expectedVersion.toString()}</span>
            </div>
          )}
          <div className="pt-2 border-t border-border/60">
            <span className="text-xs text-muted-foreground block mb-1">Effect:</span>
            <p className="text-xs text-foreground/90 leading-relaxed">{effect}</p>
          </div>
        </div>

        {/* Accounts list */}
        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-mono mb-2">Accounts ({accounts.length})</p>
          <div className="max-h-48 overflow-y-auto rounded-xl border border-border divide-y divide-border/60 font-mono text-xs">
            {accounts.map((acc, index) => (
              <div key={index} className="flex items-center justify-between p-2.5 hover:bg-muted/30">
                <div className="min-w-0 pr-2">
                  <div className="font-sans font-medium text-foreground truncate">{acc.name}</div>
                  <div className="text-[11px] text-muted-foreground truncate" title={acc.pubkey}>
                    {acc.pubkey.length > 20 ? shortAddress(acc.pubkey) : acc.pubkey}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 text-[10px]">
                  {acc.isSigner && (
                    <span className="rounded bg-brand/15 text-brand px-1.5 py-0.5 border border-brand/30">
                      Signer
                    </span>
                  )}
                  {acc.isWritable ? (
                    <span className="rounded bg-warning/15 text-warning px-1.5 py-0.5 border border-warning/30">
                      Writable
                    </span>
                  ) : (
                    <span className="rounded bg-muted text-muted-foreground px-1.5 py-0.5">
                      Read-only
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* State status box */}
        {status !== "idle" && (
          <div className={`rounded-xl border p-3 text-xs space-y-1.5 ${
            status === "confirmed"
              ? "border-brand/40 bg-brand/10 text-brand"
              : status === "failed"
              ? "border-danger/40 bg-danger/10 text-danger"
              : status === "unresolved"
              ? "border-warning/40 bg-warning/10 text-warning"
              : "border-border bg-surface text-foreground"
          }`}>
            <div className="flex items-center justify-between font-medium">
              <span>Status:</span>
              <span className="capitalize">{status.replace("-", " ")}</span>
            </div>
            {status === "awaiting-signature" && (
              <p className="text-muted-foreground">Approve the transaction in your Solana wallet extension.</p>
            )}
            {status === "submitted" && (
              <p className="text-muted-foreground">Transaction broadcast. Awaiting confirmation on Solana…</p>
            )}
            {signature && (
              <div className="pt-1 font-mono text-[11px] break-all">
                Signature: {shortAddress(signature)}
                {explorerUrl && (
                  <a className="ml-2 underline font-sans text-brand" href={explorerUrl} rel="noreferrer" target="_blank">
                    View on explorer
                  </a>
                )}
              </div>
            )}
            {errorMessage && (
              <p className="text-danger font-sans text-xs pt-1">{errorMessage}</p>
            )}
          </div>
        )}

        {/* Dialog action buttons */}
        <div className="flex justify-end gap-2 pt-2">
          {status !== "confirmed" && (
            <button
              className="glass-quiet h-9 rounded-lg px-3 text-xs focus-visible:ring-2 focus-visible:ring-focus"
              disabled={isBusy}
              onClick={onClose}
              type="button"
            >
              Cancel
            </button>
          )}
          {status === "confirmed" ? (
            <button
              className="h-9 rounded-lg bg-primary px-4 text-xs font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-focus"
              onClick={onClose}
              type="button"
            >
              Done
            </button>
          ) : (
            <button
              className="h-9 rounded-lg bg-brand px-4 text-xs font-medium text-[#2a100e] hover:brightness-105 active:brightness-95 disabled:opacity-50 transition-all focus-visible:ring-2 focus-visible:ring-focus shadow-xs"
              disabled={disabled || isBusy}
              onClick={onConfirm}
              type="button"
            >
              {isBusy ? "Processing…" : confirmLabel}
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
}
