import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { anonymous } from "better-auth/plugins";
import { getDb } from "@/lib/db/client";
import * as schema from "@/lib/db/schema";
import { authSecret, env, isProduction } from "@/lib/env";
import { workspacesRepo } from "@/lib/repo/workspaces";

const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

export const auth = betterAuth({
  secret: authSecret(),
  baseURL: env.BETTER_AUTH_URL,
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    cookiePrefix: "vouch",
    useSecureCookies: isProduction,
  },
  socialProviders: googleEnabled
    ? { google: { clientId: env.GOOGLE_CLIENT_ID!, clientSecret: env.GOOGLE_CLIENT_SECRET! } }
    : {},
  plugins: [
    anonymous({
      emailDomainName: "guest.vouch.local",
      onLinkAccount: async ({ anonymousUser, newUser }) => {
        const ws = await workspacesRepo.findOrCreateForUser(anonymousUser.user.id, true);
        const result = await workspacesRepo.promoteToAccount(ws.id, newUser.user.id);
        console.log(
          `workspace ${result.mode} on account link: workspaceId=${result.workspaceId} userId=${newUser.user.id}`,
        );
      },
    }),
  ],
});

export const isGoogleSignInEnabled = googleEnabled;
