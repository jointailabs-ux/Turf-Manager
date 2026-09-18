-- ==============================================================================
-- Migration: 20260918000000_phase8_m4_performance_indexes.sql
-- Phase 8 Milestone 4: Production Query & Performance Optimization Indexes
-- All indexes use IF NOT EXISTS to guarantee idempotent and non-blocking application.
-- ==============================================================================

-- 1. Audit Logs: Accelerate venue-scoped audit history pagination
-- Query Pattern: WHERE company_id = $1 AND venue_id = $2 ORDER BY created_at DESC
CREATE INDEX IF NOT EXISTS idx_audit_logs_venue_created
ON public.audit_logs(company_id, venue_id, created_at DESC);

-- 2. Events Outbox: Accelerate FIFO batch fetching for cron notification outbox and retry processing
-- Query Pattern: WHERE status = 'PENDING' OR (status = 'FAILED' AND retry_count < 3) ORDER BY created_at ASC
CREATE INDEX IF NOT EXISTS idx_events_outbox_status_retry_created
ON public.events_outbox(status, retry_count, created_at ASC);

-- 3. Notification Deliveries: Accelerate delivery queue dispatch for PENDING and FAILED statuses
-- Query Pattern: WHERE status IN ('PENDING', 'FAILED') ORDER BY created_at ASC
CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_created
ON public.notification_deliveries(status, created_at ASC);

-- 4. Payments: Accelerate staff pending payment approval queue
-- Query Pattern: WHERE status = 'PENDING_VERIFICATION' ORDER BY submitted_at ASC
CREATE INDEX IF NOT EXISTS idx_payments_status_submitted
ON public.payments(status, submitted_at ASC);

-- 5. Blocked Periods: Accelerate customer availability slot generation and overlap checks
-- Query Pattern: WHERE field_id = $1 AND starts_at <= $2 AND ends_at >= $3
CREATE INDEX IF NOT EXISTS idx_blocked_periods_field_dates
ON public.blocked_periods(field_id, starts_at, ends_at);

-- 6. Bookings: Accelerate default staff booking list ordering when status filter is omitted
-- Query Pattern: WHERE venue_id = $1 ORDER BY start_at DESC
CREATE INDEX IF NOT EXISTS idx_bookings_venue_start_at
ON public.bookings(venue_id, start_at DESC);
