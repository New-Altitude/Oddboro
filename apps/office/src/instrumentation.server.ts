// Loaded before the server, so tracing can hook modules as they load. With no
// address for reports, the SDK never starts.
import * as Sentry from '@sentry/sveltekit';
import { serverOptions } from '#lib/server/diagnostics.ts';

const options = serverOptions();
if (options) Sentry.init(options);
