# Functioning Faith social login setup

Functioning Faith already implements Authorization Code + PKCE, state/nonce checks, signed ID-token verification, account creation, and identity linking for Gmail and iCloud. Provider buttons appear automatically on the sign-in screen only when their Railway variables are present.

Production callback base:

```text
https://faithfit-demo-production.up.railway.app/api/auth/oauth/google/callback
https://faithfit-demo-production.up.railway.app/api/auth/oauth/apple/callback
```

## Gmail

In Google Cloud Console:

1. Create or select a project and configure the OAuth consent screen.
2. Create an OAuth 2.0 Web application client.
3. Add the production callback above to Authorized redirect URIs.
4. Add these Railway variables to `functioning-faith-demo`:

```text
GOOGLE_CLIENT_ID=<web-client-id>
GOOGLE_CLIENT_SECRET=<web-client-secret>
APP_BASE_URL=https://faithfit-demo-production.up.railway.app
```

## iCloud

In Apple Developer → Certificates, Identifiers & Profiles:

1. Create a Sign in with Apple Services ID, for example `com.example.functioning-faith.web`.
2. Enable Sign in with Apple and configure the primary App ID.
3. Add the production domain `faithfit-demo-production.up.railway.app`.
4. Add the callback URL above as the Return URL.
5. Create a Sign in with Apple key with Sign in with Apple enabled. Keep the downloaded `.p8` private key secure.
6. Add these Railway variables:

```text
APPLE_CLIENT_ID=<services-id>
APPLE_TEAM_ID=<apple-team-id>
APPLE_KEY_ID=<sign-in-with-apple-key-id>
APPLE_PRIVATE_KEY=<contents-of-the-p8-file>
APP_BASE_URL=https://faithfit-demo-production.up.railway.app
```

`APPLE_PRIVATE_KEY` may contain literal `\n` sequences; Functioning Faith converts them to PEM line breaks before signing Apple's short-lived client secret.

## Verify

After setting the variables and redeploying:

```text
GET https://faithfit-demo-production.up.railway.app/api/auth/providers
```

The response should list `gmail` and/or `icloud`-labeled providers. The sign-in and sign-up screens then show the corresponding buttons. A social account with a verified email is linked to an existing password account with the same email, avoiding duplicate profiles.

Never commit provider secrets or the Apple `.p8` file to GitHub.
