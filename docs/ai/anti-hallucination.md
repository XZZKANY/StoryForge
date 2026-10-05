# Large Codebase Anti-Hallucination Protocol

This document defines the investigation protocol for high-risk work in a large existing codebase.

Use this protocol when performing:

- architecture analysis
- large refactors
- dead-code removal
- legacy cleanup
- duplicate-system consolidation
- state ownership changes
- migrations
- subsystem replacement
- unfamiliar subsystem investigation
- cross-package changes
- repository-wide claims

The purpose of this protocol is to prevent plausible but unsupported assumptions from becoming code changes.

# 1. Fundamental Rule

Never fill missing repository knowledge with plausible architecture.

If the code has not established something, it is not a fact.

When evidence is insufficient:

**say UNKNOWN and investigate.**

Being uncertain is acceptable.

Inventing certainty is not.

# 2. Evidence Classification

For every important architectural conclusion, internally classify the information as:

## OBSERVED

Directly supported by source code or runtime evidence that was actually inspected.

Examples:

- file A imports file B
- function X calls function Y
- this state variable is written here
- this route registers this handler
- this configuration value is read here

## INFERRED

Strongly suggested by observed evidence but not directly proven.

Examples:

- this module appears to be the primary implementation
- this state probably mirrors another state
- this file appears to be legacy code

An inference must never silently become an observed fact.

## UNKNOWN

Not yet established.

Examples:

- whether dynamic loading references a module
- whether another package consumes an exported API
- whether a legacy path still serves production traffic
- whether a runtime registry loads a class indirectly

UNKNOWN is a valid outcome.

# 3. Source Hierarchy

When sources disagree, prioritize evidence approximately in this order:

1. current executable source code
2. runtime behavior and tests
3. build/configuration files
4. generated or registration metadata
5. current documentation
6. comments
7. historical notes
8. previous AI summaries

Previous AI analysis must never be treated as ground truth.

Before changing an area, re-open and verify the relevant source code.

# 4. Investigation Scope

Do not investigate the entire repository deeply by default.

Start from the target behavior or subsystem.

Expand outward only when dependencies require it.

A typical investigation should establish:

1. entry point
2. primary execution path
3. callers
4. dependencies
5. state ownership
6. persistence
7. configuration
8. external interfaces
9. tests
10. downstream effects

The goal is not to read everything.

The goal is to read enough of the correct code to justify the conclusion.

# 5. Build a Verified Execution Path

When investigating behavior, trace a concrete path.

For example:

```
User Action
    ↓
UI Handler
    ↓
Domain Function
    ↓
Service
    ↓
API / Storage
    ↓
State Update
    ↓
Rendered Result
```

Every important arrow should correspond to actual evidence.

Do not insert an expected architectural layer merely because such a layer would be conventional.

If a step cannot be verified, mark the gap as UNKNOWN.

# 6. Read Callers, Not Just Callees

Do not understand a function only by reading its implementation.

Inspect enough callers to understand:

- what inputs are actually supplied
- which outputs are consumed
- which side effects callers depend on
- what error behavior callers expect
- whether callers depend on undocumented behavior

Similarly, when changing a public or shared module, inspect downstream consumers.

# 7. Trace Writes Before Declaring Source of Truth

Multiple copies of similar data do not automatically mean multiple sources of truth.

For each representation, determine:

- who creates it
- who writes it
- who updates it
- who reads it
- whether it survives restart
- whether it is derived
- whether it is cached
- whether it is persisted
- whether it mirrors another value

A value is authoritative because of ownership and write semantics, not because of its variable name.

Only declare multiple sources of truth when independent authoritative writes can actually occur.

# 8. Dead-Code Investigation Protocol

Never label code "dead" because no obvious caller appears nearby.

Before suggesting deletion, investigate relevant mechanisms.

## Static references

Search for:

- imports
- named imports
- default imports
- exports
- re-exports
- function references
- class references
- constructor calls
- constant references

## Dynamic references

Search for:

- dynamic `import()`
- `require()`
- reflection
- module loaders
- registries
- dependency injection
- plugin systems
- event registration
- route registration
- string-based lookup
- file-system discovery
- naming conventions used by frameworks

## Operational references

Check as relevant:

- configuration
- environment files
- build scripts
- deployment scripts
- package manifests
- code generation
- database migrations
- scheduled jobs
- workers
- CLI entry points

## Cross-boundary references

Check as relevant:

- other packages in the monorepo
- public exports
- frontend/backend contracts
- tests
- fixtures
- examples that are actually executed
- scripts

After investigation, classify the result as:

### CONFIRMED ACTIVE

Evidence shows it is used.

### LIKELY ACTIVE

Strong evidence exists, but some runtime behavior is not fully verified.

### DELETION CANDIDATE

No usage was found after appropriate searching, but complete absence cannot be proven.

### CONFIRMED DEAD

There is sufficient repository/runtime evidence to justify removal with high confidence.

Prefer `DELETION CANDIDATE` over false certainty.

# 9. Duplicate-Code Investigation Protocol

Do not merge two implementations merely because they have similar names or code.

For each implementation determine:

- callers
- contract
- input shape
- output shape
- side effects
- lifecycle
- platform
- environment
- error behavior
- migration status
- test/runtime role
- performance requirements

Possible explanations for apparent duplication include:

- old/new migration
- browser/server implementation
- production/test implementation
- synchronous/asynchronous behavior
- internal/public API
- different lifecycle semantics
- backwards compatibility

Only consolidate them after proving that their responsibilities are genuinely redundant.

# 10. Legacy / V2 / New / Final Files

Names such as:

- legacy
- old
- new
- v2
- v3
- final
- backup
- deprecated

are signals for investigation, not proof of redundancy.

For each version:

1. find callers
2. find write paths
3. identify contract differences
4. inspect migration history if available
5. determine whether coexistence is intentional
6. verify whether the migration actually completed

Do not delete based on naming alone.

# 11. Fallback Chains

Large fallback chains deserve investigation.

Example:

```
primaryValue
?? cachedValue
?? legacyValue
?? configValue
?? defaultValue
```

Do not immediately simplify them.

First determine:

- why each fallback was introduced
- which branches are reachable
- which branches are compatibility behavior
- which branch should be authoritative
- whether removing one changes production behavior

Fallback complexity may indicate architectural uncertainty, but it may also encode intentional compatibility.

Evidence decides.

# 12. Framework and Convention Awareness

Some systems are referenced indirectly.

Before deleting or moving code, consider framework-specific mechanisms such as:

- filesystem routing
- dependency injection
- decorators
- annotations
- reflection
- naming conventions
- automatic discovery
- plugin registration
- generated code
- schema registration
- migrations
- framework lifecycle hooks

Absence of direct imports does not prove absence of use.

# 13. Repository-Wide Claims

Statements involving terms such as:

- all
- every
- only
- never
- none
- entire repository
- globally
- no callers
- no dependencies

require correspondingly broad evidence.

If the search was scoped, say so.

Prefer:

> No references were found in the inspected packages.

over:

> This is unused everywhere.

Prefer:

> This appears to be the primary implementation among the inspected callers.

over:

> This is the only implementation.

Precision is more valuable than confidence theater.

# 14. Root Cause Investigation

Do not accept the first plausible explanation for a bug.

For a meaningful bug, establish:

## Symptom

What is observably wrong?

## Trigger

Under what conditions does it happen?

## Execution path

Which actual code path produces the behavior?

## State/data

What values are involved?

## Divergence point

Where does behavior first differ from what should happen?

## Root cause

What underlying condition produces the incorrect result?

Do not call a downstream symptom the root cause merely because changing it appears to make the bug disappear.

# 15. Before a High-Risk Change

Before editing, provide a compact investigation summary.

Use this structure:

## OBSERVED

List the code-backed facts.

## INFERRED

List conclusions that are likely but not proven.

## UNKNOWN

List unresolved questions that could materially affect the change.

## CURRENT BEHAVIOR

Describe how the relevant system works now.

## ROOT CAUSE

State the cause only if sufficiently supported.

If not yet established, say so.

## PROPOSED CHANGE

Describe the smallest coherent fix.

## EXPECTED FILES

List the files expected to change.

## RISKS

Identify potential behavior that could be affected.

Do not begin a broad destructive change while critical UNKNOWN items remain unresolved.

# 16. Minimal Change Principle

Once the root cause is established, prefer the smallest coherent change.

This does not mean minimizing line count at all costs.

A good change should be:

- conceptually small
- easy to understand
- easy to test
- easy to revert
- consistent with existing architecture
- sufficient to solve the root cause

Avoid unrelated cleanup in the same change.

# 17. Migration Protocol

When replacing an implementation:

1. identify old consumers
2. identify new consumers
3. define the migration boundary
4. migrate callers deliberately
5. verify behavior
6. search for remaining references
7. remove obsolete compatibility code when safe
8. test again

Do not leave indefinite parallel implementations unless coexistence is a real requirement.

Temporary compatibility must have a clear reason.

# 18. State Changes Require Extra Caution

When changing state ownership or persistence:

Trace:

```
creation
↓
writes
↓
updates
↓
serialization
↓
persistence
↓
hydration
↓
derived state
↓
consumers
```

Check whether:

- multiple writers exist
- updates can race
- persisted state can become stale
- consumers rely on timing
- migrations exist for persisted formats

State refactors often produce subtle bugs even when local code looks cleaner.

# 19. Cross-Package Changes

For monorepos or multi-package systems, do not stop at the local package boundary.

Before modifying shared exports, types, APIs, configuration, or behavior:

- identify dependent packages
- search imports/references
- inspect public exports
- check versioning or compatibility constraints
- run affected package tests where feasible

A local implementation detail may be a public contract elsewhere.

# 20. Tests Are Evidence, Not Proof of Everything

Passing tests increase confidence but do not prove:

- no hidden caller exists
- no production-only configuration exists
- no dynamic registration exists
- architecture is correct
- behavior outside test coverage is safe

Likewise, a failing test is evidence requiring investigation.

Never modify production logic solely to satisfy a test without understanding what behavior the test represents.

# 21. Validation After Change

After a meaningful change, perform relevant validation.

Possible checks include:

- targeted tests
- related subsystem tests
- integration tests
- type checking
- linting
- build
- static analysis
- runtime smoke tests

Then inspect the final diff.

Verify that:

- only intended files changed
- obsolete code was removed where appropriate
- no accidental duplicate implementation remains
- no unnecessary fallback was added
- no temporary debug code remains
- no new state duplication appeared
- no unrelated formatting/rewrite noise obscures the change

# 22. Search Again After Refactors

After:

- renaming
- moving
- deleting
- replacing
- changing exports
- changing APIs

search again for old references.

Do not assume the initial search remains sufficient after the repository changes.

# 23. Confidence Should Match Evidence

Do not use confident language merely because a hypothesis seems architecturally reasonable.

Confidence should increase only when evidence increases.

Useful language includes:

- confirmed by
- directly referenced by
- appears to
- likely
- no references found in the searched scope
- not yet verified
- cannot establish from current evidence
- UNKNOWN

Avoid pretending uncertainty does not exist.

# 24. Stop Conditions

Pause investigation or avoid destructive modification when:

- critical dependencies remain unknown
- dynamic usage cannot be assessed
- public contracts are unclear
- state ownership remains ambiguous
- test coverage is insufficient for a high-risk change
- multiple plausible root causes remain
- expected blast radius cannot be reasonably bounded

At that point, gather more evidence rather than compensating with more code.

# 25. Anti-Slop Interaction

Anti-hallucination and anti-slop are connected.

A common failure mode is:

```
uncertain architecture
↓
AI guesses
↓
AI adds fallback
↓
AI adds wrapper
↓
AI adds another state
↓
system becomes more confusing
↓
next AI needs even more guesses
```

Break this cycle at the first step.

When architecture is unclear:

**investigate instead of adding compensating code.**

# 26. Required Attitude Toward Existing Code

Do not assume old code is wrong merely because it looks strange.

Strange code may encode:

- production incidents
- historical compatibility
- external-system quirks
- performance requirements
- migration constraints
- framework behavior

Investigate why it exists before "cleaning it up."

At the same time, do not preserve obsolete complexity merely because it is old.

Evidence determines whether it stays.

# 27. Core Protocol

For high-risk work, follow:

```
QUESTION
    ↓
SCOPE
    ↓
SEARCH
    ↓
READ
    ↓
TRACE
    ↓
OBSERVED / INFERRED / UNKNOWN
    ↓
ROOT CAUSE
    ↓
SMALLEST COHERENT CHANGE
    ↓
IMPLEMENT
    ↓
TEST
    ↓
RE-SEARCH
    ↓
DIFF REVIEW
    ↓
SIMPLIFY
```

Do not skip directly from:

```
QUESTION
    ↓
PLAUSIBLE GUESS
    ↓
CODE
```

# Final Rule

The repository does not have to match your expectations.

Your expectations must match the repository.

Search the code.

Trace the behavior.

Preserve uncertainty where uncertainty exists.

Make claims proportional to evidence.

When the evidence is insufficient, say:

**UNKNOWN.**