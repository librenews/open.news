---
description: QA expert writes end-to-end and unit tests for every feature and bugfix
---

# QA Coverage Directive

Every new feature or bugfix committed to this repo MUST be accompanied by tests.
The goal is 100% coverage of business logic. Use **Vitest** (`npm test`).

## Test Framework

- **Vitest** for unit and integration tests
- **@vitest/coverage-v8** for coverage reports
- Run: `npm test` | Coverage: `npm run test:coverage`
- Test files: `src/**/*.test.ts` and `src/**/*.test.tsx`

## What to Test for Every Change

### 1. Pure / Business Logic (unit tests — no mocks)
- All scoring logic in `articleDetector.ts`
- All URL utilities in `lib/urls.ts`
- Any new pure helper functions

### 2. Services with External I/O (mock `fetch` and DB)
- `articleFetcher.ts` — mock global `fetch`; assert UA headers, finalUrl capture on body failure
- `fetchArticle.ts` job — mock fetch + DB queries; cover dedup, redirect resolution, paywall path, denylist path
- `syncFollows.ts` — mock fetch; assert correct API called, sources upserted
- `atproto.ts` — mock fetch; assert pagination

### 3. Firehose Event Handling (mock DB and job queue)
- `handleEvent` paths: ignore non-commits, follow signup, bot mention, URL extraction
- Dedup: existing article → fan-out only; new article → enqueue fetchArticle
- Stats counters increment correctly

### 4. HTTP Routes (integration, mock DB)
- `/feed` — renders articles, handles `?notice=` param, BigInt serialization
- `/api/sources/sync` — redirects correctly, rate limit enforced
- `/admin` — returns 200 with stat data
- Auth routes — session handling

### 5. Regression Tests
- Every bug that was fixed MUST have a test that would have caught it:
  - `json_agg` double-parse bug (feed 500 when articles exist)
  - `$15` PostgreSQL parameter type ambiguity
  - `pg-boss` queue creation order (sequential, not parallel)
  - Short URL resolution when body read times out
  - Firehose URL too long (>175 DIDs)

## Coverage Thresholds

```json
{
  "branches": 80,
  "functions": 85,
  "lines": 85,
  "statements": 85
}
```

## Running Tests

```bash
npm test                  # run all tests
npm run test:coverage     # generate coverage report
npm run test:watch        # watch mode during development
```

## Process

Before opening a PR or committing a feature:
1. Write tests first (TDD preferred) or alongside the feature
2. Ensure `npm test` passes with zero failures
3. Check `npm run test:coverage` — new code should not drop coverage below thresholds
4. Regression tests must be added for any bug fix
