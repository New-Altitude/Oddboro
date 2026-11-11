// The office's own names, alone in this file because the error reporting
// setup loads before the server and must not pull in the ledger or Postgres.

/** The names Caddy answers to, best first. The first one is served over HTTPS too. */
export const HOSTS = ['local.oddboro.com', 'oddboro.localhost'];
