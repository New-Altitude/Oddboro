// The graphical app and headless service both use the adapter's one server.
import { server } from '../build/index.js';
import { handler } from '../build/handler.js';
import { serveOwner } from './service-channel.mjs';

if (process.env.ODDBORO_SERVICE_MODE === '1') {
  const control = await serveOwner(
    process.env.ODDBORO_HOME,
    process.env.ODDBORO_SERVICE_KEY,
    Number(process.env.ODDBORO_PORT),
    handler,
    () => {
      control.close();
      // The supervisor recognizes the owner's explicit stop and will not restart Node.
      process.env.ODDBORO_STOP_REQUESTED = '1';
      process.emit('SIGTERM');
    }
  );
  server.once('close', () => control.close());
}
