# Gloo API Adapter Interface (documented contract)

Assumed contract — verify real endpoints/scopes against Gloo's official partner docs before
enabling `gloo.read` / `gloo.write`. Gloo is also used as an API Gateway per the architecture;
this adapter is specifically for calling Gloo's data APIs (church/group directory, AI endpoints),
separate from the gateway routing layer (see infra/ for gateway config).

## Interface
```ts
interface GlooAdapter {
  getChurch(glooChurchId: string): Promise<ChurchDTO>;         // read
  getGroup(glooGroupId: string): Promise<GroupDTO>;            // read
  syncGroupMembers(glooGroupId: string): Promise<Member[]>;    // read
  // Write actions gated behind gloo.write + verified scope grant:
  createGroupPost?(glooGroupId: string, payload: object): Promise<void>;
}
```

## Rules
- Key loaded from vault, never hardcoded.
- All calls behind feature flags, default OFF.
- Same retry/backoff + rate-limit handling as YouVersion adapter.
