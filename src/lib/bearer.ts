import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Checks an `Authorization: Bearer <secret>` header against a server secret in
 * constant time. "unconfigured" means the server's own secret is missing or too
 * short, so nothing is served.
 */
export function checkBearer(
  header: string | null,
  secret: string | undefined,
  minLength = 32,
): "ok" | "unconfigured" | "denied" {
  const expected = secret?.trim() ?? "";
  if (expected.length < minLength) return "unconfigured";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  if (!match) return "denied";
  const given = createHash("sha256").update(match[1]).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, wanted) ? "ok" : "denied";
}
