import type { GoogleConfiguration, GoogleOAuthEvidence } from "../../lib/google/oauth-configuration.ts";
import { fixtureGoogleProject } from "./google-project.ts";

export function fixtureGoogleOAuth(now: number): GoogleOAuthEvidence {
  const origin: string = "https://alter.example.test";
  return { ownerId: "owner", projectId: "alter-fixture", clientId: "123456789-fixture.apps.googleusercontent.com", clientType: "web", environment: "production", origin, callbackUrl: `${origin}/api/google/oauth/callback`, registeredOrigins: [origin], registeredCallbacks: [`${origin}/api/google/oauth/callback`], audience: "external", publishing: "testing", approvedTestEmails: ["google@example.test"], verification: "not-required", consoleSource: "https://console.cloud.google.com/auth/clients?project=alter-fixture", checkedAt: now, validUntil: now + 60_000 };
}
export function fixtureGoogleConfiguration(now: number): GoogleConfiguration { return { project: fixtureGoogleProject(now), oauth: fixtureGoogleOAuth(now) }; }
