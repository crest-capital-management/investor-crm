/** Runs once when the server starts, before it handles any request. */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateEnv } = await import("./lib/env");
    validateEnv();

    const { initEncryption } = await import("./lib/encryption-init");
    await initEncryption();
  }
}
