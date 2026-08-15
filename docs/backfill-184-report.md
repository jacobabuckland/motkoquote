# Issue #184 Backfill Report

This file will be populated when the backfill script is run.

To generate the dry-run report:
```bash
npx tsx scripts/backfill-stranded-fee-jobs.ts
```

To apply corrections after reviewing the dry-run report:
```bash
npx tsx scripts/backfill-stranded-fee-jobs.ts --apply
```
