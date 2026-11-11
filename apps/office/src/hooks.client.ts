// The page's error and trace reports. It always starts the SDK: it cannot
// know before its data arrives whether the office has an address, and the
// relay drops what it gets when it has none.
import * as Sentry from '@sentry/sveltekit';
import { pageOptions } from '#lib/diagnostics.ts';
import { pageAnswer } from '#lib/ui/diagnostics.svelte.ts';

Sentry.init(pageOptions(pageAnswer));

export const handleError = Sentry.handleErrorWithSentry();
