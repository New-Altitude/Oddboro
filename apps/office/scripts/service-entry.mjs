// Set up the private channel from the same process that owns the HTTP
// handler. The office supplies the per-launch client key after startup.
import { serveOwner } from './service-channel.mjs';
if (process.env.ODDBORO_SERVICE_MODE === '1') {
  globalThis[Symbol.for('oddboro.start-owner')] = async (key) => {
    const control = await serveOwner(
      process.env.ODDBORO_HOME, key, Number(process.env.PORT || process.env.ODDBORO_PORT),
      async (req,res) => {
        const {handler} = await import('../build/handler.js');
        handler(req,res,()=>res.writeHead(404).end());
      },
      () => {
        control.close();
        process.env.ODDBORO_STOP_REQUESTED = '1';
        process.emit('SIGTERM');
      }
    );
    process.once('sveltekit:shutdown',()=>control.close());
  };
}
await import('../build/index.js');
