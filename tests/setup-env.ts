// Next's global types declare NODE_ENV readonly (it is normally inlined at build time), so a
// direct assignment fails `tsc --noEmit` under strict mode. The cast keeps this a real, checked
// assignment for the one case we need it: setting a default before tests import validated env.
(process.env as { NODE_ENV?: string }).NODE_ENV ??= "test";
// Integration tests run on real Postgres when TEST_DATABASE_URL is set. It must be mapped here,
// before any module reads the validated env at import time.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.BETTER_AUTH_SECRET ??= "test-secret-at-least-sixteen-chars";
process.env.BETTER_AUTH_URL ??= "http://localhost:3000";
process.env.LLM_MODE ??= "mock";
process.env.PGLITE_DATA_DIR ??= ":memory:";
process.env.LOCAL_DATA_DIR ??= ".data/test";
