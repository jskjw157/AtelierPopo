# SearchAd Recovery — 2026-09-11

This recovery branch is isolated from `main` and the existing PR head while the latest SearchAd write runtime is reconstructed and re-verified.

Current verified/reconstructed scope:

- PostgreSQL SearchAd write repository for plans, approvals, attempts, and locks.
- Atomic one-time approval token claim with PostgreSQL transactions and row locking.
- Explicit `ATELIER_SEARCHAD_WRITE_STORAGE=postgres` runtime selection.
- Repository-backed lock contract shared by SQLite and PostgreSQL runtimes.
- Async-compatible plan, approval, execution, reconcile, and rollback service paths.
- Existing SQLite write-path regression coverage retained.
- PostgreSQL integration coverage for durable runtime plan storage and approved execution.

Safety boundary during recovery:

- No real SearchAd account mutation is performed by this recovery work.
- No Hostinger deployment or production database migration is performed by this recovery work.
- Real-account activation remains gated behind capability and canary validation.

Known independent CI blocker before this recovery work: production dependency audit reports a high-severity advisory for `sharp < 0.35.4`; functional and integration checks are evaluated separately and the dependency issue must be fixed rather than bypassed.
