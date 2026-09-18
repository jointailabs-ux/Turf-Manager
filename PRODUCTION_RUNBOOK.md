# Turf 2 / TurfBook Pro — Production Operations Runbook

This runbook establishes standard operating procedures (SOPs) for the Turf 2 multi-tenant sports turf booking platform.

All operational procedures explicitly distinguish between:
- **[AUTOMATED]**: Managed by continuous deployment, automated workflows, or database triggers.
- **[MANUAL]**: Actions performed directly by devops/engineers via CLI or admin consoles.
- **[REQUIRES PROVIDER ACTION]**: Dependencies requiring action on external provider dashboards (Supabase Cloud, Vercel, DNS).

---

## 1. Production Deployment Procedure

### Pre-Deployment Verification [AUTOMATED]
Before promoting code to production, all quality gates must pass locally or in CI:
```bash
cd web
npm test               # 16 test files (104/104 tests pass)
npx playwright test --workers=1 # 5/5 E2E browser tests pass
npm run typecheck      # Exit code 0
npm run lint           # Exit code 0
npm run build          # Exit code 0
```

### Application Deployment [AUTOMATED / MANUAL]
- **Hosting Platform:** Vercel / Node.js container runtime.
- **Trigger:** Git push to `main` or promotion of a release tag.
- **Build Command:** `next build` (Next.js 16 with Turbopack).
- **Output Directory:** `.next`.
- **Node Version:** Node.js 22 LTS recommended (Node.js 20 emits deprecation notice in Supabase SDK).

---

## 2. Environment Variables & Secret Rotation

### Variable Reference Matrix
| Variable Name | Exposure | Required By | Where Configured | Rotation Frequency |
|---|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Public (Client + Server) | Supabase client init | Vercel / App Hosting | Only on project migration |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public (Client + Server) | Client RLS queries | Vercel / App Hosting | Every 180 days / Incident |
| `SUPABASE_SERVICE_ROLE_KEY` | **SECRET (Server Only)** | Backend RPCs, Storage, Admin | Vercel Server Env | Every 90 days / Incident |
| `CRON_SECRET` | **SECRET (Server Only)** | `/api/cron/notifications` | Vercel + Cron Provider | Every 90 days / Incident |

### Secret Rotation Procedure [MANUAL / REQUIRES PROVIDER ACTION]
1. **Supabase Service Role Key:**
   - In Supabase Cloud Dashboard -> Project Settings -> API -> Generate New Service Role Key.
   - Update `SUPABASE_SERVICE_ROLE_KEY` in Vercel environment variables.
   - Redeploy the application.
   - Revoke old key after deployment succeeds.
2. **Cron Secret:**
   - Generate high-entropy 64-character hex string: `openssl rand -hex 32`.
   - Update `CRON_SECRET` in both Vercel environment variables and the external scheduler (e.g., GitHub Actions, AWS EventBridge, Vercel Cron).
   - Redeploy the application.

---

## 3. Database Migration & Rollback Procedure

### Migration Order & Determinism [AUTOMATED / MANUAL]
Migrations are stored in `web/supabase/migrations/` and ordered chronologically by timestamp prefix:
1. `20260904204901_init_auth_profiles.sql`
2. `20260905041514_tenant_hierarchy.sql`
3. `20260905093350_booking_engine.sql`
4. `20260905215152_venue_management_and_storage.sql` (0-byte empty migration stub; MUST NOT BE DELETED)
5. `20260905224814_phase5_storage_and_assets.sql`
6. `20260906060000_phase6_operations.sql`
7. `20260907000000_phase7_notifications_reports.sql`
8. `20260907020000_phase8_audit_append_only.sql`
9. `20260918000000_phase8_m4_performance_indexes.sql`

### Applying New Migrations [MANUAL]
1. Test migration against isolated test/staging Supabase instance.
2. Apply migration to production instance using Supabase CLI or connection pooler:
   ```bash
   supabase db push
   # Or via pooler:
   node scripts/apply-migrations.mjs
   ```
3. Verify that new indexes or constraints report `valid` in `pg_indexes` / `pg_constraint`.

### Migration Rollback SOP [MANUAL]
- **Additive Index Rollback:** Run `DROP INDEX CONCURRENTLY IF EXISTS <index_name>;`.
- **Schema Rollback:** Because Turf 2 uses strictly additive, non-breaking schema expansions, do not run destructive drop statements without an offline maintenance window. Use compensating migrations (`CREATE OR REPLACE FUNCTION ...`) to revert RPC logic.

---

## 4. Scheduled Jobs & Notification Operations

### Cron Endpoint Configuration [MANUAL / REQUIRES PROVIDER ACTION]
- **Target Endpoint:** `POST https://app.turfbookpro.com/api/cron/notifications`
- **Schedule:** Every 1 to 2 minutes (`*/1 * * * *`).
- **Required Header:** `Authorization: Bearer <CRON_SECRET>`
- **Execution Workflow [AUTOMATED]:**
  1. Validates bearer token against `process.env.CRON_SECRET`.
  2. Drains `events_outbox` where `status = 'PENDING'` or retryable `FAILED` (`retry_count < 3`) ordered by `created_at ASC`.
  3. Stages delivery records into `notification_deliveries` with event-specific idempotency keys (`notify_${event.id}_wa`).
  4. Dispatches / simulates delivery and marks `SIMULATED` or `DELIVERED`.
- **Failure Handling [AUTOMATED]:**
  - Errors during event processing increment `retry_count`.
  - At `retry_count >= 3`, events become permanently `FAILED` to prevent queue head-of-line blocking.

### Failed Notification Recovery [MANUAL]
To re-trigger permanently exhausted outbox events:
```sql
UPDATE public.events_outbox
SET status = 'PENDING', retry_count = 0, error_message = NULL
WHERE id = '<EVENT_ID>' AND status = 'FAILED';
```

---

## 5. Observability & Incident Response

### Error Tracking [AUTOMATED]
- Centralized via `web/src/lib/observability.ts`.
- Automatically redacts passwords, auth tokens, session cookies, and payment references (UTRs).
- Structured JSON output with ISO timestamps, module, action, and context.

### Investigating Booking Concurrency Issues [MANUAL]
1. Query active reservations for the contested field:
   ```sql
   SELECT * FROM public.active_slot_reservations
   WHERE field_id = '<FIELD_ID>' AND slot_start >= now()
   ORDER BY slot_start ASC;
   ```
2. Check booking audit trail:
   ```sql
   SELECT * FROM public.audit_logs
   WHERE entity_type = 'booking' AND entity_id = '<BOOKING_ID>'
   ORDER BY created_at DESC;
   ```
3. Check `bookings` state:
   ```sql
   SELECT id, status, expires_at, created_at FROM public.bookings
   WHERE id = '<BOOKING_ID>';
   ```

### Investigating Payment Verification Discrepancies [MANUAL]
1. Query payment status and audit history:
   ```sql
   SELECT p.id, p.status, p.amount_minor, p.transaction_reference, p.submitted_at, p.verified_at,
          b.status AS booking_status, b.advance_required_minor
   FROM public.payments p
   JOIN public.bookings b ON b.id = p.booking_id
   WHERE p.id = '<PAYMENT_ID>';
   ```
2. UTR Uniqueness Conflict:
   - If customer receives duplicate UTR error, verify if reference was already recorded:
     ```sql
     SELECT * FROM public.payments WHERE transaction_reference = '<UTR_CODE>';
     ```

---

## 6. Backup & Disaster Recovery Readiness

### Database Backups [REQUIRES PROVIDER ACTION]
- **Supabase Cloud Managed Backups:**
  - Automated daily backups enabled by default on all Supabase projects.
  - Retention: 7 days on Pro tier, 30 days on Enterprise tier.
  - **Point-In-Time Recovery (PITR):** Enables recovery to any second within the retention window. PITR is recommended for production release.

### Storage Backups [REQUIRES PROVIDER ACTION]
- Private buckets (`payment_proofs`, `venue_assets`) are backed by AWS S3 multi-region storage.
- File deletion in Supabase Storage requires service role or explicit storage RLS policy.

### Disaster Recovery Scenarios [MANUAL / REQUIRES PROVIDER ACTION]
1. **Accidental Data Corruption / Deletion:**
   - Identify precise UTC timestamp before corruption.
   - On Supabase Dashboard -> Backups -> Restore to Point in Time (PITR).
   - PITR provisions a point-in-time clone without overwriting the broken database, enabling selective table restoration or DNS repointing.
2. **Total Instance Failure:**
   - Restore from latest snapshot to a new Supabase project ref.
   - Update `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel.
   - Redeploy Next.js application.

---

## 7. Data Invariants (Must NEVER be Breached)

1. **Paise Integer Arithmetic:** All monetary amounts (`gross_amount_minor`, `advance_required_minor`, `balance_due_minor`, `base_price_minor`) must strictly remain integers representing minor units (paise). Never convert or store as floating-point decimals.
2. **Timezone Boundaries:** Operating hours and availability calculations must evaluate against venue local midnight (`toZonedTime(date, venue.timezone)`).
3. **Atomic Slot Reservation:** Slot locks exist solely within `public.active_slot_reservations` enforced by `UNIQUE (field_id, slot_start)`.
4. **Append-Only Audit Logs:** `audit_logs` are protected by `enforce_audit_append_only()` triggers blocking `UPDATE` and `DELETE` for all standard application roles.
