// Cloudflare Pages Function: passes every /api/* request on to the Node
// server (Render) and its answer back, so the pages served by Cloudflare
// reach the API on their own domain. Sign-in cookies then belong to this
// domain, and live updates (Server-Sent Events) stream straight through.
//
// The server's address can be changed with the API_ORIGIN environment
// variable in the Pages project settings.

const DEFAULT_API_ORIGIN = 'https://formulation-test-tracker.onrender.com';

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
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
