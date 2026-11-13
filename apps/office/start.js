// The built office's entry, the file the app runs. adapter-node's server
// listens on one host, 127.0.0.1, and this holds [::1] on the same port for it
// (`holdIpv6Loopback`), so no other program can sit on the address a
// `.localhost` name reaches first.
import { holdIpv6Loopback } from '@oddboro/ledger/ipv6-loopback';

// Imported by a path made at run time so the type check, which reads this
// file, does not follow it into the build's own code. The build starts the
// server as it loads and exports it.
const { server } = await import(new URL('./build/index.js', import.meta.url).href);
holdIpv6Loopback(server);
