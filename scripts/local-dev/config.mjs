// Shared settings for the local stack (dev-idp, env setup, seed).
// Everything here is local-only: loopback hosts and .test email addresses.

export const DEV_IDP = {
  host: "127.0.0.1",
  port: 8799,
  issuer: "http://127.0.0.1:8799",
  clientId: "polynet-local-dev",
  mcpAudience: "polynet-local-mcp",
  accessTokenTtlSeconds: 60 * 60,
};

export const DEV_USERS = {
  owner: {
    label: "Rashid (owner)",
    sub: "dev|rashid-owner",
    email: "rashid.owner@polynet-local.test",
    name: "Rashid",
    givenName: "Rashid",
    familyName: "Owner",
  },
  member: {
    label: "Test Member",
    sub: "dev|test-member",
    email: "test.member@polynet-local.test",
    name: "Test Member",
    givenName: "Test",
    familyName: "Member",
  },
};

export const LOCAL_CONVEX = {
  cloudUrl: "http://127.0.0.1:3210",
  siteUrl: "http://127.0.0.1:3211",
};

export const WEB_ORIGIN = "http://localhost:5174";

// Zero-click links served by site-server: /open/<slug> → sign in → Knowledge.
// Add ?as=member to open as the test member instead of the owner.
export const SITE_PORT = Number(process.env.POLYNET_SITE_PORT || 8797);

export const OPEN_COMMUNITIES = {
  "ai-employee-builders": { label: "AI Employee Builders", returnTo: "/c/ai-employee-builders/resources" },
  "the-2-hour-club": { label: "The 2 Hour Club", returnTo: "/c/the-2-hour-club/resources" },
};

export const openCommunityUrl = (slug) => `http://localhost:${SITE_PORT}/open/${slug}`;
