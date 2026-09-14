import { describe, expect, it } from "vitest";
import { startGuestSession } from "@/lib/auth/session";
import { documentsRepo } from "@/lib/repo/documents";

async function workspace(): Promise<string> {
  return (await startGuestSession()).info.workspaceId;
}

describe("workspace isolation", () => {
  it("never returns another workspace's documents", async () => {
    const a = await workspace();
    const b = await workspace();
    const doc = await documentsRepo.create({
      workspaceId: a,
      originalFilename: "one.pdf",
      mime: "application/pdf",
      byteSize: 10,
      sha256: "abc",
      blobKey: `${a}/abc.pdf`,
    });
    expect(await documentsRepo.getById(a, doc.id)).not.toBeNull();
    expect(await documentsRepo.getById(b, doc.id)).toBeNull();
    expect(await documentsRepo.listByWorkspace(b)).toHaveLength(0);
    expect(await documentsRepo.findBySha(b, "abc")).toBeNull();
    expect(await documentsRepo.delete(b, doc.id)).toBe(false);
    expect(await documentsRepo.delete(a, doc.id)).toBe(true);
  });
});
