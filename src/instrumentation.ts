export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDbReady } = await import("./lib/db/client");
    await ensureDbReady();
  }
}
