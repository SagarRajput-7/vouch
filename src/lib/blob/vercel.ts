import { del, get, list, put } from "@vercel/blob";
import { assertSafeKey, type BlobObject, type BlobStore } from "./types";

export class VercelBlobStore implements BlobStore {
  constructor(private readonly token: string) {}

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    assertSafeKey(key);
    await put(key, Buffer.from(bytes), {
      access: "private",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      token: this.token,
    });
  }

  async get(key: string): Promise<BlobObject | null> {
    assertSafeKey(key);
    const result = await get(key, { access: "private", token: this.token, useCache: false });
    if (!result) return null;
    const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
    const contentType = (result.blob as { contentType?: string }).contentType ?? "application/octet-stream";
    return { bytes, contentType };
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    await del(key, { token: this.token });
  }

  async probe(): Promise<boolean> {
    try {
      await list({ limit: 1, token: this.token });
      return true;
    } catch {
      return false;
    }
  }
}
