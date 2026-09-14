export type BlobObject = { bytes: Uint8Array; contentType: string };

export interface BlobStore {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<BlobObject | null>;
  delete(key: string): Promise<void>;
  probe(): Promise<boolean>;
}

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/;

export function assertSafeKey(key: string): void {
  if (!SAFE_KEY.test(key) || key.includes("..")) throw new Error(`Unsafe blob key: ${key}`);
}
