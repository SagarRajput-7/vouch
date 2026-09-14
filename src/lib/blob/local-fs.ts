import { mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { assertSafeKey, type BlobObject, type BlobStore } from "./types";

export class LocalFsBlobStore implements BlobStore {
  constructor(private readonly root: string) {}

  private resolve(key: string): string {
    assertSafeKey(key);
    return path.join(this.root, key);
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const file = this.resolve(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes);
    await writeFile(`${file}.meta.json`, JSON.stringify({ contentType }));
  }

  async get(key: string): Promise<BlobObject | null> {
    const file = this.resolve(key);
    try {
      const [bytes, meta] = await Promise.all([readFile(file), readFile(`${file}.meta.json`, "utf8")]);
      return { bytes: new Uint8Array(bytes), contentType: (JSON.parse(meta) as { contentType: string }).contentType };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const file = this.resolve(key);
    await rm(file, { force: true });
    await rm(`${file}.meta.json`, { force: true });
  }

  async probe(): Promise<boolean> {
    try {
      await mkdir(this.root, { recursive: true });
      await access(this.root);
      return true;
    } catch {
      return false;
    }
  }
}
