// /lib/sentry.js
// Shared Sentry setup — call initSentry() once at the top of each
// API handler, then use Sentry.captureException(err) in catch blocks.

import * as Sentry from '@sentry/node';

let initialized = false;

export function initSentry() {
  if (initialized) return;
  Sentry.init({
    dsn: 'https://4a552a592fb1cc665915d1c59d8ee34e@o4511994101825536.ingest.us.sentry.io/4511994137346048',
    tracesSampleRate: 0, // errors only for now, no performance tracing
  });
  initialized = true;
}

export { Sentry };
