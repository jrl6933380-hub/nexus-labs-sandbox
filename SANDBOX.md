# Nexus Labs Sandbox

Permanent isolated test environment for experimental Nexus features.

## Rules

- Build and validate new features here before proposing them to `nexus-labs`.
- Never use production Redis keys, production memory namespaces, or production-only credentials.
- Use test-specific environment variables and resources.
- Run E2B tests and inspect Vercel build/runtime logs before promotion.
- Promote successful work to production through a separate branch and pull request.

## Redis / board backing

This project is connected to the `upstash-kv-sky-lever` store, which supplies
`KV_REST_API_URL` and `KV_REST_API_TOKEN` (Production and Preview). Note that
connecting the store does NOT update deployments that were built before it —
`/api/board` will keep returning `Missing KV_REST_API_URL or KV_REST_API_TOKEN`
until a fresh production deployment is created.

Production repository: `jrl6933380-hub/nexus-labs`
Sandbox repository: `jrl6933380-hub/nexus-labs-sandbox`
