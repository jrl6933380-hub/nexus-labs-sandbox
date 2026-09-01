# Nexus Labs Sandbox

Permanent isolated test environment for experimental Nexus features.

## Rules

- Build and validate new features here before proposing them to `nexus-labs`.
- Never use production Redis keys, production memory namespaces, or production-only credentials.
- Use test-specific environment variables and resources.
- Run E2B tests and inspect Vercel build/runtime logs before promotion.
- Promote successful work to production through a separate branch and pull request.

Production repository: `jrl6933380-hub/nexus-labs`
Sandbox repository: `jrl6933380-hub/nexus-labs-sandbox`
