/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_DEVNET_USDC_MINT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
