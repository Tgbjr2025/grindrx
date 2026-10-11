# Mutation check — viewers hash resolution

Branch `fix/viewers-hash-resolution`. Backups `.bak.pre_mutation.*` taken before the
run and removed after; the tree was verified byte-identical to the last commit
afterwards (`git status src/` clean, no `MUTATION-` marker anywhere in tracked source).

Baseline before the change: vitest 1115 passed / 0 failed / 2 skipped, svelte-check 0 errors.
After: vitest 1167 passed / 0 failed / 2 skipped (+52), svelte-check 0 errors.

## What each mutation did, and what caught it

| # | Mutation | Result |
|---|---|---|
| 1 | `resolveViewerProfileId`: let the resolved id win over a server-provided one | **2 failed** — both (b) tests, `expected 99 to be 7` |
| 2 | `resolveProfileIdByHash`: drop the `conflicted` read guard | **PASSED — 74/74. Not a real defence.** See below. |
| 2b | `noteProfileIdentity`: keep the first id on conflict instead of poisoning | **11 failed** across both suites |
| 3 | `evictOverflow`: never evict | **3 failed** — the three eviction tests |
| 4 | `hydrate()`: never read localStorage | **4 failed** — both restart tests + 2 corrupt-document tests |
| 5 | `purgeAccountLocalData`: drop the identity-index step | **1 failed** — `expected 1 to be +0` |
| 6 | `normalizeHash`: accept any non-empty string | **2 failed** — shape-validation + corrupt-document tests |

## Mutation 2 is the interesting one, and it is NOT a weak test

Mutation 2 removed the conflict guard from the *reader* and nothing failed. That is
correct behaviour of the implementation, not a gap in the tests: the reader's
`conflicted.has()` check is defence-in-depth, because the **write path** already
removes the identity from the map when it poisons the hash. The reader cannot
return a poisoned id even with its own guard removed.

Mutation 2b mutates that actual protection — the `identities.delete(hash)` in
`noteProfileIdentity` — and 11 tests fail. So the property IS pinned; it is pinned
at the place that enforces it. Recorded here rather than quietly reporting "all
mutations caught", because "I mutated something and nothing happened" is only
honest if you then find out whether the property is covered somewhere else. It is.
