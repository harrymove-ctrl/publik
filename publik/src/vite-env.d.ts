/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SOLANA_RPC_URL?: string;
  readonly VITE_DEVNET_USDC_MINT?: string;
  readonly VITE_DEMO_MAINNET_WATCH_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
