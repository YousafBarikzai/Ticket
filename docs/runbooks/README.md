# Runbooks

One page per operational task, each linked from the alert that triggers it
(`docs/architecture/15 §5`). A runbook says what to check, what to do, and how
to tell it worked; it does not explain the architecture.

| Runbook | When |
|---|---|
| [Deploy and roll back](deploy-and-rollback.md) | Every release, and when one goes wrong |
| [Queue replay and outbox reconciliation](queue-replay.md) | Outbox lag alert, dead-letter growth, Redis loss |
| [Database restore](database-restore.md) | Data loss, a bad migration, the phase restore rehearsal |
| [Tenant lifecycle](tenant-lifecycle.md) | Provisioning, suspending, exporting or deleting a tenant |
| [Audit chain break](audit-chain-break.md) | The nightly verifier raises a security alert |

Runbooks still to write, with the phase that needs them: provider outage
(PH-2 email, PH-4 chat and telephony), compromised credentials, rate-limit
tuning, AI kill switch (PH-4), disaster recovery to a second region (PH-4).
