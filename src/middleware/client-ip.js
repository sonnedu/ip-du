/**
 * client-ip.js
 * Middleware to extract the real client IP from various proxy headers.
 * Works in both Node.js and Cloudflare Workers environments.
 */

/**
 * Extract client IP from a Hono context.
 * Checks CF-Connecting-IP → X-Forwarded-For → X-Real-IP → socket address.
 * @param {import('hono').Context} c
 * @returns {string}
 */
export function extractClientIp(c) {
  // Cloudflare Workers: CF-Connecting-IP is the authoritative header
  const cfIp = c.req.header('CF-Connecting-IP');
  if (cfIp) return cfIp.trim();

  // X-Forwarded-For: take the first (leftmost) IP which is the original client
  const xForwardedFor = c.req.header('X-Forwarded-For');
  if (xForwardedFor) {
    const first = xForwardedFor.split(',')[0].trim();
    if (first) return first;
  }

  // X-Real-IP: set by some reverse proxies (nginx, Caddy)
  const xRealIp = c.req.header('X-Real-IP');
  if (xRealIp) return xRealIp.trim();

  // True-Client-IP: used by Cloudflare Enterprise / Akamai
  const trueClientIp = c.req.header('True-Client-IP');
  if (trueClientIp) return trueClientIp.trim();

  // Fallback: raw address from @hono/node-server
  // c.env is set by @hono/node-server to the IncomingMessage
  if (c.env?.incoming?.socket?.remoteAddress) {
    return c.env.incoming.socket.remoteAddress;
  }

  return '127.0.0.1';
}

/**
 * Hono middleware that sets c.set('clientIp', ip) for downstream handlers.
 */
export function clientIpMiddleware() {
  return async (c, next) => {
    const ip = extractClientIp(c);
    c.set('clientIp', ip);
    await next();
  };
}
