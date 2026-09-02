# Nex Build Mode Verification

This file confirms that direct, immediate writes on a non-default
(non-live) branch work as designed.

- Branch: `test/nex-build-mode-verification`
- Written by: Nex
- Purpose: verify that `create_repo_file` executes immediately (no
  approval queue) when targeting a branch other than the repo's
  live/default branch, as opposed to writes targeting `main`, which
  always queue for Mr. Lopez's approval regardless of what's said in
  conversation.

This is a test artifact and can be deleted once verified.
