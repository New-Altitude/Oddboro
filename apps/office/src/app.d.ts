// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Platform {
      req?: { [key: symbol]: unknown };
    }
    interface Locals {
      ownerCommand?: boolean;
    }
  }
  /** The public site's address, set by `siteUrl` in vite.config.ts. */
  const __SITE_URL__: string;
}

export {};
