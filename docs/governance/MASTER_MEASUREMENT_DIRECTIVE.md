# MASTER DIRECTIVE: COMPLETE CODEBASE MEASUREMENT, EVIDENCE COLLECTION, AND LEDGER ACCOUNTABILITY

**Status:** ACTIVE REQUIREMENT for the GrindrX project
**Introduced:** 2026-10-09
**Authority:** Project owner. Binding on all agents and contributors.
**Ledger of record:** `docs/governance/MASTER_MEASUREMENT_LEDGER.md` + `master_measurement_ledger.jsonl`

## 0. Precedence

This directive overrides any informal convention to the contrary. If an earlier
instruction, habit, or summary treated measurement as optional, that is
superseded. Measurement is a deliverable, not a courtesy.

## 1. Mission

Establish a comprehensive, evidence-backed, measurable understanding of this
entire codebase as it actually exists: source, architecture, dependencies,
interfaces, behavior, tests, security, privacy, platform integration, build,
release, provenance, deficiencies, and operational characteristics.

**Measure what can be measured. Verify what can be verified. Record what
remains unknown. Preserve the evidence needed to reproduce each conclusion.**

Do not assume an aspect is healthy because it looks reasonable, because a test
exists, because a function is named appropriately, because documentation claims
it works, or because the app previously appeared to work.

## 2. Core Rules (non-negotiable)

1. **No material finding may exist only in an agent conversation.** Every finding
   gets a stable ID and lands in the Master Measurement Ledger.
2. **No significant engineering conclusion without an evidence trail.** File path,
   line, command, tool version, and observed output.
3. **No claimed improvement is verified without post-change measurement.**
4. **A proposed remediation is not complete until its acceptance criteria are
   met AND the result is re-measured.** Writing code or making a commit does not
   close a finding.
5. **Negative and unknown results are recorded, not omitted.** "Cannot be measured
   because X; verifying it would require Y" is a valid, required entry.
6. **Never invent a test result.** Unrun tests are recorded as *unexecuted*.
   Passing against a mock is not proof against a real service contract.
7. **Never present a heuristic as proof.** Label approximations as approximate.
8. **A static audit does not prove absence of vulnerabilities.** State what was
   examined and what remains untested.
9. **Never overwrite the historical baseline** in a way that destroys the ability
   to compare revisions.
10. **Metric count is not completeness.** A large number of recorded numbers does
    not excuse leaving high-risk areas unexamined.

## 3. Required Status Vocabulary

Finding status:

`OPEN → TRIAGED → APPROVED → IN_PROGRESS → IMPLEMENTED → VERIFIED → CLOSED`

Alternate outcomes: `DEFERRED`, `REJECTED_WITH_REASON`, `NOT_REPRODUCIBLE`,
`BLOCKED`.

Evidence status: `measured` | `inferred` | `unverified` | `blocked` |
`not-applicable`.

Priority: `P0` critical security/privacy/data-loss/release-blocking ·
`P1` major feature or reliability failure · `P2` meaningful debt ·
`P3` low-risk cleanup · `Informational`.

Priority is a triage aid, not a substitute for reasoning. **Explain why each
priority was assigned.**

## 4. Required Ledger Fields

Every measurement or finding records, where applicable:

ID · Domain · Repository · Baseline (commit/branch) · Scope · Metric/Finding ·
Definition · Value/Result (with units) · Method · Evidence · Timestamp ·
Environment · Status · Confidence (+reason) · Limitations · Risk/Impact ·
Priority (+reason) · Owner · Disposition · Acceptance criteria · Remeasurement

Each record must be interpretable and auditable **without relying on an agent's
memory**.

## 5. Scope

The complete project: main application, submodules, generated code, config,
tests, build scripts, assets, docs, native projects, migration artifacts, and
supporting repositories in scope.

Each discovered area must be classified as one of:

- Inspected and measured
- Inspected but not fully measurable
- Requires execution or runtime access
- Requires external service or server verification
- Requires physical device or platform build environment
- Excluded with explicit justification
- Not yet inspected

**Do not describe the codebase as completely audited while material areas remain
uninspected.**

## 6. Measurement Domains

Repository/source inventory · language and complexity · architecture and
dependency graph · API/protocol/data contracts · tests and verification ·
security · privacy and data lifecycle · performance and resource use ·
reliability and fault handling · platform and build readiness · git history and
provenance.

Domain detail is defined by the master plan audit sections and the audit
briefing in `/srv/projects/grindrx-recon/docs/BRIEF.md`.

## 7. Evidence and Reproducibility

Evidence must carry: repository and commit · file path and symbol/line range ·
command or tool and version · inputs/flags/environment · observed output or
pointer to a preserved report · whether the command completed successfully ·
known limitations.

Prefer stable report files over pasting large outputs into the ledger.
Record checksums for exported baseline artifacts where practical.

**Redact credentials, tokens, cookies, private keys, personal data, and secrets.**
Record the *existence and location* of secret configuration without exposing
values. Never place live credentials in the ledger.

## 8. Baseline Before Modification

The initial measurement phase is **observational and non-destructive**.

Before changing code: record repo/branch/HEAD/worktree status · inventory
tracked, untracked, generated, and ignored material · identify available
toolchains · capture existing test/build status where safe · record known
failures *before* attempting fixes · establish ledger and methodology · identify
areas needing specialist access or hardware · record what has and has not been
measured.

During baseline collection do **not** clean up files, rewrite modules, reformat,
delete generated artifacts, upgrade dependencies, or make opportunistic fixes.
Do not start a build or test procedure likely to overwrite important working
files without first checking configuration and state.

**The first objective is to understand the baseline, not to improve it
prematurely.**

## 9. Agent Division Without Losing Control

Parallelism must not compromise data integrity. Divide by bounded domain. Each
agent receives: bounded scope · baseline commit · measurement checklist · output
format · ledger fields to populate · **instruction not to modify source during
baseline auditing** · requirement to distinguish observation from assumption ·
requirement to report unmeasured areas and blockers.

**Agents must not independently rewrite the master summary or concurrently
overwrite the same ledger file.** Use separate domain files, then reconcile into
the canonical ledger. Deduplicate while preserving all source evidence.

**One agent's claim is not evidence for another** unless traceable to the
original measurement or independently verified. Verification is a separate,
procedurally constrained step.

## 10. Coverage Must Be Demonstrated

Maintain a coverage register: every subsystem, directory, interface category,
platform, and domain, recording expected scope, scope inspected, measurements
completed, limitations, outstanding work, evidence location, completion status.

**Calculate percentages only with a defensible denominator.** A defensible
denominator might be the 120 discovered API wrappers. "95% of the codebase has
been audited" is not acceptable unless the methodology defines the unit of
audited scope.

Report coverage dimensions separately rather than collapsing to one score: file
inventory · source analysis · test execution · API contract · security review ·
platform build · runtime verification · provenance reconciliation.

A completed static inspection is **not** equivalent to a successful runtime
test. Preserve that distinction.

## 11. Flaky and Failing Tests Are Findings

A test that fails intermittently is a **defect in the test suite**, not an
inconvenience. For every observed failure record:

- exact test name (suite + test title)
- exact error text
- reproduction conditions (load, concurrency, ordering, timing)
- whether it is pre-existing or introduced by a change
- whether the underlying product code is implicated
- acceptance criteria for closure

Never report a green suite without stating how many times it was run. A single
green run does not establish reliability.

## 12. Measure Every Change

For every substantive change: record affected files and interfaces · record the
original measurement or defect · state intended change and acceptance criteria ·
record the patch or commit · run relevant tests and checks · repeat applicable
measurements · compare before and after · check for regressions in related
subsystems · update ledger and evidence references · close only after
verification.

**When a metric worsens, investigate and document whether the regression is
intentional, acceptable, or a defect.** When a change cannot be verified, leave
it marked unverified.

## 13. Automation Where Practical, Cost-Bounded

Automate recurring measurement when reliable and useful: file/line counts · test
discovery and result collection · coverage · dependency inventory · security
scans · duplicate-source detection · API wrapper/schema consistency ·
native-command registration vs usage · version consistency · dead-code
candidates · artifact and backup inventories · provenance comparisons ·
build/release-gate status · before/after comparisons.

**Automated detectors produce candidates for investigation, not proof.**

**Do not automatically delete** unused-looking code, dependencies, files,
branches, or artifacts on heuristic evidence. Confirm purpose, dependencies,
provenance, and recoverability first.

Do not add monitoring infrastructure or expensive CI jobs merely to maximize
metric count. Measure cost and expected value.

## 14. Completion Criteria

Initial mission complete only when: all discovered areas have a disposition ·
every in-scope subsystem has a measurement or a specific documented blocker ·
canonical ledger exists and is internally consistent · every material finding
has evidence and a stable ID · every measurement has a definition and method ·
static findings distinguished from runtime-verified results · unmeasured areas
and external dependencies explicitly identified · baseline preserved · duplicate
and conflicting findings reconciled · sensitive data redacted from retained
evidence · high-risk findings prioritized · future remediation tieable to a
measured baseline · another agent can reproduce important conclusions without
undocumented knowledge from the original investigator.

**Do not claim absolute completeness** where tools, access, hardware, server
contracts, or external dependencies prevent verification. Report precisely what
was measured, what remains unknown, why, and what would be needed to verify it.

## 15. Required Deliverables

1. Master Measurement Ledger (index + methodology + critical findings)
2. Repository Baseline Report
3. Measurement Coverage Register
4. Architecture and Dependency Report
5. API and Contract Inventory
6. Security and Privacy Report
7. Test and CI Report
8. Platform Readiness Report
9. Source Provenance Report
10. Prioritized Remediation Register
11. Reproducibility Instructions
12. Executive Measurement Summary

Avoid twelve contradictory versions of the same information. The ledger links
to detailed reports; detailed reports reference stable ledger IDs.

## 16. Final Principle

**If a property can be measured, measure it. If a result can be verified, verify
it. If a conclusion depends on an assumption, record the assumption. If
something cannot be measured, record the limitation. If a decision is made,
preserve its rationale. If the system changes, measure the change.**

The goal is to replace uncertainty with evidence, undocumented assumptions with
explicit contracts, and uncontrolled change with measurable engineering
progress.
