import type * as Sentry from "@sentry/nextjs";

function urlWithoutPrivateParts(value: string | undefined) {
  if (!value) return value;
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

/** Keep stack traces, but remove request content, identity and custom lead data. */
export function sanitizeSentryEvent(event: Sentry.ErrorEvent): Sentry.ErrorEvent {
  return {
    ...event,
    user: undefined,
    extra: undefined,
    request: event.request
      ? {
          method: event.request.method,
          url: urlWithoutPrivateParts(event.request.url),
        }
      : undefined,
  };
}

// Error monitoring only: no replay, tracing, logs, breadcrumbs, user details,
// request bodies, query strings, database payloads or AI input/output.
export const sentryBaseOptions: Parameters<typeof Sentry.init>[0] = {
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  environment: process.env.VERCEL_ENV || process.env.NODE_ENV,
  tracesSampleRate: 0,
  maxBreadcrumbs: 0,
  dataCollection: {
    userInfo: false,
    cookies: false,
    httpHeaders: false,
    httpBodies: [],
    urlQueryParams: false,
    graphQL: { document: false, variables: false },
    genAI: { inputs: false, outputs: false },
    mcp: { inputs: false, outputs: false },
    databaseQueryData: false,
    queues: false,
    stackFrameVariables: false,
    frameContextLines: 0,
  },
  beforeSend: sanitizeSentryEvent,
};
