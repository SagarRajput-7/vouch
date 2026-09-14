import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { user, workspaces } from "@/lib/db/schema";

describe("database", () => {
  it("migrates and round-trips a workspace", async () => {
    const db = getDb();
    const [u] = await db
      .insert(user)
      .values({ id: "u1", name: "Guest", email: "u1@guest.vouch.local", emailVerified: false, isAnonymous: true, createdAt: new Date(), updatedAt: new Date() })
      .returning();
    const [ws] = await db.insert(workspaces).values({ ownerUserId: u.id }).returning();
    const found = await db.query.workspaces.findFirst({ where: eq(workspaces.id, ws.id) });
    expect(found?.kind).toBe("guest");
    expect(found?.ownerUserId).toBe("u1");
  });
});
