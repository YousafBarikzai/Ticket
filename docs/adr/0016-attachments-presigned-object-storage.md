# ADR-0016 · Attachments: direct presigned uploads to object storage; visible only after malware scan

**Status:** Proposed · **Date:** 2026-09 · **Specification reference:** §4.2 Object storage, MOD-04-E1, MOD-15

## Context

Attachments up to 25 MB arrive from web, mobile, email and chat; they must never pass through the API server, must be scanned before anyone can download them, and must be tenant-isolated and residency-aware.

## Decision

Clients request a presigned PUT (`/tickets/{id}/attachments:presign`) for a tenant-prefixed key in the tenant's regional bucket, upload directly, then register the object. A `scan` job streams the object to ClamAV; `scan_status` moves `pending → clean|infected`; only `clean` attachments are listed or downloadable (short-lived presigned GET after a permission check). Channel adapters upload on the sender's behalf through the same path. Keys never contain user-supplied names; bucket versioning and lifecycle rules apply; deletion removes object and row together.

## Alternatives considered

- **Proxying uploads through the API.** Rejected: memory and bandwidth on the API; slower.
- **Scanning synchronously at upload.** Rejected: provider timeouts and large files; asynchronous scan with pending state is safer.
- **Storing attachments in PostgreSQL.** Rejected: size and backup cost.

## Consequences

- Object storage location is part of the residency decision (R2 EU vs S3 London).
- The UI shows a "scanning" state briefly; infected files are quarantined with an audit and a security alert.
