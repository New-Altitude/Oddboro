// Trust the certificates this computer trusts, as a browser does. Node checks
// HTTPS against its own built-in list and ignores the system's. A company
// network or an antivirus that checks secure connections signs them with a
// root it put in the system's store, so without this every request from the
// office fails there (UNABLE_TO_VERIFY_LEAF_SIGNATURE) while the browser works.
// It only adds: every root Node trusts already stays trusted.
import tls from 'node:tls';

/** Once, before the process's first HTTPS request. Never throws: a store that will not read changes nothing. */
export function trustSystemCertificates(): void {
  // Node 24.5 added both calls. An older 24 keeps its own list, as before.
  if (typeof tls.setDefaultCACertificates !== 'function') return;
  try {
    const system = tls.getCACertificates('system');
    if (!system.length) return;
    tls.setDefaultCACertificates([...new Set([...tls.getCACertificates('default'), ...system])]);
  } catch (e) {
    console.error(
      `[certificates] the system's certificates did not load, so only Node's own are trusted: ${e instanceof Error ? e.message : String(e)}`
    );
  }
}
