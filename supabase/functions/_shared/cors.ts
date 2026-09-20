const PROD_ORIGIN = "https://nexus-nine-zeta.vercel.app";
const LOCAL_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function corsHeadersFor(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") || "";
  const allowOrigin = origin === PROD_ORIGIN || LOCAL_ORIGIN_RE.test(origin) ? origin : PROD_ORIGIN;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-nexus-bucket, x-nexus-path, x-nexus-mime, x-nexus-upsert",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}