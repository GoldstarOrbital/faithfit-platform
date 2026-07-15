# YouVersion Adapter Interface (documented contract)

This adapter is written against an UNVERIFIED assumed API contract. Before enabling
`youversion.read` / `youversion.write` in production, confirm real endpoint paths, auth
flow (OAuth2 vs API key), scopes, and rate limits against YouVersion's official developer
documentation / partner agreement. Nothing here should be treated as a confirmed contract.

## Interface

```ts
interface YouVersionAdapter {
  // Read-only. Requires 'youversion.read' flag.
  getVerse(youversionId: string, translation?: string): Promise<VerseDTO>;
  searchVerses(query: string, opts?: { translation?: string, limit?: number }): Promise<VerseDTO[]>;
  getUserPlan(youversionUserId: string): Promise<ReadingPlanDTO>; // requires user OAuth token

  // Write/participation actions. Requires 'youversion.write' flag AND verified scope grant.
  // DO NOT call until contract + scopes are verified with YouVersion.
  markVerseEngaged?(youversionUserId: string, youversionId: string): Promise<void>;
}
```

## Rules
- Cache verse text + metadata locally keyed by `youversion_id` (see scripture_verses table).
  Respect translation licensing — do not persist translations outside licensed set, and always
  attribute translation/copyright per YouVersion's terms.
- All requests go through rate-limit + retry wrapper (`rateLimitedRequest` in client.js).
- All calls behind `youversion.read` / `youversion.write` feature flags, default OFF.
