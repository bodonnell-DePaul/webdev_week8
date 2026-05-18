/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// Allow importing 'virtual:pwa-register' when the plugin's types don't
// auto-resolve under our tsconfig.
declare module 'virtual:pwa-register' {
  export type RegisterSWOptions = {
    immediate?: boolean;
    onRegistered?: (r: ServiceWorkerRegistration | undefined) => void;
    onRegisterError?: (error: unknown) => void;
    onNeedRefresh?: () => void;
    onOfflineReady?: () => void;
  };
  export function registerSW(options?: RegisterSWOptions):
    (reloadPage?: boolean) => Promise<void>;
}

// `__WB_MANIFEST` is injected by Workbox at build time.
declare interface ServiceWorkerGlobalScope {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
}
