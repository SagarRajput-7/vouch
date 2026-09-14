import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { authSecret, env } from "@/lib/env";

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  plugins: [anonymous({ emailDomainName: "guest.vouch.local" })],
  advanced: { cookiePrefix: "vouch" },
});
