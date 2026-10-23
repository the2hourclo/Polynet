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
