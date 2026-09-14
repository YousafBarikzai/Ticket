-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "setting" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL,
    "scope_id" UUID,
    "owner_id" UUID,
    "current_version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "setting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setting_version" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "setting_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "reason" TEXT,
    "published_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by" UUID,

    CONSTRAINT "setting_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flag_override" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "scope_type" TEXT NOT NULL DEFAULT 'tenant',
    "scope_id" UUID,
    "value" BOOLEAN NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "feature_flag_override_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "installed_module" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "module_id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "seeded_at" TIMESTAMPTZ(6),
    "installed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "installed_module_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "app_user_account" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "primary_org_id" UUID,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "idp_subject" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "manager_id" UUID,
    "locale" TEXT NOT NULL DEFAULT 'en-GB',
    "time_zone" TEXT NOT NULL DEFAULT 'Europe/London',
    "a11y_prefs" JSONB NOT NULL DEFAULT '{}',
    "is_external" BOOLEAN NOT NULL DEFAULT false,
    "is_break_glass" BOOLEAN NOT NULL DEFAULT false,
    "last_seen_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "app_user_account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'support_group',
    "email_alias" TEXT,
    "manager_id" UUID,
    "calendar_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "team_membership" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "team_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_in_team" TEXT NOT NULL DEFAULT 'member',
    "is_lead" BOOLEAN NOT NULL DEFAULT false,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "time_zone" TEXT NOT NULL DEFAULT 'Europe/London',
    "calendar_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permission" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'own',

    CONSTRAINT "role_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_assignment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "scope_type" TEXT,
    "scope_id" UUID,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "role_assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "sid" TEXT NOT NULL,
    "device" TEXT,
    "ip" TEXT,
    "user_agent" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_key" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "service_user_id" UUID NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "revoked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "api_key_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delegate" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "principal_id" UUID NOT NULL,
    "delegate_id" UUID NOT NULL,
    "capability" TEXT NOT NULL DEFAULT 'approve',
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delegate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" INTEGER,
    "envelope" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,

    CONSTRAINT "outbox_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_event" (
    "consumer" TEXT NOT NULL,
    "event_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL DEFAULT 'done',
    "error" TEXT,

    CONSTRAINT "inbox_event_pkey" PRIMARY KEY ("consumer","event_id")
);

-- CreateTable
CREATE TABLE "consumer_registry" (
    "consumer" TEXT NOT NULL,
    "module_id" TEXT NOT NULL,
    "event_types" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consumer_registry_pkey" PRIMARY KEY ("consumer")
);

-- CreateTable
CREATE TABLE "webhook_subscription" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "event_types" TEXT[],
    "filters" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "owner_id" UUID,
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "webhook_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_delivery" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "response_code" INTEGER,
    "latency_ms" INTEGER,
    "error" TEXT,
    "next_attempt_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_template" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en-GB',
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "body_format" TEXT NOT NULL DEFAULT 'text',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "conditions" JSONB,
    "audience" JSONB NOT NULL DEFAULT '[]',
    "template_key" TEXT NOT NULL,
    "channels" TEXT[] DEFAULT ARRAY['inapp']::TEXT[],
    "is_emergency" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "notification_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "recipient_id" UUID NOT NULL,
    "rule_key" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "ticket_id" UUID,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_attempt" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "notification_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "provider_ref" TEXT,
    "error" TEXT,
    "attempted_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preference" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours" JSONB,
    "digest_mode" TEXT NOT NULL DEFAULT 'immediate',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_preference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "device_registration" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "platform" TEXT NOT NULL,
    "push_token" TEXT NOT NULL,
    "app_version" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "device_registration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_document" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "acl" JSONB NOT NULL DEFAULT '{}',
    "facets" JSONB NOT NULL DEFAULT '{}',
    "source_updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "search_document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "on_behalf_of" UUID,
    "grantee_tenant_id" UUID,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "correlation_id" TEXT NOT NULL,
    "ip" TEXT,
    "user_agent" TEXT,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "hash" TEXT NOT NULL,
    "prev_hash" TEXT,

    CONSTRAINT "audit_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_alert" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "details" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'open',
    "ticket_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(6),

    CONSTRAINT "security_alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_classification" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "level" TEXT NOT NULL DEFAULT 'internal',
    "masking_rule" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "data_classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retention_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "record_type" TEXT NOT NULL,
    "keep_days" INTEGER NOT NULL,
    "action" TEXT NOT NULL DEFAULT 'delete',
    "legal_hold_exempt" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "retention_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_calendar" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "hours" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "business_calendar_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_exception" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "calendar_id" UUID NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'holiday',
    "hours" JSONB,
    "name" TEXT,

    CONSTRAINT "calendar_exception_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_policy" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "match" JSONB NOT NULL DEFAULT '{"always":true}',
    "specificity" INTEGER NOT NULL DEFAULT 0,
    "calendar_mode" TEXT NOT NULL DEFAULT 'group',
    "calendar_id" UUID,
    "status" TEXT NOT NULL DEFAULT 'published',
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "sla_policy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_target" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "priority" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "minutes" INTEGER NOT NULL,
    "warning_thresholds" INTEGER[] DEFAULT ARRAY[50, 75, 90]::INTEGER[],

    CONSTRAINT "sla_target_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_timer" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "task_id" UUID,
    "target_type" TEXT NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "calendar_id" UUID,
    "target_ms" INTEGER NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL,
    "due_at" TIMESTAMPTZ(6),
    "paused_at" TIMESTAMPTZ(6),
    "last_resumed_at" TIMESTAMPTZ(6),
    "elapsed_ms" INTEGER NOT NULL DEFAULT 0,
    "remaining_ms" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'running',
    "warnings_fired" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "next_warning_at" TIMESTAMPTZ(6),
    "met_at" TIMESTAMPTZ(6),
    "breached_at" TIMESTAMPTZ(6),
    "partition" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "sla_timer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sla_pause" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timer_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "from" TIMESTAMPTZ(6) NOT NULL,
    "to" TIMESTAMPTZ(6),

    CONSTRAINT "sla_pause_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "priority_matrix" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "impact" TEXT NOT NULL,
    "urgency" TEXT NOT NULL,
    "priority" TEXT NOT NULL,

    CONSTRAINT "priority_matrix_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "escalation_rule" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "on" TEXT NOT NULL,
    "step" INTEGER NOT NULL DEFAULT 1,
    "notify" JSONB NOT NULL DEFAULT '{}',
    "action" JSONB,

    CONSTRAINT "escalation_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "breach_record" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "timer_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "breached_at" TIMESTAMPTZ(6) NOT NULL,
    "reason_code" TEXT,
    "excused_by" UUID,
    "excuse_reason" TEXT,
    "excused_at" TIMESTAMPTZ(6),

    CONSTRAINT "breach_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'provisioning',
    "parent_tenant_id" UUID,
    "region" TEXT NOT NULL DEFAULT 'eu-west',
    "plan_key" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "suspended_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_domain" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "channel_directory" (
    "id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "channel_directory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_grant" (
    "id" UUID NOT NULL,
    "grantee_tenant_id" UUID NOT NULL,
    "target_tenant_id" UUID NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "granted_by" UUID NOT NULL,
    "valid_from" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valid_to" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_grant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_provisioning_job" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "started_at" TIMESTAMPTZ(6),
    "finished_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_provisioning_job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organisation" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'business_unit',
    "path" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "number" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "description_format" TEXT NOT NULL DEFAULT 'text',
    "status" TEXT NOT NULL,
    "status_category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'P3',
    "impact" TEXT,
    "urgency" TEXT,
    "requester_id" UUID,
    "affected_user_id" UUID,
    "assignee_id" UUID,
    "group_id" UUID,
    "service_id" UUID,
    "category_id" UUID,
    "source_channel" TEXT NOT NULL DEFAULT 'api',
    "channel_ref" TEXT,
    "parent_id" UUID,
    "sla_policy_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "merged_into_id" UUID,
    "external_ref" TEXT,
    "custom" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "created_by_type" TEXT NOT NULL DEFAULT 'user',
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ticket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_comment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "author_id" UUID,
    "author_type" TEXT NOT NULL DEFAULT 'user',
    "visibility" TEXT NOT NULL DEFAULT 'public',
    "body" TEXT NOT NULL,
    "body_format" TEXT NOT NULL DEFAULT 'text',
    "channel" TEXT NOT NULL DEFAULT 'api',
    "external_ref" TEXT,
    "quoted_body" TEXT,
    "edited_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ticket_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_event" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actor_type" TEXT NOT NULL,
    "actor_id" UUID,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "comment_id" UUID,
    "object_key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "scan_status" TEXT NOT NULL DEFAULT 'pending',
    "scan_verdict" TEXT,
    "scanned_at" TIMESTAMPTZ(6),
    "classification" TEXT NOT NULL DEFAULT 'internal',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_task" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assignee_id" UUID,
    "group_id" UUID,
    "due_at" TIMESTAMPTZ(6),
    "order" INTEGER NOT NULL DEFAULT 0,
    "blocked_by" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" TEXT NOT NULL DEFAULT 'internal',
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ticket_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_link" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,
    "link_type" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" UUID,

    CONSTRAINT "ticket_link_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_watcher" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "ticket_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_watcher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_view" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "owner_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "query" JSONB NOT NULL DEFAULT '{}',
    "is_shared" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "saved_view_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "default_group_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_definition" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "org_id" UUID,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" JSONB NOT NULL DEFAULT '[]',
    "applies_to" JSONB NOT NULL DEFAULT '{}',
    "required_when" JSONB,
    "visible_to" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "classification" TEXT NOT NULL DEFAULT 'internal',
    "order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "field_definition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ticket_counter" (
    "tenant_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ticket_counter_pkey" PRIMARY KEY ("tenant_id","type")
);

-- CreateIndex
CREATE INDEX "setting_tenant_id_key_idx" ON "setting"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "setting_tenant_id_key_scope_type_scope_id_key" ON "setting"("tenant_id", "key", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "setting_version_tenant_id_idx" ON "setting_version"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "setting_version_setting_id_version_key" ON "setting_version"("setting_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flag_override_tenant_id_key_scope_type_scope_id_key" ON "feature_flag_override"("tenant_id", "key", "scope_type", "scope_id");

-- CreateIndex
CREATE UNIQUE INDEX "installed_module_tenant_id_module_id_key" ON "installed_module"("tenant_id", "module_id");

-- CreateIndex
CREATE INDEX "app_user_account_tenant_id_status_idx" ON "app_user_account"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "app_user_account_tenant_id_idp_subject_idx" ON "app_user_account"("tenant_id", "idp_subject");

-- CreateIndex
CREATE INDEX "app_user_account_tenant_id_manager_id_idx" ON "app_user_account"("tenant_id", "manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "app_user_account_tenant_id_email_key" ON "app_user_account"("tenant_id", "email");

-- CreateIndex
CREATE INDEX "team_tenant_id_org_id_idx" ON "team"("tenant_id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_tenant_id_key_key" ON "team"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "team_membership_tenant_id_user_id_idx" ON "team_membership"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "team_membership_team_id_user_id_key" ON "team_membership"("team_id", "user_id");

-- CreateIndex
CREATE INDEX "location_tenant_id_org_id_idx" ON "location"("tenant_id", "org_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_tenant_id_key_key" ON "role"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "role_permission_tenant_id_permission_key_idx" ON "role_permission"("tenant_id", "permission_key");

-- CreateIndex
CREATE UNIQUE INDEX "role_permission_role_id_permission_key_scope_key" ON "role_permission"("role_id", "permission_key", "scope");

-- CreateIndex
CREATE INDEX "role_assignment_tenant_id_user_id_idx" ON "role_assignment"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "role_assignment_user_id_role_id_scope_type_scope_id_key" ON "role_assignment"("user_id", "role_id", "scope_type", "scope_id");

-- CreateIndex
CREATE INDEX "session_tenant_id_user_id_idx" ON "session"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "session_tenant_id_sid_key" ON "session"("tenant_id", "sid");

-- CreateIndex
CREATE INDEX "api_key_tenant_id_idx" ON "api_key"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "api_key_tenant_id_prefix_key" ON "api_key"("tenant_id", "prefix");

-- CreateIndex
CREATE INDEX "delegate_tenant_id_delegate_id_idx" ON "delegate"("tenant_id", "delegate_id");

-- CreateIndex
CREATE UNIQUE INDEX "delegate_principal_id_delegate_id_capability_key" ON "delegate"("principal_id", "delegate_id", "capability");

-- CreateIndex
CREATE INDEX "outbox_event_created_at_idx" ON "outbox_event"("created_at");

-- CreateIndex
CREATE INDEX "outbox_event_tenant_id_aggregate_type_aggregate_id_idx" ON "outbox_event"("tenant_id", "aggregate_type", "aggregate_id");

-- CreateIndex
CREATE INDEX "outbox_event_type_idx" ON "outbox_event"("type");

-- CreateIndex
CREATE INDEX "inbox_event_tenant_id_processed_at_idx" ON "inbox_event"("tenant_id", "processed_at");

-- CreateIndex
CREATE INDEX "webhook_subscription_tenant_id_status_idx" ON "webhook_subscription"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "webhook_delivery_tenant_id_subscription_id_created_at_idx" ON "webhook_delivery"("tenant_id", "subscription_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "webhook_delivery_tenant_id_status_idx" ON "webhook_delivery"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_template_tenant_id_key_channel_locale_key" ON "notification_template"("tenant_id", "key", "channel", "locale");

-- CreateIndex
CREATE INDEX "notification_rule_tenant_id_event_type_is_active_idx" ON "notification_rule"("tenant_id", "event_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "notification_rule_tenant_id_key_key" ON "notification_rule"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "notification_tenant_id_recipient_id_created_at_idx" ON "notification"("tenant_id", "recipient_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notification_tenant_id_status_idx" ON "notification"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "notification_event_id_recipient_id_rule_key_key" ON "notification"("event_id", "recipient_id", "rule_key");

-- CreateIndex
CREATE INDEX "delivery_attempt_tenant_id_notification_id_idx" ON "delivery_attempt"("tenant_id", "notification_id");

-- CreateIndex
CREATE INDEX "delivery_attempt_tenant_id_status_attempted_at_idx" ON "delivery_attempt"("tenant_id", "status", "attempted_at" DESC);

-- CreateIndex
CREATE INDEX "notification_preference_tenant_id_user_id_idx" ON "notification_preference"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preference_user_id_channel_key" ON "notification_preference"("user_id", "channel");

-- CreateIndex
CREATE INDEX "device_registration_tenant_id_user_id_idx" ON "device_registration"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "device_registration_tenant_id_push_token_key" ON "device_registration"("tenant_id", "push_token");

-- CreateIndex
CREATE INDEX "search_document_tenant_id_entity_type_updated_at_idx" ON "search_document"("tenant_id", "entity_type", "updated_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "search_document_tenant_id_entity_type_entity_id_key" ON "search_document"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_occurred_at_idx" ON "audit_event"("tenant_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_target_type_target_id_idx" ON "audit_event"("tenant_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_actor_id_idx" ON "audit_event"("tenant_id", "actor_id");

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_action_idx" ON "audit_event"("tenant_id", "action");

-- CreateIndex
CREATE INDEX "audit_event_tenant_id_seq_idx" ON "audit_event"("tenant_id", "seq");

-- CreateIndex
CREATE INDEX "security_alert_tenant_id_status_created_at_idx" ON "security_alert"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "data_classification_tenant_id_entity_field_key" ON "data_classification"("tenant_id", "entity", "field");

-- CreateIndex
CREATE UNIQUE INDEX "retention_policy_tenant_id_record_type_key" ON "retention_policy"("tenant_id", "record_type");

-- CreateIndex
CREATE UNIQUE INDEX "business_calendar_tenant_id_key_key" ON "business_calendar"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "calendar_exception_tenant_id_idx" ON "calendar_exception"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "calendar_exception_calendar_id_date_key" ON "calendar_exception"("calendar_id", "date");

-- CreateIndex
CREATE INDEX "sla_policy_tenant_id_status_specificity_idx" ON "sla_policy"("tenant_id", "status", "specificity" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "sla_policy_tenant_id_key_key" ON "sla_policy"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "sla_target_tenant_id_idx" ON "sla_target"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "sla_target_policy_id_priority_target_type_key" ON "sla_target"("policy_id", "priority", "target_type");

-- CreateIndex
CREATE INDEX "sla_timer_tenant_id_ticket_id_idx" ON "sla_timer"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "sla_timer_state_partition_due_at_idx" ON "sla_timer"("state", "partition", "due_at");

-- CreateIndex
CREATE UNIQUE INDEX "sla_timer_tenant_id_ticket_id_target_type_key" ON "sla_timer"("tenant_id", "ticket_id", "target_type");

-- CreateIndex
CREATE INDEX "sla_pause_tenant_id_timer_id_idx" ON "sla_pause"("tenant_id", "timer_id");

-- CreateIndex
CREATE UNIQUE INDEX "priority_matrix_tenant_id_org_id_impact_urgency_key" ON "priority_matrix"("tenant_id", "org_id", "impact", "urgency");

-- CreateIndex
CREATE INDEX "escalation_rule_tenant_id_policy_id_idx" ON "escalation_rule"("tenant_id", "policy_id");

-- CreateIndex
CREATE UNIQUE INDEX "breach_record_timer_id_key" ON "breach_record"("timer_id");

-- CreateIndex
CREATE INDEX "breach_record_tenant_id_breached_at_idx" ON "breach_record"("tenant_id", "breached_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_slug_key" ON "tenant"("slug");

-- CreateIndex
CREATE INDEX "tenant_status_idx" ON "tenant"("status");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_domain_host_key" ON "tenant_domain"("host");

-- CreateIndex
CREATE INDEX "tenant_domain_tenant_id_idx" ON "tenant_domain"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "channel_directory_channel_external_id_key" ON "channel_directory"("channel", "external_id");

-- CreateIndex
CREATE INDEX "tenant_grant_target_tenant_id_idx" ON "tenant_grant"("target_tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_grant_grantee_tenant_id_target_tenant_id_key" ON "tenant_grant"("grantee_tenant_id", "target_tenant_id");

-- CreateIndex
CREATE INDEX "tenant_provisioning_job_tenant_id_idx" ON "tenant_provisioning_job"("tenant_id");

-- CreateIndex
CREATE INDEX "organisation_tenant_id_path_idx" ON "organisation"("tenant_id", "path");

-- CreateIndex
CREATE INDEX "organisation_tenant_id_parent_id_idx" ON "organisation"("tenant_id", "parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "organisation_tenant_id_code_key" ON "organisation"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "ticket_tenant_id_status_category_priority_due_at_idx" ON "ticket"("tenant_id", "status_category", "priority", "due_at");

-- CreateIndex
CREATE INDEX "ticket_tenant_id_assignee_id_status_category_idx" ON "ticket"("tenant_id", "assignee_id", "status_category");

-- CreateIndex
CREATE INDEX "ticket_tenant_id_group_id_status_category_created_at_idx" ON "ticket"("tenant_id", "group_id", "status_category", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_tenant_id_requester_id_created_at_idx" ON "ticket"("tenant_id", "requester_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_tenant_id_service_id_created_at_idx" ON "ticket"("tenant_id", "service_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ticket_tenant_id_type_status_category_idx" ON "ticket"("tenant_id", "type", "status_category");

-- CreateIndex
CREATE INDEX "ticket_tenant_id_created_at_idx" ON "ticket"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_tenant_id_number_key" ON "ticket"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "ticket_comment_tenant_id_ticket_id_created_at_idx" ON "ticket_comment"("tenant_id", "ticket_id", "created_at");

-- CreateIndex
CREATE INDEX "ticket_comment_tenant_id_visibility_idx" ON "ticket_comment"("tenant_id", "visibility");

-- CreateIndex
CREATE INDEX "ticket_event_tenant_id_ticket_id_occurred_at_idx" ON "ticket_event"("tenant_id", "ticket_id", "occurred_at");

-- CreateIndex
CREATE INDEX "attachment_tenant_id_ticket_id_idx" ON "attachment"("tenant_id", "ticket_id");

-- CreateIndex
CREATE INDEX "attachment_tenant_id_scan_status_idx" ON "attachment"("tenant_id", "scan_status");

-- CreateIndex
CREATE INDEX "ticket_task_tenant_id_ticket_id_order_idx" ON "ticket_task"("tenant_id", "ticket_id", "order");

-- CreateIndex
CREATE INDEX "ticket_task_tenant_id_assignee_id_status_idx" ON "ticket_task"("tenant_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "ticket_link_tenant_id_target_id_idx" ON "ticket_link"("tenant_id", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_link_source_id_target_id_link_type_key" ON "ticket_link"("source_id", "target_id", "link_type");

-- CreateIndex
CREATE INDEX "ticket_watcher_tenant_id_user_id_idx" ON "ticket_watcher"("tenant_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_watcher_ticket_id_user_id_key" ON "ticket_watcher"("ticket_id", "user_id");

-- CreateIndex
CREATE INDEX "saved_view_tenant_id_owner_id_idx" ON "saved_view"("tenant_id", "owner_id");

-- CreateIndex
CREATE INDEX "category_tenant_id_path_idx" ON "category"("tenant_id", "path");

-- CreateIndex
CREATE UNIQUE INDEX "category_tenant_id_key_key" ON "category"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "field_definition_tenant_id_key_key" ON "field_definition"("tenant_id", "key");

-- AddForeignKey
ALTER TABLE "setting_version" ADD CONSTRAINT "setting_version_setting_id_fkey" FOREIGN KEY ("setting_id") REFERENCES "setting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "team_membership" ADD CONSTRAINT "team_membership_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permission" ADD CONSTRAINT "role_permission_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_assignment" ADD CONSTRAINT "role_assignment_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_user_account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_delivery" ADD CONSTRAINT "webhook_delivery_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "webhook_subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_exception" ADD CONSTRAINT "calendar_exception_calendar_id_fkey" FOREIGN KEY ("calendar_id") REFERENCES "business_calendar"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_target" ADD CONSTRAINT "sla_target_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "sla_policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sla_pause" ADD CONSTRAINT "sla_pause_timer_id_fkey" FOREIGN KEY ("timer_id") REFERENCES "sla_timer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "escalation_rule" ADD CONSTRAINT "escalation_rule_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "sla_policy"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_domain" ADD CONSTRAINT "tenant_domain_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_provisioning_job" ADD CONSTRAINT "tenant_provisioning_job_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_comment" ADD CONSTRAINT "ticket_comment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_event" ADD CONSTRAINT "ticket_event_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_task" ADD CONSTRAINT "ticket_task_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ticket_watcher" ADD CONSTRAINT "ticket_watcher_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

