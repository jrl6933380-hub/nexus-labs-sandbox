# NEXUS LABS — MASTER BUILDER HANDOFF

## Purpose

This document is a complete handoff of the Nexus Labs / Nex project as discussed so far. It is intended to be given to another AI builder, app builder, developer, or technical collaborator so they can understand the product, the current implementation, the architecture, the security concerns, the product direction, and the next steps without needing the full chat history.

---

# 1. THE CORE IDEA

Nexus is intended to become a phone-first developer platform that lets someone use an LLM as the main interface for real software development and infrastructure operations.

The core experience is:

```text
User on iPhone
      ↓
Preferred LLM
(ChatGPT / Claude / another model)
      ↓
Nexus connector / orchestration layer
      ↓
Authenticated tools and capabilities
      ↓
GitHub / Vercel / Docker / Stripe / Domains / Email / Figma / DBs / APIs / Cloud
      ↓
Working software
```

The goal is not simply to build another chatbot.

Nexus should give LLMs real “hands” so the user can ask for work in natural language and have the system actually:

- inspect repositories
- read files
- edit files
- create repositories
- create branches
- create pull requests
- deploy software
- create preview environments
- manage infrastructure
- connect services
- run tests/builds
- eventually provision containers and sandboxes
- coordinate multiple AI models
- request human approval for sensitive actions

A useful summary is:

> **Nexus is a portable developer control plane for LLMs.**

A useful product positioning is:

> **Bring your own AI. Bring your own accounts. Nexus gives the AI the tools.**

Another strong positioning:

> **Your entire development stack, operated through your LLM from your phone.**

---

# 2. WHY THIS EXISTS

The user is building primarily from an iPhone.

The product insight is that a developer should not need to carry a laptop to perform serious development work if an LLM can operate the development stack for them.

The user wants Nexus to feel like:

- a lightweight Replit-like experience
- much cheaper
- phone-first
- LLM-native
- connector-driven
- multi-model
- user-controlled
- security-aware

The user does NOT necessarily want to clone every part of Replit.

The strategy is to create the user experience first by composing existing infrastructure such as GitHub and Vercel, then progressively own more infrastructure over time.

---

# 3. CURRENT PROJECT AGE / STATE

At the time of the discussions, the project was roughly three days into development.

Despite being early, the system already includes:

- a working web UI
- persistent chat
- model routing
- manual model selection
- structured long-term memory
- memory compression
- GitHub operations
- approval queue
- Vercel project linking
- Sentry error reporting
- a remote MCP connector
- a connectors catalog
- a private Claude-to-Nex lane
- a basic project/system dashboard
- mobile-responsive UI

The project should not yet be represented as literally equivalent to Replit infrastructure.

However, the interaction model is already meaningfully beyond “just a chatbot.”

---

# 4. CURRENT NEXUS HUB UI

The existing Nexus Hub includes:

- NEX identity/status
- operator display
- project area
- central chat
- model picker
- token accounting
- approval queue
- memory dashboard
- connectors page
- mobile navigation chips
- responsive phone-first layout

Current visual direction:

- dark navy/black background
- subtle technical grid
- blue/cyan highlights
- amber for approvals
- green for live/connected
- red for destructive actions
- JetBrains Mono + Inter
- dark/glassy developer-tool aesthetic

This visual identity should be preserved and refined.

---

# 5. MAIN CHAT EXPERIENCE

The current main chat page:

- loads existing conversation history from `/api/chat`
- posts new messages to `/api/chat`
- displays a thinking state
- changes to “Still working on it” on longer requests
- shows which model answered
- displays token usage
- accumulates session/history token totals
- reloads the approval queue after messages
- saves the selected model in localStorage
- supports responsive phone use

Current model picker:

- Auto
- Haiku
- Sonnet
- Opus

Current frontend model labels:

```text
claude-haiku-4-5-20251001 → Haiku
claude-sonnet-5            → Sonnet
claude-opus-5              → Opus
```

---

# 6. NEX CORE BRAIN

Current core file:

```text
/lib/nexBrain.js
```

This is the single source of truth for Nex behavior.

It is shared by:

- visible chat
- private Claude-to-Nex messaging lane

Responsibilities include:

- loading Nex identity
- loading long-term memory
- choosing model tier
- calling Anthropic
- exposing tools
- handling tool-use loops
- tracking token usage
- escalating models when needed
- enforcing behavior rules

Current model tiers:

```text
cheap    → Claude Haiku
standard → Claude Sonnet
heavy    → Claude Opus
```

There is an automatic classifier that routes:

- simple/casual work → cheap
- real coding/building/planning → standard
- complex architecture/reasoning → heavy

Users can manually override the route.

If a lower model fails to produce usable text, the system escalates upward.

---

# 7. CURRENT NEX TOOLS

## Memory

### `save_memory`

Stores durable facts.

Categories:

- `fact`
- `project`
- `for_claude`

`for_claude` is used when Nex encounters a real capability wall that should be picked up by Claude later.

---

## GitHub read tools

### `list_repo_files`

Lists files in a repo/folder.

### `read_repo_file`

Reads a full current file.

Nex is instructed to read before editing when it is not certain of the current contents.

---

## Proposed file changes

### `create_repo_file`
### `update_repo_file`
### `delete_repo_file`

These do NOT execute immediately.

They create approval-queue items.

The user must approve them.

---

## Repository lifecycle

### `create_repo`
### `delete_repo`

These are also queued for approval.

Repository deletion is treated as irreversible.

Nex should never suggest deleting a repo proactively.

---

## Branches

### `create_branch`

Executes immediately.

Reason: creating a branch is considered low risk because it does not modify the live/default branch.

---

## Pull requests

### `create_pull_request`

Executes immediately.

Reason: opening a PR proposes a merge rather than performing it.

---

# 8. SAFE DEVELOPMENT WORKFLOW

A core Nexus development workflow is:

```text
Read repository
      ↓
Create safe branch
      ↓
Propose file changes
      ↓
Human approval
      ↓
Commit changes to branch
      ↓
Open pull request
      ↓
Review actual diff
      ↓
Merge when ready
```

This is a major part of the security model.

---

# 9. APPROVAL QUEUE

Existing API:

```text
/api/queue.js
```

Existing page:

```text
/queue.html
```

The approval queue is one of the most important product features.

Queued operations currently include:

- create repository file
- update repository file
- delete repository file
- create repository
- delete repository

User actions:

- Approve
- Reject

On approval, Nexus executes the operation.

If the operation fails, the item remains in the queue so it can be retried or rejected.

Future actions that should potentially require approval:

- production deployment
- destructive database operations
- repository deletion
- domain transfer
- DNS changes
- Stripe refunds
- Stripe payouts
- payment/billing changes
- credential changes
- environment variable changes
- high-cost infrastructure provisioning
- deleting production resources

---

# 10. QUEUE UI BUG DISCOVERED

The standalone queue page currently assumes queue items contain:

```js
item.input.path
```

That works for file operations.

It does not work correctly for:

- `create_repo` → uses `input.name`
- `delete_repo` → uses `input.repo`

The main dashboard already contains better fallback logic.

The standalone queue should be updated to use:

```text
path
or
name
or
repo
```

depending on the operation.

---

# 11. STRUCTURED LONG-TERM MEMORY

Current files:

```text
/api/memory.js
/lib/memory.js
/memory.html
```

Storage:

```text
Upstash Redis
hash: nex:memories
```

Memory categories:

- fact
- project
- for_claude

Operations:

- list
- add
- update
- delete

Memories are sorted chronologically.

---

# 12. MEMORY COMPRESSION

The memory system already addresses token growth.

Current behavior:

- compression threshold: 30 entries
- keep recent: 15 entries
- old memories grouped by category
- Claude Haiku summarizes older batches
- many raw memories become one summary

The compression prompt attempts to preserve:

- exact names
- concrete facts
- decisions
- numbers
- important project details

This is intended to keep long-term memory useful without allowing token cost to grow forever.

---

# 13. PRIVATE CLAUDE → NEX LANE

Existing endpoint:

```text
/api/claude-message.js
```

Purpose:

Allow Claude to message Nex directly through the real Nex brain without touching the visible dashboard history.

Properties:

- stateless
- no shared conversation history
- no visible chat pollution
- uses Nex identity
- uses Nex memory
- uses Nex tools

This is important because it is already a primitive form of AI-to-AI communication.

---

# 14. CURRENT GITHUB INTEGRATION

Current helper:

```text
/lib/github.js
```

Capabilities include:

- list files
- read files
- create/update files
- delete files
- create repositories
- delete repositories
- create branches
- create pull requests
- resolve file SHAs
- resolve branch SHAs
- resolve default branches

New repositories are automatically passed to the Vercel linker.

So Nexus already supports part of:

```text
natural-language request
→ AI tool call
→ GitHub operation
→ deployment infrastructure
```

---

# 15. IMPORTANT CURRENT GITHUB LIMITATION

Current GitHub integration uses a server-wide environment token:

```js
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
```

This means the connector is currently effectively tied to the GitHub account/repositories accessible to that token.

This is the main reason the current connector behaves like a single-user/personal connector.

For a multi-user product, GitHub auth needs to become per-user/per-workspace.

Future conceptual pattern:

```text
Authenticated Nexus user
      ↓
Workspace
      ↓
User's GitHub OAuth / GitHub App installation
      ↓
Allowed repositories
      ↓
GitHub tool calls
```

Do NOT trust `owner` and `repo` strings as authorization by themselves.

The backend should verify that the authenticated user is authorized for the requested repository.

---

# 16. CURRENT MCP CONNECTOR

Current remote MCP endpoint:

```text
https://github-write-mcp.vercel.app/api/mcp
```

The MCP server uses the official Model Context Protocol SDK.

Implementation uses:

- `McpServer`
- `StreamableHTTPServerTransport`
- Zod schemas
- stateless mode

The server is designed for serverless deployment.

Tools seen across versions include:

- create_file
- update_file
- delete_file
- list_files
- read_file / get_file
- create_repo
- create_branch
- create_pull_request
- delete_repo
- search_code
- commit_files
- Vercel token provisioning
- Nex memory tools
- `message_nex`

The broader version exposed a much richer developer-control surface than the smaller current version.

---

# 17. MCP PRODUCT VISION

The connector should become a product that other people can attach to an LLM.

The key idea:

> **The user should not need to use Nex itself if they already prefer Claude, ChatGPT, or another compatible LLM.**

Nexus can provide the capabilities while their chosen LLM provides the reasoning interface.

Example:

```text
Their LLM
    ↓
Nexus Connector
    ↓
GitHub / Vercel / Stripe / Domains / Email / Docker / etc.
```

This is “Direct Mode.”

Nexus itself can also provide its own AI/orchestrator mode.

---

# 18. TWO PRODUCT MODES

## Mode A — Nex Mode

Nexus provides:

- chat
- model routing
- memory
- orchestration
- tools
- approvals
- deployment
- project state

The user interacts mainly with Nex.

---

## Mode B — Direct Connector Mode

The user already has an LLM.

They connect Nexus as a capability layer.

Nexus provides:

- GitHub tools
- Vercel tools
- Stripe tools
- domains
- email
- Docker
- etc.

The user's preferred LLM remains their primary interface.

---

# 19. EXISTING CONNECTORS PAGE

Current page:

```text
/connectors.html
```

Live connector:

## github-write

Endpoint:

```text
https://github-write-mcp.vercel.app/api/mcp
```

Displayed tools currently include:

- create_file
- update_file
- delete_file
- list_files

Planned connectors shown in the UI:

- email
- domains
- figma
- stripe

---

# 20. BROADER CONNECTOR IDEAS

High-value future connectors include:

- GitHub
- Vercel
- Stripe
- Docker
- Supabase
- Postgres
- Cloudflare
- AWS
- Google Workspace
- Slack
- Discord
- Twilio
- Resend
- Sentry
- PostHog
- Linear
- Notion
- HubSpot
- Shopify
- WordPress
- Figma
- DNS providers
- domain registrars
- object storage
- CI/CD providers
- package registries
- logging platforms
- analytics platforms
- CRM systems
- documentation platforms
- model providers
- cloud infrastructure

The strategy is not merely to collect isolated tools.

The value comes from composing them.

Example:

```text
"Launch my SaaS"
      ↓
GitHub → repo/code
      ↓
Docker → build/test
      ↓
Supabase → database/auth
      ↓
Stripe → billing
      ↓
Vercel → deployment
      ↓
Cloudflare → DNS/domain
      ↓
Sentry → monitoring
      ↓
PostHog → analytics
```

---

# 21. VERCEL INTEGRATION

Current helper:

```text
/lib/vercel.js
```

Current purpose:

- link new GitHub repos to new Vercel projects
- enable branch preview deployments automatically

Environment configuration referenced:

- `VERCEL_TOKEN`
- `NEXS_TOKEN`
- optional `VERCEL_TEAM_ID`

Current function:

```text
linkRepoToVercel({ name, owner, repo })
```

Behavior:

- if no token is configured, it safely skips Vercel linking
- GitHub repo creation is never rolled back because Vercel failed
- creates a Vercel project
- links GitHub repository

This is a good resilience pattern.

---

# 22. VERCEL TOKEN / CREDENTIAL AUTOMATION

A more advanced Vercel helper version discussed also included:

- creating new Vercel access tokens
- immediately storing the token as a sensitive Vercel environment variable
- never returning the raw token to the LLM/user
- only returning success metadata

The user’s scaling idea:

If one infrastructure credential or resource becomes saturated, Nexus could provision another in the background so customers continue coding without dealing with the underlying mechanics.

This is useful as infrastructure abstraction.

However:

- token creation itself is not a substitute for tenant isolation
- broad global credentials are dangerous
- provisioning should be controlled by the Nexus backend/control plane
- customers should not gain indirect access to Nexus master credentials

---

# 23. CURRENT “SANDBOX” MODEL

The current system uses Vercel heavily for preview/deployment behavior.

From the user's perspective, Vercel branches/previews function as an early sandbox mechanism.

This allows the LLM to:

- create a branch
- modify the branch
- deploy preview
- inspect result
- iterate
- open PR

This can deliver a surprising amount of Replit-like developer experience without owning a full runtime platform.

---

# 24. WHERE VERCEL STOPS BEING ENOUGH

Vercel is excellent for:

- web apps
- previews
- serverless deployments
- frontend/backend web projects
- branch deploys

A true developer sandbox needs additional capabilities:

- arbitrary shell commands
- arbitrary package installation
- multi-language runtime
- running tests
- long-running build tasks
- persistent workspace state
- background workers
- multiple local services
- deeper filesystem control
- controlled network access

This is where Docker or stronger sandboxing enters.

---

# 25. DOCKER SANDBOX DIRECTION

Docker is a natural extension of the existing Nexus stack.

Possible future architecture:

```text
LLM
 ↓
Nexus
 ↓
Sandbox Manager
 ↓
Isolated project container
 ├── repository
 ├── filesystem
 ├── Node/Python/etc.
 ├── package manager
 ├── build tools
 ├── tests
 └── logs
 ↓
GitHub
 ↓
Vercel deployment
```

In this model:

- Docker = development computer
- GitHub = source of truth
- Vercel = deployment
- Nexus = control/orchestration/security plane
- LLM = developer interface

---

# 26. IMPORTANT DOCKER SECURITY NOTE

Docker alone should not be treated as the entire security model for hostile arbitrary code.

Public multi-user execution needs stronger controls around containers:

- non-root containers
- no privileged mode
- no host Docker socket
- no broad host mounts
- CPU quotas
- RAM quotas
- disk quotas
- process limits
- execution time limits
- restricted networking
- secret isolation
- sandbox destruction/recycling
- audit logs
- potentially stronger isolation technology as scale grows

---

# 27. OWNING MORE OF THE STACK

The user asked how Nexus can gradually own more infrastructure like Replit.

Recommended evolution:

## Phase 1 — current

- GitHub
- Vercel
- Upstash
- serverless APIs
- LLM APIs
- remote MCP

## Phase 2 — own execution layer

Add:

- isolated container runner
- project workspaces
- test/build execution
- logs
- sandbox lifecycle
- scheduling

## Phase 3 — own persistence/control

Add:

- persistent volumes
- object storage
- secrets system
- internal task queue
- usage metering
- internal network policy
- databases/cache as needed

## Phase 4 — own deployment/runtime

Add:

- Nexus build pipeline
- Nexus runtime
- public endpoints
- TLS
- domains
- deployment orchestration

Vercel can remain an optional target.

## Phase 5 — platform scale

- multiple compute nodes
- scheduler
- multi-region
- fast sandbox startup
- image/build caching
- proprietary runtime infrastructure
- stronger tenant isolation

The underlying compute can still be rented from commodity cloud/bare-metal providers.

Nexus can own the control plane before owning physical infrastructure.

---

# 28. LOW-COST SCALING STRATEGY

The user believes the current free/low-cost stack can scale a long way.

That is reasonable for validation if architecture remains disciplined.

Potential early strategy:

- serverless control APIs
- Vercel for deployments/previews
- GitHub for source
- Upstash for state
- external model APIs
- only provision containers when needed
- destroy idle sandboxes
- cache dependencies/build layers
- introduce paid compute only for workloads that require it

The product should validate demand before taking on Replit-sized infrastructure costs.

---

# 29. APP STORE / NATIVE APP VISION

Nexus as a whole is the stronger App Store product.

The connector becomes the engine underneath.

Potential app sections:

- Home / Nex
- Projects
- Connectors
- Models
- Approval Queue
- Memory
- Deployments
- Sandboxes
- Activity / Audit Log
- Usage / Costs
- Security
- Settings

The mobile app should make connection/setup easier than copying raw MCP URLs.

---

# 30. MOBILE PRODUCT PHILOSOPHY

Do not merely shrink a desktop IDE onto a phone.

The phone UX should be designed around:

- natural-language commands
- approval buttons
- diff review
- project cards
- deployment links
- connector status
- model picker
- voice input later
- notifications
- activity timeline
- concise logs
- quick rollback
- quick branch/PR review

The user should be able to accomplish serious work without needing to type shell commands.

---

# 31. OAUTH / USER ACCOUNT VISION

The public product needs its own account system.

Conceptual flow:

```text
User opens Nexus
      ↓
Create Nexus account / sign in
      ↓
Connect provider
      ↓
Provider authorization screen
      ↓
User approves requested permissions
      ↓
Provider callback to Nexus
      ↓
Nexus stores encrypted credentials
      ↓
Connector enabled
```

The user's Nexus account becomes the identity that owns and organizes all service connections.

The Nexus username/password does NOT itself magically generate third-party OAuth rights.

Third-party providers still issue their own authorization after the user approves.

---

# 32. DESIRED “WE DO THE REST” ONBOARDING

The user wants setup to feel extremely easy.

Example:

```text
Connect GitHub
      ↓
Sign in
      ↓
Review permissions
      ↓
Allow
      ↓
Back to Nexus
      ↓
Configuring...
      ↓
Testing...
      ↓
Ready / Shipped
```

Same concept for:

- Stripe
- Vercel
- domains
- email
- model providers
- other SaaS accounts

The frontend should SHOW the process rather than forcing users to understand environment variables or raw token management.

---

# 33. STRIPE EXAMPLE

A desired Stripe connection experience:

1. User taps Connect Stripe.
2. Stripe login/authorization opens.
3. User signs in.
4. User sees requested permissions.
5. User approves.
6. Stripe redirects back to Nexus.
7. Nexus verifies the connection.
8. Nexus displays account/scopes.
9. Stripe tools become available.

Possible Stripe tools:

- read customers
- read products
- create products
- create prices
- create checkout links
- inspect subscriptions
- inspect invoices

Sensitive tools should have stricter policies:

- refunds
- payouts
- subscription cancellation
- billing changes
- payment-method operations

---

# 34. MULTI-LLM VISION

This became one of the strongest ideas in the discussion.

Nexus should not merely connect one AI to tools.

It can orchestrate multiple AI models against the same project.

Example:

```text
User
 ↓
Nexus Orchestrator
 ├── GPT → architecture / implementation
 ├── Claude → large code change / review
 ├── Gemini → research / multimodal / huge context
 ├── cheap model → classification / routine jobs
 └── specialized model → tests/security/docs
 ↓
Shared Nexus project state
 ↓
GitHub / sandbox / logs / memory / approvals / deployments
```

The user should be able to say:

> “Have ChatGPT do this part and Claude do this part.”

without manually copying context between apps.

---

# 35. THE MODELS SHOULD SHARE STATE, NOT JUST CHAT

The most important architectural principle for multi-model work:

Nexus should be the source of truth.

Shared state can include:

- repository
- workspace
- task graph
- project memory
- test results
- deployment logs
- current branch
- outstanding approvals
- decisions
- failures
- model outputs

Models receive the context necessary for their assigned task.

This prevents the system from becoming multiple disconnected chatbots.

---

# 36. POSSIBLE MULTI-MODEL ROLES

Nexus could eventually assign roles:

- Planner
- Architect
- Backend developer
- Frontend developer
- Reviewer
- Security reviewer
- Test engineer
- Debugger
- Documentation writer
- Deployment agent
- Researcher

Possible workflow:

```text
Planner breaks task down
      ↓
Coder implements
      ↓
Reviewer checks
      ↓
Tester runs tests
      ↓
Coder fixes failures
      ↓
Security model reviews
      ↓
Nexus requests production approval
      ↓
Deploy
```

This creates an “AI development team” experience.

---

# 37. EXISTING FOUNDATION FOR MULTI-LLM

The current Nexus system already contains early pieces:

- automatic model routing
- manual model picker
- persistent project memory
- shared GitHub tools
- private AI-to-Nex lane
- approval queue
- common Nex brain

So broader multi-provider orchestration is an extension of the existing design.

---

# 38. BYO API / POWER USER MODE

The user wants developers to be able to provide their own model APIs.

Two user paths:

## Subscription mode

The user connects Nexus to the LLM interface they already use.

Example:

- ChatGPT
- Claude
- another connector-capable client

## API mode

The user provides supported provider API credentials.

Nexus can then:

- call models directly
- route between providers
- control spending
- run longer workflows
- assign specialized roles
- avoid being tied to a single subscription interface

This should be presented as a power-user option, not as a way to bypass provider restrictions.

---

# 39. MODEL ROUTER UI DIRECTION

Current picker:

- Auto
- Haiku
- Sonnet
- Opus

Future version could become:

```text
Brain / Provider
- Auto
- GPT
- Claude
- Gemini
- Custom
```

And/or:

```text
Task routing
Coding      → Claude
Architecture→ GPT
Research    → Gemini
Simple jobs → Cheap model
Auto        → Nex decides
```

---

# 40. NEXUS AS CONTROL PLANE

A useful long-term architecture:

```text
               NEXUS CONTROL PLANE
                        │
          ┌─────────────┼─────────────┐
          │             │             │
       Identity       Policy       Orchestration
          │             │             │
          ├─────────────┼─────────────┤
          │             │             │
       Secrets        Queue        Audit Log
          │             │             │
          └─────────────┼─────────────┘
                        │
                 Connector Layer
                        │
      ┌─────────┬───────┼─────────┬─────────┐
    GitHub    Vercel   Stripe    Docker   Domains
```

The LLM should never be the final security authority.

Nexus should enforce policy server-side.

---

# 41. CRITICAL SECURITY CONCERN

The user explicitly does NOT want independent hackers abusing Nexus.

A prospective buyer offered around $300 for the connector after OAuth was added.

The user declined because the buyer said they wanted to use it to automate multiple accounts / “bonus hacks” on crypto casinos.

This is a major threat-model lesson.

Nexus must assume that determined users will try to abuse any capability that can be automated.

---

# 42. MALICIOUS USE THREAT MODEL

A terminal-like AI tool could be abused for:

- malware
- phishing
- credential theft
- internet scanning
- attack automation
- account farming
- promo abuse
- spam
- fraud
- crypto mining
- botnets
- brute-force workflows
- denial-of-service
- malicious deployments
- unauthorized security exploitation
- secret exfiltration

Therefore Nexus must not rely only on system prompts saying “do not do bad things.”

Security must be enforced by infrastructure.

---

# 43. SAFETY ARCHITECTURE

Recommended controls:

## Identity

Every user must have a distinct account/tenant.

## Per-user credentials

Never give all users the same broad GitHub/Vercel/Stripe credential.

## Least privilege

Only request scopes necessary for the connector.

## Resource authorization

A user can only access resources they are authorized for.

## Approval gates

Sensitive/destructive actions require confirmation.

## Sandboxing

Arbitrary code executes outside the Nexus control plane.

## Rate limits

Limit requests, deployments, emails, resource creation, etc.

## Usage quotas

Control compute/storage/network/API cost.

## Network restrictions

Sandbox workloads should not automatically get unrestricted outbound network access.

## Audit logs

Record significant actions.

## Abuse detection

Detect suspicious repetitive behavior and risky usage patterns.

## Kill switch

Nexus must be able to disable users/connectors quickly.

## Secret isolation

Never expose master secrets to:
- LLM prompts
- browser frontend
- tool output
- public source
- logs

---

# 44. PERMISSION LEVEL CONCEPT

Possible policy tiers:

## Level 1 — Read

- list files
- read files
- inspect logs
- inspect analytics

Can often run automatically.

## Level 2 — Safe development

- create branch
- open PR
- create preview
- run tests

Can often run automatically.

## Level 3 — Write

- modify files
- deploy
- update integration settings

May require approval depending on user policy.

## Level 4 — Sensitive/destructive

- delete repo
- production credential changes
- refunds
- destructive DB actions
- domain transfers
- major infrastructure deletion

Should require explicit approval.

---

# 45. PERMISSION UI CONCEPT

Possible UI:

```text
GitHub
✓ Read repositories
✓ Read files
✓ Create branches
✓ Create PRs
✓ Propose file changes
○ Direct file writes
○ Delete files
○ Delete repositories

Vercel
✓ Create previews
✓ Read deployments
○ Production deploy
○ Environment variables
○ Delete projects

Stripe
✓ Read products
✓ Read subscriptions
○ Create products
○ Refund payments
○ Modify payouts
```

These toggles should correspond to real server-side policy.

---

# 46. USER OWNERSHIP / MULTI-TENANCY

Current memory and credentials are effectively global/personal.

Public Nexus needs tenant boundaries.

Possible data structure:

```text
User
 ├── Workspaces
 │    ├── GitHub connection
 │    ├── Vercel connection
 │    ├── Stripe connection
 │    ├── memory
 │    ├── queue
 │    ├── projects
 │    └── model config
 └── account/security
```

Memory should evolve from:

```text
nex:memories
```

to something like:

```text
nex:memory:{userId}:{workspaceId}
```

Queue items should include:

- userId
- workspaceId
- tool
- input
- description
- requestedAt
- status

Approval must verify that the approver owns the queue item.

---

# 47. CURRENT MEMORY ENDPOINT SECURITY CONCERN

The current `/api/memory` implementation shown did not visibly include authentication.

Similarly, `/api/queue` and `/api/claude-message` did not visibly include authentication in the supplied snippets.

Before public launch, these must be protected.

A public visitor should not be able to:

- read Nex memory
- modify Nex memory
- approve/reject queue items
- execute GitHub actions
- message Nex privately
- invoke MCP tools

unless authorized.

---

# 48. CURRENT MCP SECURITY CONCERN

The current MCP route checks whether a GitHub environment token exists.

That authenticates Nexus TO GitHub.

It does not authenticate the incoming MCP client TO Nexus.

The public product needs:

```text
LLM client
   ↓
authenticate
   ↓
Nexus MCP
   ↓
authorize requested tool
   ↓
authorize requested resource
   ↓
execute
```

This is essential before exposing powerful tools widely.

---

# 49. CREDENTIAL BROKER PRINCIPLE

The LLM should receive capabilities, not secrets.

Bad:

```text
LLM receives VERCEL_TOKEN
```

Better:

```text
LLM calls create_preview()
      ↓
Nexus authorizes
      ↓
Nexus uses protected credential
      ↓
returns result
```

This applies to:

- GitHub
- Vercel
- Stripe
- domains
- cloud
- email
- databases

---

# 50. CUSTOMER INFRASTRUCTURE VS NEXUS INFRASTRUCTURE

The product can be hybrid.

## Nexus-owned control plane

- user accounts
- OAuth callbacks
- connector registry
- policy
- approvals
- audit logs
- orchestration
- usage
- billing
- sandbox scheduling

## User-owned accounts

- GitHub
- Stripe
- domains
- model APIs
- Vercel account if BYO
- cloud resources

## Execution

Can be:
- Nexus-managed sandboxes
- user-provided infrastructure
- third-party compute

This keeps Nexus powerful without requiring it to own every external resource.

---

# 51. “BRING YOUR OWN AI” PRODUCT POSITIONING

Strong concept:

> **Bring your own AI. Nexus gives it the tools.**

The user should be able to switch between models without rebuilding their developer environment.

Today:
- Claude

Tomorrow:
- ChatGPT
- Gemini
- other MCP clients
- direct APIs
- potentially local models

The connector layer remains stable.

---

# 52. COMPETITIVE POSITIONING

The user has searched for similar connectors and has not found one that combines the full workflow exactly as envisioned.

There are existing categories such as:

- MCP servers
- GitHub connectors
- Zapier-style agent tools
- Composio-style integrations
- cloud IDEs
- AI coding agents

Nexus should not claim there are zero competitors.

The differentiation is the combination:

- phone-first
- developer-focused
- broad connector toolbox
- deployment
- project orchestration
- approval queue
- multi-model coordination
- user-owned accounts
- low-cost architecture
- eventual sandbox/compute layer

---

# 53. WHY NEXUS COULD BE WORTH MONEY

A product can be valuable even if individual integrations already exist.

Users pay for:

- packaging
- ease of onboarding
- reliability
- cross-service workflows
- security
- mobile UX
- reduced setup burden
- orchestration
- one consistent permission model

The $300 offer was an early willingness-to-pay signal, even though the requested use case was rejected.

Potential monetization:

- one-time connector license
- Nexus subscription
- connector bundles
- pro developer tier
- usage-based sandbox compute
- usage-based orchestration
- enterprise/self-hosted tier
- marketplace revenue share

---

# 54. DO NOT COMPETE WITH REPLIT ONLY ON “IDE”

A stronger framing:

Replit:

> “Here is your cloud computer / IDE.”

Nexus:

> “Give your LLM controlled access to your developer stack.”

That is related, but distinct.

Nexus can deliver much of the practical outcome without recreating every desktop IDE feature.

---

# 55. REPLIT COMPARISON

Nexus is still behind Replit in underlying infrastructure maturity.

Replit owns mature systems for:

- compute
- execution sandboxes
- filesystem
- terminals
- package installation
- background processes
- networking
- hosting
- collaboration
- persistence
- build system
- runtime isolation
- secrets
- infrastructure reliability

Nexus already has or is building:

- AI interaction
- model routing
- GitHub read/write
- branches
- PRs
- Vercel deployment
- memory
- approvals
- connectors
- mobile UI
- multi-AI direction

The largest technical gap is generalized isolated compute.

---

# 56. SENTRY

Current shared helper:

```text
/lib/sentry.js
```

Purpose:

- initialize Sentry once
- capture exceptions
- flush in serverless handlers

Current `tracesSampleRate` is 0.

So the system currently focuses on errors rather than performance tracing.

Sensitive/configurable values should move to environment configuration where appropriate.

---

# 57. UI SOURCE PROVIDED

Current supplied UI includes:

- Connectors page
- Nexus Hub main chat page
- Memory page
- Approval Queue page

Important frontend behaviors:

- responsive mobile layout
- localStorage for model preference
- queue polling
- history loading
- token accounting
- connector links
- approval buttons
- memory management

These files should be treated as the current visual/functional reference.

---

# 58. CONNECTOR INSTALL / AUTH UX

A polished future connector install flow could be:

```text
Get Nexus Connector
      ↓
Create Nexus account
      ↓
Choose LLM
      ↓
Connect LLM / MCP
      ↓
Permission screen
      ↓
Authorized
      ↓
Connect GitHub
      ↓
Select repositories
      ↓
Connect Vercel
      ↓
Optional Stripe/domains/etc.
      ↓
Ready
```

The user wants the process to feel front-end driven rather than developer-config driven.

---

# 59. CONNECTOR STATUS UI

Each integration can show:

- provider
- connected / disconnected
- connected account
- scopes
- allowed repositories/resources
- tools available
- last successful call
- health
- reconnect
- disconnect

Example:

```text
GitHub
CONNECTED

Account:
jrl6933380-hub

Permissions:
✓ Read selected repos
✓ Create branches
✓ Open PRs
✓ Propose writes
○ Delete repos

Last used:
2 minutes ago
```

---

# 60. PROJECT WORKSPACE MODEL

A strong future abstraction:

```text
Nexus account
 ├── Workspace: Nexus Labs
 │    ├── GitHub
 │    ├── Vercel
 │    ├── sandbox
 │    ├── memory
 │    ├── queue
 │    ├── model routing
 │    └── deployments
 │
 ├── Workspace: Client A
 │    ├── GitHub
 │    ├── Stripe
 │    ├── domain
 │    └── memory
 │
 └── Workspace: Experiment
      ├── GitHub
      └── sandbox
```

This is cleaner than treating `owner/repo` as the entire project identity.

---

# 61. APPROVAL QUEUE SHOULD EVENTUALLY SHOW DIFFS

Current queue primarily shows descriptions.

A major improvement:

```text
PROPOSED CHANGE

api/auth.js
+14 -6

middleware/session.js
+8 -2

[View Diff]

[Reject] [Approve]
```

This turns approval from:

> “Trust the AI’s description.”

into:

> “Review exactly what will change.”

This should be prioritized.

---

# 62. AUTOMATED DEBUG LOOP

A powerful connector combination:

```text
Sentry
 ↓
detect production error
 ↓
GitHub
 ↓
find relevant code
 ↓
LLM analyzes
 ↓
create branch
 ↓
propose fix
 ↓
approval
 ↓
run tests
 ↓
Vercel preview
 ↓
confirm error resolved
 ↓
PR / deploy
```

This is an example of why the connector ecosystem becomes more powerful when tools are composed.

---

# 63. ANALYTICS → BUILD LOOP

Another future workflow:

```text
PostHog / analytics
 ↓
identify funnel problem
 ↓
LLM reasons about behavior
 ↓
GitHub
 ↓
change UI/logic
 ↓
A/B test / deploy
 ↓
analytics validates result
```

Nexus can eventually close operational loops, not just code loops.

---

# 64. IDEAL FUTURE USER STORY

A developer is away from their desk.

They open Nexus on an iPhone and say:

> “Checkout is failing in production. Figure out why, fix it on a branch, run the tests, deploy a preview, and show me the diff.”

Nexus:

1. Reads Sentry/logs.
2. Inspects repository.
3. Chooses appropriate model.
4. Creates safe branch.
5. Modifies code.
6. Runs tests in sandbox.
7. Deploys preview.
8. Returns preview URL.
9. Shows diff.
10. Requests approval if production deployment is needed.
11. Opens PR.
12. Developer approves from phone.

That is the product experience to optimize toward.

---

# 65. IDEAL MULTI-AI USER STORY

User says:

> “Have GPT design the architecture, Claude implement the backend, another model review the security, and then deploy it.”

Nexus:

1. Creates task graph.
2. Shares project context.
3. Routes architecture task to GPT.
4. Saves architecture decision.
5. Routes backend work to Claude.
6. Runs tests.
7. Sends diff to reviewer model.
8. Sends discovered issues back to implementation model.
9. Re-runs tests.
10. Requests human approval.
11. Deploys.

User does not manually transfer context between models.

---

# 66. APP PRODUCT CONCEPT

Possible high-level structure:

```text
NEXUS
│
├── Nex
│   └── AI chat/orchestrator
│
├── Projects
│   └── workspaces/repos/deployments
│
├── Connectors
│   ├── GitHub
│   ├── Vercel
│   ├── Stripe
│   ├── Domains
│   ├── Email
│   └── ...
│
├── Models
│   ├── ChatGPT
│   ├── Claude
│   ├── Gemini
│   └── APIs
│
├── Queue
│   └── approvals
│
├── Memory
│
├── Sandboxes
│
└── Activity
    └── audit log
```

---

# 67. NEAR-TERM BUILD PRIORITIES

Recommended priority order:

## 1. Security / auth
- Protect MCP
- Protect queue
- Protect memory
- Protect private Nex messaging
- Add user accounts
- Add proper session auth

## 2. Multi-user GitHub
- GitHub OAuth or GitHub App
- per-user connection
- selected repo authorization
- resource-level policy

## 3. Tenant isolation
- user/workspace IDs
- per-user memory
- per-user queue
- per-user connector records
- per-user secrets

## 4. Approval system upgrade
- diff viewer
- risk labels
- action metadata
- audit trail

## 5. Vercel connection model
- per-user/per-workspace Vercel auth
- safer provisioning
- deployment visibility

## 6. Connector onboarding
- “Connect account”
- provider authorization
- progress UI
- connection health

## 7. Model provider abstraction
- stop coupling orchestration to only Anthropic
- common model interface
- OpenAI/Anthropic/Gemini adapters
- router

## 8. Multi-LLM task orchestration
- task graph
- model roles
- shared state
- review loops

## 9. Sandbox prototype
- Docker/container execution
- run_command
- install dependencies
- tests
- logs
- resource limits

## 10. More connectors
- Stripe
- Sentry
- domains
- email
- Figma
- Supabase/Postgres
- analytics

## 11. Native/mobile packaging
- polish current web app
- PWA or native iOS wrapper
- eventually App Store app

---

# 68. SECURITY RULE FOR ALL BUILDERS

Treat every LLM request, tool call, and user-submitted code path as potentially untrusted.

Never rely on the model saying:

> “I am authorized.”

Authorization must be determined by backend policy.

Never let the model receive broad raw secrets when a server-side capability call can perform the task instead.

Never let one customer's project/credentials be accessible to another customer.

Never allow arbitrary public code execution on the Nexus control plane.

---

# 69. PRODUCT TAGLINE IDEAS

Possible directions:

- **Bring your own AI. Nexus gives it the tools.**
- **Your LLM. Your tools. Your developer environment.**
- **Turn your LLM into a real developer.**
- **The developer tool layer for AI.**
- **Build from your phone. Let the AI operate the stack.**
- **Your development stack, operated through conversation.**
- **A developer workstation for the AI already in your pocket.**
- **Nexus gives AI hands. You keep control.**

---

# 70. THE BIGGER IDEA

The project started looking like:

> “A GitHub connector for Claude.”

It evolved into:

> “A portable developer workstation for any LLM.”

Then into:

> “A shared control plane where multiple LLMs can collaborate on the same project.”

The strongest long-term interpretation is:

> **Nex is one agent. Nexus is the infrastructure that gives any agent hands.**

The models may change.

The provider may change.

The infrastructure underneath may change.

The stable layer is Nexus:

- identity
- tools
- permissions
- project state
- memory
- approvals
- orchestration
- sandboxes
- connectors
- auditability

That is the product worth building.

---

# 71. CURRENT KNOWN LIVE ENDPOINT

Current GitHub MCP endpoint discussed:

```text
https://github-write-mcp.vercel.app/api/mcp
```

The public landing root discussed:

```text
https://github-write-mcp.vercel.app/
```

GitHub repositories referenced during discussion included:

```text
https://github.com/jrl6933380-hub/github-write-mcp/tree/main/api
https://github.com/jrl6933380-hub/nexus-labs/tree/main
```

Treat these as project references, not proof of authenticated access.

---

# 72. CURRENT FILES / CODE DISCUSSED

Files/snippets discussed include:

```text
/api/mcp.js
/lib/github.js
/lib/vercel.js
/lib/nex.js
/pages/api/claude-message.js
/api/memory.js
/api/queue.js
/lib/memory.js
/lib/nexBrain.js
/lib/sentry.js
/connectors.html
main Nexus Hub HTML
/memory.html
/queue.html
```

A builder should preserve the current working behavior while progressively refactoring toward secure multi-user architecture.

---

# 73. IMPORTANT IMPLEMENTATION OBSERVATIONS

### Existing strengths
- real tool calls
- branch/PR workflow
- approval system
- persistent memory
- model routing
- deployment integration
- modular helpers
- phone-first UX
- MCP architecture
- private AI-to-AI lane

### Current weaknesses
- global GitHub token
- global/shared memory
- likely unauthenticated internal endpoints in shown snippets
- public MCP authorization boundary incomplete
- Anthropic-specific model layer
- Vercel credentials currently global
- no generalized sandbox runtime
- no per-user tenant data model yet
- no audit-log system shown
- no abuse/rate policy shown
- queue diff review not yet implemented

These are normal prototype limitations and should be treated as the next engineering phase.

---

# 74. FINAL BUILDER SUMMARY

Nexus Labs is an early-stage, phone-first AI developer control plane.

The product should allow a user to connect an LLM and give that LLM controlled access to real developer infrastructure.

Today, the working foundation includes:

- Nex chat
- model routing
- manual model selection
- long-term memory
- memory compression
- GitHub tools
- approval queue
- branches
- PRs
- Vercel linking
- Sentry
- remote MCP
- connector catalog
- responsive mobile UI

The intended evolution is:

```text
Single-user Nex prototype
      ↓
Secure multi-user Nexus
      ↓
OAuth + per-user connectors
      ↓
Multi-LLM orchestration
      ↓
Docker / isolated developer sandboxes
      ↓
More service connectors
      ↓
Native mobile app
      ↓
Broader AI developer infrastructure platform
```

The central product thesis is:

> **Developers should be able to operate their entire software stack from an iPhone by talking to the LLM they already use. Nexus provides the tools, permissions, project context, execution, approvals, and infrastructure that make that possible.**

The biggest next challenge is not proving that AI can call tools — the prototype already demonstrates that.

The biggest next challenge is turning that power into a secure, multi-user, reliable product:

- OAuth
- tenant isolation
- credential isolation
- policy
- sandboxes
- approvals
- audit logging
- abuse prevention
- usage controls
- multi-provider model abstraction

Build the control plane carefully.

Keep the phone-first simplicity.

Keep the approval queue.

Keep the connector model open.

Let the models change.

Let the infrastructure underneath evolve.

Make Nexus the stable layer between the developer, the AI, and the entire software stack.
