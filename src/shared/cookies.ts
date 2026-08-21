export interface CookieSerializeOptions {
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "strict" | "lax" | "none";
  path?: string;
  maxAge?: number;
  expires?: Date;
}

/** Small hand-rolled cookie helpers so auth doesn't depend on a plugin whose type augmentation fights NestJS's Fastify typings. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  if (!header) return result;

  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }

  return result;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function serializeCookie(name: string, value: string, options: CookieSerializeOptions = {}): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];

  if (options.path) segments.push(`Path=${options.path}`);
  if (options.expires) segments.push(`Expires=${options.expires.toUTCString()}`);
  if (typeof options.maxAge === "number") segments.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) segments.push("HttpOnly");
  if (options.secure) segments.push("Secure");
  if (options.sameSite) segments.push(`SameSite=${capitalize(options.sameSite)}`);

  return segments.join("; ");
}

export function expireCookie(name: string, path: string): string {
  return serializeCookie(name, "", { path, maxAge: 0, expires: new Date(0) });
}
