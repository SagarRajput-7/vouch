import path from "node:path";
import { env } from "@/lib/env";
import { LocalFsBlobStore } from "./local-fs";
import type { BlobStore } from "./types";
import { VercelBlobStore } from "./vercel";

let store: BlobStore | undefined;

export function getBlobStore(): BlobStore {
  store ??= env.BLOB_READ_WRITE_TOKEN
    ? new VercelBlobStore(env.BLOB_READ_WRITE_TOKEN)
    : new LocalFsBlobStore(path.join(env.LOCAL_DATA_DIR, "blobs"));
  return store;
}

export type { BlobStore } from "./types";
