import { describe, it, expect, vi } from "vitest";
vi.mock("@/generated/prisma/client", () => ({ PrismaClient: class {} }));
vi.mock("@prisma/adapter-pg", () => ({ PrismaPg: class {} }));
process.env.DATABASE_URL ??= "postgresql://x@localhost/x";
const { explicitSslMode } = await import("@/lib/db");

describe("explicitSslMode", () => {
  it("spells out verify-full (same behaviour, no warning)", () => {
    expect(explicitSslMode("postgresql://u:p@h/db?sslmode=require&channel_binding=require")).toBe(
      "postgresql://u:p@h/db?sslmode=verify-full&channel_binding=require",
    );
    expect(explicitSslMode("postgresql://u:p@h/db?a=1&sslmode=require")).toBe("postgresql://u:p@h/db?a=1&sslmode=verify-full");
  });
  it("leaves other URLs alone", () => {
    expect(explicitSslMode("postgresql://lendo:lendo@localhost:5432/lendo")).toBe("postgresql://lendo:lendo@localhost:5432/lendo");
    expect(explicitSslMode("postgresql://h/db?sslmode=disable")).toBe("postgresql://h/db?sslmode=disable");
  });
});
