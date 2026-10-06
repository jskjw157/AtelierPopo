# Dedicated SearchAd infrastructure preparation — 2026-10-07 KST

Issue22 infrastructure is prepared independently of the existing Commerce
deployment. See the [sanitized receipt](../../docs/searchad-evidence/2026-10-07/dedicated-infrastructure.json)
and [main preflight](../../docs/SEARCHAD_MAIN_INTEGRATION_2026-10-07.md).

## Actual prepared state

On verified srv1898445, `/opt/atelier-popo-searchad` contains this configuration
and privately generated credentials/certificates. Compose project
`atelier-searchad-infra` runs only PostgreSQL16.15, pinned to
`postgres@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
Dedicated volume `atelier_searchad_pgdata` is on internal network
`atelier_searchad_private`; no host port is published. Limits are512MiB memory,
0.75CPU,128MiB shared memory and40connections: initial bounds, not load qualification.

Database `searchad` has bootstrap/maintenance superuser `searchad_admin` and
separate migration/runtime role `searchad_owner`. The owner has no superuser,
create-database, create-role, replication or bypass-RLS privileges. It has DDL
privileges required by bootstrap migrations; it is not a separate read-only DB
role or a tenant isolation mechanism. No real Customer, grant, policy or provider
evidence was inserted.

Unchanged application pool/migrator modules from code62cdc1f ran in an ephemeral
Node22.23.2 container. They verified the CA and DNS name `searchad-postgres`,
negotiated TLS1.3, applied exact0001–0015 and repeated with `applied:[]`/0015.
All15 migration checksums,82tables and27triggers match. Plaintext TCP, an
untrusted CA and a hostname mismatch were independently denied. Restart of
**only this new DB** preserved metadata; owner/TLS and no-op migrations were reverified.

A custom-format dump was restored into a new temporary DB on this dedicated
instance. Schema/migration metadata matched; the temporary DB was dropped. The
dump has a verified private local copy outside Git and a private VPS copy.
This proves new empty-schema recovery, not live SearchAd data recovery.
Scheduled/off-site backups and full application/catalog/secrets/blob recovery
remain outstanding.

Existing v0.3.0 `atelier-popo-smartstore-api` Commerce and the other application's
PostgreSQL retained IDs, images and start times. Commerce remains healthy and
is not attached to the new network. No candidate app/worker was started, main
and Draft PRs remain unmerged, and Naver/Commerce/S3 provider calls were zero.

## Files and secrets

- `compose.yaml` starts infrastructure only. Private `.env` requires an inspected
  PostgreSQL16 digest. No floating default, app service or other-app volume reuse.
- `pg_hba.conf` requires SCRAM and rejects plaintext TCP.
- `init-owner.sh` initializes **an empty volume only**. Inspect a partial init;
  restart does not retry initialization. Never reset the existing named volume
  to rerun this script.
- `runtime.env.example` is intentionally incomplete. Private VPS copy
  `runtime-preparation.env` (0600) has the owner URI and is **not loaded into the
  live service**. All SearchAd gates, including reads/billing reads, are false;
  mode observe, worker disabled.
- Passwords, CA/server keys and backups remain outside Git under private root
  (0700). `.gitignore` excludes them. Compose secret files are protected local
  files, not a managed encrypted secret store. Never print a secret-bearing
  resolved runtime environment, enable shell tracing or commit those files.

Use `ATELIER_POSTGRES_SSL_MODE=verify-full` and mount the CA certificate as
`NODE_EXTRA_CA_CERTS=/run/searchad-tls/ca.crt`. Do not add `sslmode`, `sslcert`,
`sslkey` or `sslrootcert` URI parameters: node-postgres can replace the pool's
SSL object when parsing them. Server cert expires2027-10-06T23:18:35Z;
renew/reverify before expiry. The CA key is private and does not permit disabling HTTPS checks.

Read-only status command:

```sh
ssh vps 'docker compose --project-directory /opt/atelier-popo-searchad -f /opt/atelier-popo-searchad/compose.yaml ps'
```

PG readiness proves infrastructure only. A future separate app needs the private
network plus explicitly scoped outbound connectivity, CA mount and private env.
Do not attach/restart current Commerce as a shortcut. Cutover/rollback and its
work/catalog/config/secrets backup require a concrete integration plan.

## Report storage and remaining real inputs

Targeted inspection found no SearchAd/S3 configuration in existing project
environment/config/secrets paths or local project env files. This does not prove
absence from every external secret store. Actual Customer ID, principal/role/grant
authorization and API-key storage location are needed. Four HTTP roles need
distinct private keys/exact Customer allowlists. Commerce credentials and the
single-credential fallback do not establish SearchAd authority. No IDs/grants are invented.

Production ingestion requires an HTTPS S3-compatible bucket and real credentials.
The template leaves bucket/endpoint/region empty and requires ingestion; absent
storage remains unconfigured/unready. No bucket was purchased/created or called.
Use an explicitly mounted shared credential file or verified scoped role; configure
one intended credential source.

`report-storage-policy.example.json` is an **unapplied AWS-style template** for
PutObject/GetObject on the real Customer prefix after replacing BOTH markers.
It grants no deletion, is not a complete bucket policy, and says nothing about
other policies on an existing identity. KMS encryption may additionally need
key-specific permissions. Other S3 providers need equivalent scoped authorization.

Before declaring storage ready, verify private access/public-access blocking,
TLS, PutObject SHA256/checksum compatibility, immediate GetObject/matching bytes,
restart persistence and required two-year raw-report retention. Adapter
`retain-until` metadata is **not enforced Object Lock**; verified provider/default
retention and compatible lifecycle policy are necessary. No purge is enabled.
Clock/rollout uncertainty is unset until a justified explicit policy exists.

Real finance, production Circuit baseline, Passive Probe, stopped Canary/returned-ID
cleanup/48h/spend-zero evidence and activation remain later issue22 stages.
Generic parent DELETE remains blocked under issue26.

Official references: [Docker PostgreSQL/init/secret files](https://hub.docker.com/_/postgres),
[PostgreSQL16 TLS](https://www.postgresql.org/docs/16/ssl-tcp.html),
[node-postgres SSL URI behavior](https://node-postgres.com/features/ssl),
[AWS credentials](https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/setting-credentials-node.html),
[S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html).
