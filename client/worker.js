// Cloudflare Worker: the pages in this folder are served as static assets,
// and every /api/* request is passed on to the Node server (Render) with
// its answer passed back. The pages then reach the API on their own
// domain, so sign-in cookies belong to it, and live updates (Server-Sent
// Events) stream straight through.
//
// The server's address can be changed with the API_ORIGIN variable
// (wrangler.jsonc "vars", or the Worker's settings in the dashboard).

const DEFAULT_API_ORIGIN = 'https://formulation-test-tracker.onrender.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);

    const target = new URL(url.pathname + url.search, env.API_ORIGIN || DEFAULT_API_ORIGIN);
    const headers = new Headers(request.headers);
    headers.delete('host');
    const init = { method: request.method, headers, redirect: 'manual' };
    // Request bodies are small JSON; reading them whole keeps this simple.
    if (request.method !== 'GET' && request.method !== 'HEAD') init.body = await request.arrayBuffer();

    try {
      return await fetch(target, init);
    } catch (err) {
      return Response.json({ error: "can't reach the tracker server — try again in a minute" }, { status: 502 });
    }
  }
};
