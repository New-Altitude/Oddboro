// The Worker in front of oddboro.com. Every path is a static file from build/,
// served before this code runs, except /ingest/*, which wrangler.jsonc routes
// here: the site's analytics, forwarded to PostHog's US cloud, so a visitor's
// browser talks to oddboro.com alone. It forwards the visitor's IP so PostHog
// can tell the country, and drops oddboro.com's cookies, which PostHog has no
// use for.
const API = 'us.i.posthog.com';
const ASSETS = 'us-assets.i.posthog.com';

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/ingest/, '') || '/';
    url.hostname = path.startsWith('/static/') ? ASSETS : API;
    url.pathname = path;
    url.port = '';
    url.protocol = 'https:';
    const headers = new Headers(request.headers);
    headers.delete('cookie');
    headers.delete('host');
    const ip = request.headers.get('cf-connecting-ip');
    if (ip) headers.set('x-forwarded-for', ip);
    const upstream = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'HEAD' ? null : request.body,
      redirect: 'manual'
    });
    // PostHog's own HSTS (with includeSubDomains) and any cookie of its would
    // otherwise land on oddboro.com. The site sets those itself or not at all.
    const reply = new Response(upstream.body, upstream);
    reply.headers.delete('strict-transport-security');
    reply.headers.delete('set-cookie');
    return reply;
  }
};
