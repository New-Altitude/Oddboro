// The office listens on 127.0.0.1, and this holds [::1] on the same port too.
// A name such as oddboro.localhost resolves to ::1 first, so whatever holds
// [::1]:<port> gets the browser. A program there could hand only the office's
// proof on to 127.0.0.1, pass it, and then catch the keyed open that follows.
// With the office holding [::1] itself, no other program can bind it.
//
// Neither the built office nor Vite's dev server can listen on two hosts, so
// a plain listener on [::1] hands each socket it accepts to the office's one
// HTTP server. That server alone handles requests, so its guards, live reload
// and its shutdown cover both addresses with no second request path.
import { createServer, type Server } from 'node:net';

/** A system with no IPv6 loopback refuses the bind with one of these. */
const NO_IPV6 = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT']);

/**
 * Holds [::1] on the port `office` listens on, once it listens, and hands it
 * each socket. With no IPv6 loopback the office runs on 127.0.0.1 alone, and
 * the prover's every-address rule then fails a name that resolves to ::1.
 * Any other failure to bind, such as another program on [::1]:<port>, becomes
 * `office`'s own 'error', so the office stops as it does when 127.0.0.1 is
 * taken.
 */
export function holdIpv6Loopback(office: Server): void {
  // The options Node's HTTP server gives its own listener: a socket the client
  // half-closed stays open for the reply, and replies go without delay.
  const v6 = createServer({ allowHalfOpen: true, noDelay: true }, (socket) =>
    office.emit('connection', socket)
  );
  v6.on('error', (error: NodeJS.ErrnoException) => {
    if (!NO_IPV6.has(error.code ?? '')) office.emit('error', error);
  });
  v6.once('listening', () => {
    // The office counts only the sockets it accepted itself, so its close
    // would call back, and the office shut down, while a request that came in
    // on [::1] still runs. Its close stops [::1] too, and calls back once both
    // have drained.
    const close = office.close;
    office.close = function (callback?: (error?: Error) => void) {
      const drained = new Promise<void>((done) => v6.close(() => done()));
      return close.call(this, (error) => {
        if (error) callback?.(error);
        else void drained.then(() => callback?.());
      });
    };
  });
  const bind = () => {
    const at = office.address();
    if (at && typeof at === 'object') v6.listen({ host: '::1', port: at.port });
  };
  if (office.listening) bind();
  else office.once('listening', bind);
}
