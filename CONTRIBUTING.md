# Contributing

## Pull requests

Every pull request against `main` is audited by the `PR audit` workflow before it can merge. The check
appears on the pull request as `PR audit`, and it is the only status that matters.

The audit does not look at the commit a branch started from. It fetches the merge commit GitHub builds
from the pull request head and the current tip of `main`, so a branch that no longer applies, or that
only passed on a stale base, fails here instead of on `main` afterwards. A pull request with a merge
conflict fails at that point, before anything is installed.

What the audit runs is one gate: `npm run verify`. That script is defined in `package.json` and is the
authority on what green means. It covers the linter, the comment policy, the root and desktop
typechecks, the root and desktop builds, and the full test suite, cheapest first.

It also refuses a branch that makes the suite smaller. Deleted test files, removed cases, and cases
turned into `it.skip` or `it.todo` are compared against the base commit, because a suite that passes
because its tests were removed is not a passing suite. Test deletions belong on `main`, where they are
reviewed as the change they are.

## Merging is manual

The audit never merges, and it holds no permission that would let it try. A green `PR audit` means the
branch is ready for a human to merge, nothing more. Merging, and the decision to merge, stays with a
maintainer.

## Before you open a pull request

Run the same gate locally. It is the same script the audit calls, so a green run here means a green
audit there, barring a `main` that moved under you.

```
npm ci
npm ci --prefix desktop
npm run verify
```

The test-shrink check is the one part of the audit that needs a base commit, so it only runs on pull
requests:

```
PR_AUDIT_BASE=main npm run audit:tests
```
