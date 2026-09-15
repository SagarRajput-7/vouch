import { loadImage } from "@napi-rs/canvas";
import { StageError } from "@/lib/pipeline/errors";

export async function imageSize(bytes: Uint8Array): Promise<{ width: number; height: number }> {
  try {
    const img = await loadImage(Buffer.from(bytes));
    if (!img.width || !img.height) throw new Error("image has no dimensions");
    return { width: img.width, height: img.height };
  } catch (err) {
    throw new StageError("image_unreadable", "This image could not be read. It may be damaged.", err instanceof Error ? err.message : String(err), { retryable: false });
  }
}
