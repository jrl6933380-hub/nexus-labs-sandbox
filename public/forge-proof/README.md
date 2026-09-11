# Nexus Forge Proof-of-Concept

This folder contains a self-contained demo site ("Anchor & Bloom Coffee Roasters", a fictional local coffee roastery) built to prove the Nexus Forge pipeline can generate a real, working site end-to-end.

## What this proves
- A vault blueprint (proven "Business Site Shell": hero, services, about, testimonials, contact) can be reused as the structural starting point instead of generating structure from scratch.
- The result renders as a complete, styled single page — not a placeholder stub.
- Built on an isolated branch (`forge-proof-site`), inside the sandbox repo, with zero collision with the existing sandbox app files (`public/index.html`, `connectors.html`, etc. were left untouched).

## What this is NOT
- Not a production deploy.
- Not merged to main.
- Not a real business — all copy, names, and testimonials are fictional/demo content.

## Note on generation
The original plan was to have the AI Gateway (via `delegate_to_model` → Gemini) generate the on-page copy live, to prove the full delegated-content pipeline. That call hit a reproducible truncation bug (flagged separately for Claude to fix) — cut off mid-content on structured generation prompts while short/plain replies worked fine. Copy was written directly instead so this proof run wasn't blocked; retry generation-via-gateway once that bug is fixed.
