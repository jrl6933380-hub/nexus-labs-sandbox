# NEXUS LABS — CLAUDE ↔ CODEX BRIDGE

This is the shared continuity file for Claude, Codex, and Nex.

## RULES

1. Read this entire file before changing it.
2. Rewrite the whole file after reading; never write blind.
3. Keep these sections in this exact order: STATUS, NEXT, BLOCKERS, DECISIONS, LOG.
4. STATUS and NEXT describe the present and must be rewritten each handoff.
5. DECISIONS is append-only except when correcting an explicit factual error.
6. LOG is newest first. Stamp entries as:
   `[YYYY-MM-DD] [CLAUDE|CODEX|NEX] — what changed; what remains.`
7. Update once at the end of a meaningful work session or before usage runs out.
8. Use commit message: `bridge: <agent> <YYYY-MM-DD>`.
9. Keep this file under roughly 150 lines. Condense old LOG entries into DECISIONS.
10. Do not store secrets, tokens, passwords, or private keys here.

## STATUS

- The GitHub, Vercel, and custom Nexus connectors are authenticated and usable by Codex.
- The custom connector can read/write repository files, manage shared memory, message Nex, and provision the configured Vercel token.
- Nex confirmed dependent multi-tool calls and automatic memory compression are live.
- This bridge is the canonical cross-assistant handoff for work on Nexus Labs.
- Existing background documents remain in `FROM_CLAUDE.md`, `FROM_CHATGPT.md`, `IDENTITY.md`, and `Nexus_Labs_Master_Builder_Handoff.md`.

## NEXT

At the beginning of the next Claude or Codex session, read `BRIDGE.md` first. Before the session ends—or before usage runs out—update STATUS, NEXT, BLOCKERS, and add one newest-first LOG entry describing completed work and the exact next action.

## BLOCKERS

- None.
- Mr. Lopez should not need to copy and paste between Claude and Codex as long as the assistant ending a session updates this file.

## DECISIONS

- `BRIDGE.md` at the repository root is the canonical continuity file.
- Both Claude and Codex may update it directly through their connectors.
- One current STATUS and one concrete NEXT action are preferred over long transcripts.
- Repository: `jrl6933380-hub/nexus-labs`; default branch: `main`.
- Nex-originated writes may require Mr. Lopez to approve the queued action, so Nex updates can appear with a delay.

## LOG

- [2026-09-01] [CODEX] — Created the shared Claude ↔ Codex bridge after confirming the repository and protocol with Nex; next assistant should read this file first and update it at handoff.
