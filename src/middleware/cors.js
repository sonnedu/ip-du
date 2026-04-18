/**
 * cors.js
 * Permissive CORS middleware for the /api/* routes.
 * Allows all origins so the API can be used from any client.
 */

export function corsMiddleware() {
  return async (c, next) => {
    // Handle pre-flight OPTIONS
    if (c.req.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(c),
      });
    }

    await next();

    // Attach CORS headers to the actual response
    for (const [key, value] of Object.entries(corsHeaders(c))) {
      c.res.headers.set(key, value);
    }
  };
}

function corsHeaders(c) {
  const origin = c.req.header('Origin') || '*';
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}
