/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_FEATURED_NPUB?: string;
  readonly VITE_WC_PROJECT_ID?: string;
  readonly VITE_RELAYS?: string;
  readonly VITE_RP_A_URL?: string;
  readonly VITE_RP_B_URL?: string;
  readonly VITE_REPO_URL?: string;
}
