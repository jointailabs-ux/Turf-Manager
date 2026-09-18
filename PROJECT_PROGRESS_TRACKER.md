# Project Progress Tracker

## Project
- **Project Name:** Turf 2 (Multi-Tenant Sports Turf Booking Engine)
- **Current Target:** V1.0 Production Target
- **Current Phase:** Phase 8 — Gate A: Production Readiness Sign-Off & Provider Certification
- **Overall Status:** Phases 1–8 COMPLETE & FROZEN; Gate A READY WITH EXTERNAL CONFIGURATION REQUIRED

---

## Product Summary
Turf 2 is a multi-tenant venue and sports turf booking platform. It enables companies (tenant owners/staff) to manage multi-sport venues, fields, custom operating hours, dynamic pricing rules, receiving payment accounts (UPI/QR), and granular staff RBAC permissions. Customers can view active venues, select sports/fields, view an advisory availability grid, book 30-minute-aligned time slots (minimum 60 minutes) with strict atomic database concurrency reservations, submit UPI payment proofs/UTRs, and track booking status.

---

## Architecture
- **Frontend:** Next.js 16 (App Router, Turbopack, React 19, TypeScript, Tailwind CSS)
- **Backend:** Next.js Server Actions & Server Components using `@supabase/ssr`
- **Database:** Supabase PostgreSQL with Row Level Security (RLS), custom PL/pgsql transactional RPCs, triggers, and indices
- **Authentication:** Supabase Auth (`auth.users`), mapped 1-to-1 with `public.profiles` and `public.customers`
- **Storage:** Supabase Storage private buckets (`payment_proofs`, `venue_assets`) with 5 MB limits, image MIME filtering, and server-side RBAC/ownership validation before generating signed URLs
- **Hosting / Deployment:** Next.js standard build (`next build`) targeting Vercel / Node server runtime + Supabase Cloud
- **Key Architectural Invariants:**
  - **Atomic Concurrency:** Phase 4 booking engine handles all reservations atomically inside `public.execute_booking_transaction(...)` with 30-minute slot breakdown and a database unique constraint `UNIQUE (field_id, slot_start)` on `active_slot_reservations`.
  - **Service Role RPC Security:** Transactional RPCs (`execute_booking_transaction`, `approve_booking_transaction`, `reject_booking_transaction`, `expire_booking_transaction`) are defined as `SECURITY DEFINER` with `SET search_path = public`, revoked from `PUBLIC`/`authenticated`/`anon`, and executable strictly by `service_role`.
  - **Composite Multi-Tenancy:** Foreign keys and tenant boundary checks strictly bind `(company_id, venue_id)`. Cross-company or cross-venue manipulation is blocked at server action and database levels.
  - **Server-Side Pricing:** Browser input for pricing/advance/balance is strictly ignored. All pricing is calculated server-side from active `pricing_rules`.
  - **Payment Verification:** Customer payment submission initializes payment status to `PENDING_VERIFICATION`. Only authorized staff with `payment.approve` permission can transition payments to `VERIFIED` and bookings to `CONFIRMED`.

---

## Phase Roadmap

| Phase | Name | Status | Notes |
|---|---|---|---|
| 1 | Foundation | COMPLETE / FROZEN | Initial project setup, design system tokens, database schema base |
| 2 | Authentication & Identity | COMPLETE / FROZEN | Supabase Auth, `profiles` & `customers` auto-provisioning triggers |
| 3 | Multi-tenancy & RBAC Foundation | COMPLETE / FROZEN | `companies`, `venues`, `roles`, `permissions`, `user_memberships`, scope RPCs |
| 4 | Booking & Payment Engine | COMPLETE / FROZEN | Atomic RPCs, slot reservation engine, 30-min granularity, idempotency, payment rules |
| 5 | Venue + Customer Booking | COMPLETE / FROZEN | Venue/Field management, private storage buckets, customer checkout & proof upload |
| 6 | Operations + Customers + Staff | COMPLETE / FROZEN | Dashboard, Bookings, Customers, Staff management |
| 7 | Dashboard + Notifications + Audit | COMPLETE / FROZEN | Audit UI, Reporting, Notification service & outbox |
| 8 | V1 Hardening + E2E + Readiness | COMPLETE (M1, M2, M3, M4) / FROZEN | M1 (Security), M2 (E2E Integration), M3 (Hardening Suite), M4 (Readiness + Performance) verified |
| Gate A | Production Readiness & Provider Certification | READY WITH EXTERNAL CONFIGURATION REQUIRED | Pre-flight passed (104 tests, 5 E2E, 0 lint/tsc errors, build pass); migration chain & configuration certified; awaiting provider provisioning |
| Gate B | V1 Release Certification | NOT STARTED | Awaiting explicit approval |

---

## Completed Work

### Phase 1 — Foundation (COMPLETE / FROZEN)
- **Implemented:** Next.js project foundation, environment configuration, database structure base.
- **Freeze Status:** Frozen.

### Phase 2 — Authentication & Identity (COMPLETE / FROZEN)
- **Implemented:** User registration, login flow, `handle_new_user` SQL trigger creating `public.profiles`, profile updates, auth middleware.
- **Database Migration:** `20260904204901_init_auth_profiles.sql`
- **Freeze Status:** Frozen.

### Phase 3 — Multi-tenancy & RBAC Foundation (COMPLETE / FROZEN)
- **Implemented:** Hierarchical tenant system (`companies` → `venues`), permission matrix (`settings.manage`, `field.manage`, `pricing.manage`, `payment.view`, `payment.approve`), staff memberships, `get_auth_user_scopes()` RPC.
- **Database Migration:** `20260905041514_tenant_hierarchy.sql`
- **Freeze Status:** Frozen.

### Phase 4 — Booking & Payment Engine (COMPLETE / FROZEN)
- **Implemented:** 30-minute slot reservation engine, operating hours & timezone enforcement, blocked period validation, composite tenant foreign keys, payment state machine (`PENDING_VERIFICATION` → `VERIFIED`/`REJECTED`), atomic transaction RPCs (`execute_booking_transaction`, `approve_booking_transaction`, `reject_booking_transaction`, `expire_booking_transaction`), duplicate UTR protection.
- **Database Migration:** `20260905093350_booking_engine.sql`
- **Security & Business Rules:**
  - `execute_booking_transaction` checks active flags, operating hours, blocked periods, duration (min 60m, 30m steps), calculates advance required, inserts `bookings`, `booking_slots`, and `active_slot_reservations`.
  - Payment submission rule: `amount_minor >= advance_required_minor`.
  - Transaction reference uniqueness: `UNIQUE (payment_account_id, transaction_reference)`.
- **Tests & Verification:** Concurrency test suite (`src/tests/booking.concurrency.test.ts`) passing 6/6 tests.
- **Freeze Status:** Frozen.

### Phase 5 — Venue + Customer Booking Experience (COMPLETE / FROZEN)
- **Implemented:**
  - Admin UI & Actions: Venue settings, sports & fields management, payment accounts management (`updateVenueSettingsAction`, `upsertFieldAction`, `setOperatingHoursAction`, `upsertPaymentAccountAction`).
  - Storage Infrastructure: Private buckets `payment_proofs` and `venue_assets` with 5 MB file size limit, image MIME filtering (`image/jpeg`, `image/png`, `image/webp`), and storage RLS policies.
  - Storage Service: Server-side ownership/RBAC validation before generating signed upload or view URLs (`StorageService`).
  - Customer Experience: Canonical route paths `/book/[venueSlug]`, `/book/[venueSlug]/[fieldId]`, `/checkout/[bookingId]`, customer booking actions, checkout form with payment account QR display, UTR submission, screenshot proof upload, customer booking history page (`/account/bookings/[bookingId]`).
- **Database Migration:** `20260905224814_phase5_storage_and_assets.sql`
- **Corrective Pass Fixes:** Resolved Next.js 15 async route `params` contract across `src/app` and updated `ClientCheckoutForm` prop typing for optional `qrUrl: string | null`.
- **Freeze Status:** Frozen.

### Phase 6 — Operations + Customers + Staff (COMPLETE / FROZEN)
- **Implemented:** Dashboard, Bookings, Customers, Staff management. `audit_logs` table creation, and RPCs for cancelling/completing bookings and recording balance payments.
- **Database Migration:** `20260906060000_phase6_operations.sql`
- **Freeze Status:** Frozen.

### Phase 7 — Dashboard + Notifications + Audit (COMPLETE / FROZEN)
- **Implemented:**
  - **Notifications:** Database-backed `events_outbox` and `notification_deliveries` tables with row-level security and `idempotency_key` constraints. `NotificationService` handles decoupled async dispatch with a secure server-action cron endpoint (`/api/cron/notifications`). Simulated deliveries are securely mocked.
  - **Audit UI:** Built the paginated Audit UI for staff viewing historical business transactions.
  - **Reporting:** Created Bookings, Financial, and Utilisation reports using server-side aggregations for gross value, verified advance collections, and remaining balances.
  - **Permissions:** Added `audit.view` and `report.view` permissions dynamically mapped to admin and manager roles.
- **Database Migration:** `20260907000000_phase7_notifications_reports.sql`
- **Tests & Verification:** 
  - `npm run typecheck` (PASS 0)
  - `npm run lint` (PASS 0)
  - `npm run build` (PASS 0)
  - `npm test` (PASS 68, SKIPPED 6) - RLS tests skipped due to unavailable live DB.
  - **Known Limitations:** Deliveries use a MOCK provider since external SMS/WhatsApp is not yet wired up. Node 20 deprecation warning emitted by Supabase during tests.
### Phase 8 — Hardening, E2E & Production Verification
- **Milestone 1 (Security Hardening):** Append-only audit log triggers (`prevent_audit_log_tampering`), RLS policies verified on live Supabase test instance.
- **Milestone 2 (E2E Integration):** Concurrency conflict tests, customer booking journey, payment submission with proof upload, and storage security cross-tenant protection verified.
- **Milestone 3 (Hardening & End-to-End Suite — COMPLETE / VERIFIED):**
  - **Staff Approval Regression RESOLVED:** Diagnosed root causes (TypeScript permission code array-union check and profile resolution via service role in `hasPermission`). Verified atomic transition of booking to `CONFIRMED` and payment to `VERIFIED` in both DB and UI via Playwright (`tests/e2e/staff-approval.spec.ts`).
  - **Notification Outbox & Deliveries:** Validated event-specific idempotency (`notify_${event.id}_wa`), duplicate processing prevention, distinct deliveries for identical payloads across events, retry increment and exhaustion (max 3), `BOOKING_CANCELLED` processing, `SIMULATED` status semantics, and authenticated `/api/cron/notifications` with `CRON_SECRET` (all 8 tests passing in `src/tests/notifications.m3.test.ts`).
  - **Audit Route & RBAC:** Verified `/admin/[companyId]/venues/[venueId]/audit` route, `audit.view` permission checks for Admin/Manager/Sub-manager/Customer, strict tenant isolation, pagination and filtering by `eventType` and `entityType`, and append-only database triggers blocking UPDATE and DELETE (all 6 tests passing in `src/tests/audit.m3.test.ts`).
  - **Reporting & Financial Accuracy:** Confirmed integer minor unit (paise) math for `gross_amount_minor`, `advance_required_minor`, and `balance_due_minor`. Verified exclusions for cancelled/expired bookings, utilisation aggregations, deterministic timezone day boundaries (`getVenueDayBounds`), tenant boundary scoping, and `report.view` RBAC (all 6 tests passing in `src/tests/reporting.m3.test.ts`).
- **Milestone 4 (Production Readiness & Performance — COMPLETE / VERIFIED):**
  - **Environment Hardening:** Audited and segregated public (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`) and secret variables (`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`). Documented in `.env.example`. Enforced server-side runtime validation via `src/env.ts` with fail-fast import in `app/layout.tsx`.
  - **Database Index Optimization:** Added and applied migration `20260918000000_phase8_m4_performance_indexes.sql` creating 6 targeted non-blocking composite indexes:
    - `idx_audit_logs_venue_created (company_id, venue_id, created_at DESC)`
    - `idx_events_outbox_status_retry_created (status, retry_count, created_at ASC)`
    - `idx_notification_deliveries_status_created (status, created_at ASC)`
    - `idx_payments_status_submitted (status, submitted_at ASC)`
    - `idx_blocked_periods_field_dates (field_id, starts_at, ends_at)`
    - `idx_bookings_venue_start_at (venue_id, start_at DESC)`
  - **Security Headers:** Configured production HTTP response headers in `next.config.ts` (HSTS, X-Content-Type-Options: nosniff, X-Frame-Options: SAMEORIGIN, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy).
  - **Observability:** Created `src/lib/observability.ts` with automated redaction of sensitive tokens, passwords, UTRs, and signed URLs. Tested via `src/tests/observability.test.ts` (2 tests passing). Integrated into `/api/cron/notifications`.
  - **Performance Benchmarks:** Created `src/tests/performance.m4.test.ts` verifying concurrent slot contention (exactly 1 succeeds, 4 reject with conflict), availability grid latency (<400ms), report latency (<350ms), and outbox dispatch (<2000ms). All 4 tests passing.
  - **Production Operations Runbook:** Created `PRODUCTION_RUNBOOK.md` establishing clear SOPs distinguishing AUTOMATED, MANUAL, and REQUIRES PROVIDER ACTION.
- **Tests & Verification:**
  - `npm test`: **104 passed (16 test files), 0 failed, 0 skipped**
  - `npx playwright test --workers=1`: **5 passed (5 spec files), 0 failed, 0 skipped**
  - `npm run typecheck`: **0 errors (Exit code 0)**
  - `npm run lint`: **0 errors (Exit code 0)**
  - `npm run build`: **0 errors, all 26 routes compiled cleanly with Turbopack (Exit code 0)**
- **Freeze Status:** Phase 8 Milestones 1, 2, 3, and 4 Complete, Verified, and Frozen.

---

## Current State
- **Working:**
  - Multi-tenant staff management, venue settings, field creation, payment account configuration.
  - Advisory customer availability grid calculation with timezone awareness.
  - Customer booking creation, atomic slot reservation, idempotency, checkout flow, QR signed asset generation, payment submission, and payment proof upload signed URLs.
  - Staff payment approval & rejection RPC wrappers with permission validation.
  - Event outbox processing with event-specific idempotency, simulated delivery status, and retry exhaustion.
  - Paginated audit log retrieval with tenant isolation and append-only trigger protection.
  - Authoritative financial, booking, and utilisation reports calculated strictly in integer paise with venue timezone midnight boundaries.
  - Production HTTP security headers, fail-fast env validation, sensitive data scrubbing, and database performance indexes.
- **Frozen:** Phases 1 through 8 (all Milestones 1, 2, 3, 4).
- **Incomplete / Pending:** Gate A (Production Readiness Sign-off / Live Webhook & Provider Certification).
- **Currently Being Worked On:** None (Milestone 4 finalized).
- **Must NOT Be Changed:**
  - Database schema & composite tenant keys.
  - Phase 4 transactional SQL RPCs (`execute_booking_transaction`, `approve_booking_transaction`, `reject_booking_transaction`, `expire_booking_transaction`).
  - 30-minute slot alignment and minimum 60-minute duration rule.
  - Payment requirement rule (`v_payment.amount_minor >= v_booking.advance_required_minor`).
  - Payment account UTR uniqueness constraint (`UNIQUE (payment_account_id, transaction_reference)`).
- **Verified in Phase 8 (Milestones 1–4):**
  - Live Supabase instance execution of `src/tests/rls.integration.test.ts` (6 tests verified passing against live DB).
  - Playwright full browser E2E customer booking journey, payment submission, concurrency conflict, storage security, and staff approval (5 spec files passing).
  - Milestone 3 hardening suites: `notifications.m3.test.ts` (8 tests), `reporting.m3.test.ts` (6 tests), `audit.m3.test.ts` (6 tests).
  - Milestone 4 hardening suites: `observability.test.ts` (2 tests), `performance.m4.test.ts` (4 tests).
- **Remains to be Verified in Later Gates:**
  - Gate A: Live external SMS/WhatsApp webhook integration with production providers (Twilio/Gupshup) and release certification.

---

## Critical Business Rules

1. **Slot Granularity:** All booking slots are exactly 30 minutes, aligned to clock hour/half-hour (e.g., 10:00, 10:30).
2. **Minimum Duration:** Minimum online booking duration is 60 minutes (2 contiguous 30-minute slots).
3. **Atomic Reservation:** Slot reservation occurs atomically inside PostgreSQL via `execute_booking_transaction`. Double-booking is strictly prevented by DB constraint `UNIQUE (field_id, slot_start)` on `active_slot_reservations`.
4. **Server Pricing:** All pricing (gross amount, advance required, balance due) is calculated strictly on the server from `pricing_rules`. Client pricing input is ignored.
5. **Payment State Machine:** Customer payment starts as `PENDING_VERIFICATION`. Staff with `payment.approve` transitions payment to `VERIFIED` and booking to `CONFIRMED` atomically via `approve_booking_transaction`.
6. **Booking Expiry:** Bookings in `PAYMENT_PENDING` expire after `expires_at`. Expired bookings cannot receive payments and can be unlocked via `expire_booking_transaction`.
7. **UTR Uniqueness:** Scoped per receiving account via `UNIQUE (payment_account_id, transaction_reference)`. Duplicate references under the same account are rejected with PostgreSQL error `23505`.
8. **Multi-Tenant Isolation:** All admin operations and data access must independently validate user authentication, active membership, company scope, venue scope, and required permission code.
9. **Storage Security:** Payment proof bucket (`payment_proofs`) and QR asset bucket (`venue_assets`) are private. Access requires server-side generated signed URLs after verifying customer ownership or staff `payment.view` / `settings.manage` permissions. Max file size: 5 MB; allowed MIME types: `image/jpeg, image/png, image/webp`.

---

## Database / Migration History

1. **`20260904204901_init_auth_profiles.sql`**
   - Tables: `public.profiles`
   - Functions & Triggers: `public.handle_new_user()` trigger on `auth.users`

2. **`20260905041514_tenant_hierarchy.sql`**
   - Tables: `public.companies`, `public.venues`, `public.roles`, `public.permissions`, `public.role_permissions`, `public.user_memberships`
   - Functions: `public.get_auth_user_scopes()` — returns `TABLE (company_id UUID, venue_id UUID)`
   - Composite FK constraint: `venues_company_id_id_key UNIQUE (company_id, id)` on `venues`; `memberships_venue_fkey` FK on `user_memberships` referencing `venues(company_id, id)`
   - Security: `REVOKE EXECUTE ON FUNCTION get_auth_user_scopes() FROM PUBLIC`; granted to `authenticated` and `service_role` only

3. **`20260905093350_booking_engine.sql`**
   - Tables: `public.customers`, `public.sports`, `public.venue_sports`, `public.fields`, `public.pricing_rules`, `public.operating_hours`, `public.blocked_periods`, `public.payment_accounts`, `public.bookings`, `public.booking_slots`, `public.active_slot_reservations`, `public.payments`, `public.idempotency_keys`
   - RPC Functions: `execute_booking_transaction`, `approve_booking_transaction`, `reject_booking_transaction`, `expire_booking_transaction`
   - Key Constraints: `UNIQUE (field_id, slot_start)` on `active_slot_reservations`; `UNIQUE (payment_account_id, transaction_reference)` on `payments`

4. **`20260905215152_venue_management_and_storage.sql`** — **EMPTY STUB / NEVER APPLIED**
   - Contents: 0 bytes (single blank line only — confirmed by direct file read)
   - Git status: **Untracked** — never committed, never in git history
   - Status: Abandoned intermediate migration. Was created with `supabase migration new` but superseded before any SQL was written into it. All Phase 5 venue management and storage work was delivered in the migration immediately following this file (see #5 below).
   - Deployment risk: None (0-byte file is a no-op if run). **Do not delete** — removing an empty-but-named migration file could cause Supabase `schema_migrations` checksum mismatches if a live DB is ever initialized locally.

5. **`20260905224814_phase5_storage_and_assets.sql`**
   - Column Added: `payments.proof_object_path TEXT NULL`
   - Storage Buckets: `payment_proofs` (private, 5 MB, image MIME only), `venue_assets` (private, 5 MB, image MIME only) — inserted via `storage.buckets`
   - Storage RLS Policies on `storage.objects`:
     - `Customers can upload their own payment proofs` (INSERT, authenticated) — validates via `payments → bookings → customers → profiles` join
     - `Customers can view their own payment proofs` (SELECT, authenticated) — same join validation
     - `Staff can view payment proofs for their venues` (SELECT, authenticated) — validates `user_memberships` with `payment.view` / `payment.approve` or admin/manager role
     - `Staff can manage venue assets` (ALL, authenticated) — validates `user_memberships` with `settings.manage` or admin/manager role

6. **`20260906060000_phase6_operations.sql`**
   - Tables: `public.audit_logs`
   - Columns: `recorded_by` added to `payments`
   - RPCs: `cancel_booking_transaction`, `complete_booking_transaction`, `record_balance_payment_transaction`

7. **`20260907000000_phase7_notifications_reports.sql`**
   - Tables: `public.events_outbox`, `public.notification_deliveries`
   - Permissions: `audit.view`, `report.view` inserted and granted to admin and manager roles
   - RLS Policies: Tenant scoping on outbox and delivery tables

8. **`20260907020000_phase8_audit_append_only.sql`**
   - Triggers & Functions: `prevent_audit_log_tampering()` statement trigger on `public.audit_logs`
   - Security: Enforces append-only invariant on `audit_logs` — blocks `UPDATE` and `DELETE` for application roles while preserving service-role privileges

---

## Important Files

- `web/src/modules/booking/service.ts`: Core `BookingService` class — wraps DB RPCs (`createBooking`, `submitPayment`, `approveBooking`, `rejectBooking`, `expireBooking`). 378 lines. Authoritative orchestrator for all booking transactions.
- `web/src/modules/booking/customer.actions.ts`: Server Actions for customer online booking creation (`submitOnlineBookingAction`), payment submission (`submitPaymentAction`), and proof upload URL generation (`createPaymentProofUploadUrlAction`).
- `web/src/modules/booking/ui.service.ts`: `BookingUIService` class — customer UI data resolution (`getVenueAndField`, `getAvailabilityGrid`). Handles timezone-aware slot generation and availability overlay.
- `web/src/modules/storage/service.ts`: `StorageService` class — manages signed URLs for private `payment_proofs` and `venue_assets` buckets with strict server-side authorization checks before generating any URL.
- `web/src/modules/membership/service.ts`: `MembershipService` class — RBAC permission checks (`getMyMemberships`, `hasAccess`, `hasPermission`). Central gate for all admin operations.
- `web/src/modules/venue/admin.service.ts`: `AdminVenueService` class — staff-facing venue management operations: `updateVenueSettings`, `upsertField`, `setOperatingHours`, `upsertBlockedPeriod`, `upsertPaymentAccount`. All methods enforce `MembershipService.hasPermission` before mutating data.
- `web/src/modules/tenant/service.ts`: `TenantService` class — resolves authenticated user's assigned companies (`getAssignedCompanies`) and venues (`getAssignedVenues`) via Supabase RLS.
- `web/src/modules/auth/service.ts`: `AuthService` class — `getUser`, `requireUser`, `getProfile`. Primary authentication boundary; `requireUser` throws on unauthenticated access.
- `web/supabase/migrations/20260905093350_booking_engine.sql`: Authoritative PL/pgsql transaction RPC definitions and core booking/payment schema. **Frozen — do not modify.**
- `web/supabase/migrations/20260905224814_phase5_storage_and_assets.sql`: Storage bucket definitions, `proof_object_path` column, and all `storage.objects` RLS policies. **Frozen — do not modify.**
- `web/src/app/checkout/[bookingId]/page.tsx`: Customer checkout page (server component).
- `web/src/app/checkout/[bookingId]/ClientCheckoutForm.tsx`: Checkout form — UPI selection, UTR submission, proof upload. Accepts `qrUrl: string | null`.
- `web/src/app/book/[venueSlug]/[fieldId]/page.tsx`: Field availability grid and booking submission page.
- `web/src/modules/notification/service.ts`: `NotificationService` class — decoupled async outbox orchestrator.
- `web/src/modules/audit/service.ts`: `AuditService` class — paginated queries for append-only audit logs.
- `web/src/modules/report/service.ts`: `ReportService` class — server-side aggregations for financial and utilisation reporting.
- `web/src/app/api/cron/notifications/route.ts`: Protected endpoint to securely process outbox and dispatch notifications.

---

## API / Service / RPC Inventory

### Database RPC Functions (Service Role Only — SECURITY DEFINER)
- `public.execute_booking_transaction(p_booking JSONB, p_customer JSONB, p_slots JSONB, p_idempotency JSONB)` → `UUID`
- `public.approve_booking_transaction(p_booking_id UUID, p_payment_id UUID, p_verified_by UUID)` → `BOOLEAN`
- `public.reject_booking_transaction(p_booking_id UUID, p_payment_id UUID, p_verified_by UUID, p_reason TEXT)` → `BOOLEAN`
- `public.expire_booking_transaction(p_booking_id UUID)` → `BOOLEAN`
- `public.get_auth_user_scopes()` → `TABLE (company_id UUID, venue_id UUID)` *(grants: authenticated, service_role only)*

### Customer Server Actions (`web/src/modules/booking/customer.actions.ts`)
- `submitOnlineBookingAction(venueId, fieldId, startAt, endAt, durationMinutes)`: Authenticates customer, resolves/creates customer identity, triggers `BookingService.createBooking`.
- `submitPaymentAction(bookingId, paymentAccountId, transactionReference, amountMinor)`: Submits payment record with UTR reference for a `PAYMENT_PENDING` booking.
- `createPaymentProofUploadUrlAction(paymentId, mimeType)`: Validates booking ownership, generates signed upload URL for proof image via `StorageService`.

### Staff / Admin Server Actions (`web/src/modules/venue/admin.actions.ts`)
- `updateVenueSettingsAction(companyId, venueId, data)`: Updates venue properties (timezone, address, advance configuration). Requires `settings.manage`.
- `upsertFieldAction(companyId, venueId, fieldId | null, data)`: Creates or updates a field and its base price. Requires `field.manage`.
- `setOperatingHoursAction(companyId, venueId, fieldId | null, hours[])`: Replaces operating hour rows for a venue/field combination. Requires `field.manage`.
- `upsertPaymentAccountAction(companyId, venueId | null, accountId | null, data)`: Creates or updates a payment account (UPI ID / QR). Requires `settings.manage`.

### AdminVenueService Methods (no server action wrapper yet)
- `AdminVenueService.upsertBlockedPeriod(companyId, venueId, fieldId | null, blockId | null, data)`: Creates or updates a blocked period for a field or venue. Requires `field.manage`. **Note: server action wrapper not yet implemented — Phase 6 scope.**

### BookingService Methods (`web/src/modules/booking/service.ts`)
- `BookingService.createBooking(request)`: Full orchestrator — validates, calls `execute_booking_transaction` RPC.
- `BookingService.submitPayment(bookingId, paymentAccountId, method, amountMinor, transactionReference)`: Inserts payment row.
- `BookingService.approveBooking(bookingId, paymentId)`: Checks `payment.approve` permission, calls `approve_booking_transaction`.
- `BookingService.rejectBooking(bookingId, paymentId, reason)`: Checks `payment.approve` permission, calls `reject_booking_transaction`.
- `BookingService.expireBooking(bookingId)`: Calls `expire_booking_transaction`.

### StorageService Methods (`web/src/modules/storage/service.ts`)
- `StorageService.createPaymentProofUploadUrl(paymentId, mimeType)`: Validates customer ownership, generates signed upload URL for `payment_proofs` bucket.
- `StorageService.getPaymentProofSignedUrl(paymentId)`: Validates customer ownership or staff `payment.view`, generates signed view URL.
- `StorageService.createVenueAssetUploadUrl(companyId, venueId, paymentAccountId, mimeType)`: Validates `settings.manage`, generates signed upload URL for `venue_assets` bucket.
- `StorageService.getVenueAssetSignedUrl(paymentAccountId)`: Validates account is active, generates signed view URL (1-hour expiry).

### Reporting, Audit & Notification Services
- `ReportService.getBookingReport`, `getFinancialReport`, `getUtilisationReport`: Execute server-side SQL aggregations across `bookings`.
- `AuditService.getAuditLogs`: Fetches paginated logs from `audit_logs`.
- `NotificationService.enqueueEvent`, `processOutboxEvents`, `processDeliveries`: Interacts with `events_outbox` and `notification_deliveries` tables for robust queue-like delivery.

---

## Testing & Verification Results

*Date of Last Verification Run: 2026-09-18 (Phase 8 Milestone 4)*

| Quality Gate | Status | Command Executed | Detailed Results |
|---|---|---|---|
| **TypeScript Typecheck** | **PASSED** | `npm run typecheck` | Exit code 0. Clean pass across all 26 routes, components, server actions, and tests. |
| **ESLint Linting** | **PASSED** | `npm run lint` | Exit code 0. 0 errors, 4 non-blocking pre-existing warnings. |
| **Unit & Integration Tests** | **PASSED** | `npm test` | Exit code 0. 16 test files passed (104/104 tests passed, 0 skipped, 0 failed). Includes live DB tests for RLS, audit append-only, notifications outbox/delivery M3, reporting financial/timezone M3, audit RBAC M3, observability data scrubbing, and M4 performance/concurrency benchmarks. |
| **Browser E2E Tests** | **PASSED** | `npx playwright test --workers=1` | Exit code 0. 5 spec files passed (5/5 tests passed). Covers customer journey, payment submission, concurrency conflict, storage security, and staff approval. |
| **Production Build** | **PASSED** | `npm run build` | Exit code 0. Next.js 16 (Turbopack) production build completed cleanly in 6.9s with all 26 routes compiled and security headers active. |

---

## Known Issues / Technical Debt

*No critical open defects in Phase 1–8 scope.*

- **Advisory Warning:** `@supabase/supabase-js` emits a Node.js 20 deprecation warning during test runs. Recommend upgrading Node environment to v22+ prior to production release.
- **Middleware Deprecation:** Next.js 16 emits an advisory notice recommending migration from `middleware.ts` to `proxy.ts`.

---

## Pending Work Before Gate A

Phase 8 Milestones 1, 2, 3, and 4 are fully complete, verified, and frozen.
Next step: Await explicit authorization from project owner before beginning Gate A (Production Readiness Sign-off / Live Webhook & Release Certification).

---

## Invariants & Guardrails

1. **Do not modify Phase 4 RPCs:** `execute_booking_transaction`, `approve_booking_transaction`, `reject_booking_transaction`, and `expire_booking_transaction` are frozen.
2. **Do not alter payment amount rules:** Payment requirement rule remains `payment.amount_minor >= booking.advance_required_minor`.
3. **Do not bypass atomic slot reservation:** All booking creations must pass through `execute_booking_transaction`.
4. **Do not introduce alternate reservation engines:** All slot locks must go through `active_slot_reservations` with `UNIQUE (field_id, slot_start)`.
5. **Do not weaken tenant isolation / RLS:** Every staff action and admin query must enforce scope checking (`company_id`, `venue_id`, `permission`).
6. **Do not start next phase automatically:** Wait for explicit approval and plan review before beginning Gate A.
7. **Do not delete the empty migration stub:** `20260905215152_venue_management_and_storage.sql` is 0 bytes and untracked, but must not be deleted to avoid future Supabase `schema_migrations` checksum mismatches.

---

## Change Log

### 2026-09-18 — Phase 8 Gate A: Production Deployment Preparation & Provider Certification
- **Authorization & Decisions Confirmed:** Production hosting: Vercel; Runtime: Node.js 22.x LTS; Database: Supabase project `blticunftrrodvxaqnbd.supabase.co` (all 9 migrations and private storage verified); Core business logic remains strictly FROZEN; Gate B not started.
- **Production Pre-Flight Verification:**
  - `npm test`: 16/16 test files passed (104/104 tests passed, 0 skipped, 0 failed in 14.05s).
  - `npm run test:e2e -- --workers=1`: 5/5 Playwright E2E spec files passed in 2.1m against Next.js local server.
  - `npm run typecheck`: PASS (Exit 0, 0 errors).
  - `npm run lint`: PASS (Exit 0, 0 errors, 4 non-blocking warnings).
  - `npm run build`: PASS (Exit 0, Turbopack compiled 26 routes in 6.2s, TypeScript passed in 8.3s, static generation passed in 3.1s).
- **Deployment Configuration:** Configured `"engines": { "node": "22.x" }` in `web/package.json` for Vercel Node 22 LTS runtime alignment.
- **Supabase Production Provisioning Preparation:** Full 9-migration deterministic chain (`20260904204901_init_auth_profiles.sql` through `20260918000000_phase8_m4_performance_indexes.sql` including preserved 0-byte stub `20260905215152_venue_management_and_storage.sql`) certified and consolidated in `web/supabase/combined_migrations.sql`.
- **Scheduled Cron Certification:** Verified `/api/cron/notifications` security and execution via `src/tests/notifications.m3.test.ts` (unauthorized -> 401; authorized with `CRON_SECRET` -> 200, SIMULATED status preserved, retries preserved, idempotency preserved).
- **Gate A Status:** READY WITH EXTERNAL CONFIGURATION REQUIRED (awaiting user execution of external dashboard provisioning on Supabase and Vercel).

### 2026-09-18 — Phase 8 Milestone 4 Complete & Verified
- **Environment Hardening:** Segregated public and server-only variables in `.env.example`. Enforced production server runtime validation in `src/env.ts` and added fail-fast validation import in `src/app/layout.tsx`.
- **Database Performance Indexes (`20260918000000_phase8_m4_performance_indexes.sql`):** Added 6 non-blocking indexes to both local migration chain and applied to live Supabase test database:
  - `idx_audit_logs_venue_created ON public.audit_logs(company_id, venue_id, created_at DESC)`
  - `idx_events_outbox_status_retry_created ON public.events_outbox(status, retry_count, created_at ASC)`
  - `idx_notification_deliveries_status_created ON public.notification_deliveries(status, created_at ASC)`
  - `idx_payments_status_submitted ON public.payments(status, submitted_at ASC)`
  - `idx_blocked_periods_field_dates ON public.blocked_periods(field_id, starts_at, ends_at)`
  - `idx_bookings_venue_start_at ON public.bookings(venue_id, start_at DESC)`
- **HTTP Security Headers:** Configured `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, and `Permissions-Policy` in `web/next.config.ts`.
- **Observability & Sensitive Data Sanitization (`src/lib/observability.ts`):** Built fail-safe structured logger that scrubs passwords, auth tokens, UTRs, and signed URLs. Added `src/tests/observability.test.ts` (2 tests passing). Integrated into `/api/cron/notifications`.
- **Performance & Concurrency Benchmark Suite (`src/tests/performance.m4.test.ts`):** Validated atomic slot concurrency (5 parallel requests: 1 success, 4 conflict rejections), availability grid latency (<400ms), report latency (<350ms), and outbox processing. All 4 tests passed against live DB.
- **Production Operations Runbook (`PRODUCTION_RUNBOOK.md`):** Published operational runbook covering deployment, secrets rotation, migrations, rollbacks, cron invocations, and disaster recovery.
- **Unit Test Mock Fix (`src/tests/booking.concurrency.test.ts`):** Added `getProfile: vi.fn()` to `AuthService` mock to resolve pre-existing unit test mock discrepancy.
- **Full Verification Suite:**
  - `npm test`: 16/16 test files passed (104/104 tests passed, 0 skipped, 0 failed).
  - `npx playwright test --workers=1`: 5/5 spec files passed (5/5 tests passed).
  - `npm run typecheck`: PASS (Exit 0, 0 errors).
  - `npm run lint`: PASS (Exit 0, 0 errors).
  - `npm run build`: PASS (Exit 0, Turbopack compiled in 6.9s).
- **Freeze Status:** Phase 8 Milestones 1–4 are Complete, Verified, and Frozen.

### 2026-09-17 — Phase 8 Milestone 3 Complete & Verified
- **Staff Approval Regression Resolved:** Diagnosed TypeScript array/object union handling for permission codes and service role profile lookup in `MembershipService.hasPermission`. Verified atomic transition of booking to `CONFIRMED` and payment to `VERIFIED` in both DB and UI via Playwright (`tests/e2e/staff-approval.spec.ts`).
- **Notification Outbox & Delivery Suite (`src/tests/notifications.m3.test.ts`):** Validated event identity preservation, event-specific idempotency (`notify_${event.id}_wa`), duplicate prevention, payload independence, retry state increment and permanent exhaustion (`retry_count >= 3`), `BOOKING_CANCELLED` processing, `SIMULATED` status semantics (never marked `SENT`), and `/api/cron/notifications` header security with `CRON_SECRET`. All 8 tests passed.
- **Reporting & Financial Calculations Suite (`src/tests/reporting.m3.test.ts`):** Validated exact integer minor units (paise) math for `gross_amount_minor`, `advance_required_minor`, and `balance_due_minor`, cancelled/expired booking exclusions, utilisation aggregations, deterministic timezone day boundaries (`ReportService.getVenueDayBounds`), tenant isolation, and `report.view` RBAC. All 6 tests passed.
- **Audit RBAC & Append-Only Suite (`src/tests/audit.m3.test.ts`):** Validated `/admin/[companyId]/venues/[venueId]/audit` route, `audit.view` permission checks for Admin/Manager/Sub-manager/Customer, strict tenant isolation, pagination and filtering by `eventType` and `entityType`, and PostgreSQL trigger protection blocking `UPDATE` and `DELETE` on `audit_logs`. All 6 tests passed.
- **Full Verification Suite:**
  - `npm test`: 14/14 test files passed (98/98 tests passed, 0 skipped, 0 failed).
  - `npm run test:e2e`: 5/5 spec files passed (5/5 tests passed).
  - `npm run typecheck`: PASS (Exit 0, 0 errors).
  - `npm run lint`: PASS (Exit 0, 0 errors).
  - `npm run build`: PASS (Exit 0, Turbopack compiled all 26 routes).
- **Database Migrations Created/Applied:** Zero (0). Existing schema was preserved as source of truth.

### 2026-09-16 — Phase 8 Milestone 2 Complete & Verified
- Implemented Playwright E2E browser test suites: `customer-journey.spec.ts`, `payment-submission.spec.ts`, `concurrency.spec.ts`, `storage-security.spec.ts`, and `staff-approval.spec.ts`.
- Verified atomic concurrency prevention on identical slot reservations.
- Verified private storage bucket security: Customer B denied access to Customer A's payment proof image.

### 2026-09-07 — Phase 8 Milestone 1 Complete & Verified
- Configured dedicated isolated Supabase TEST project (`https://blticunftrrodvxaqnbd.supabase.co`).
- Pushed and applied all 8 migrations (`20260904204901_init_auth_profiles.sql` through `20260907020000_phase8_audit_append_only.sql`) to the test database.
- Qualified `storage.objects.name` in `20260905224814_phase5_storage_and_assets.sql` and `combined_migrations.sql` to resolve column ambiguity in storage RLS policies.
- Configured `web/.env.test` and `web/.env` with test database credentials.
- Updated `vitest.config.mts` and `vitest.setup.ts` with environment parsing and Node.js WebSocket polyfill for Supabase Realtime client.
- Updated `20260907020000_phase8_audit_append_only.sql` to use `FOR EACH STATEMENT` triggers for database-level append-only enforcement.
- **Verification Results:**
  - **`npm test`**: 11/11 test files passed, 78/78 tests passed (0 skipped, 0 failed). All 10 live database-backed integration tests (6 RLS + 4 Audit append-only) executed against the live Supabase test database and passed.
  - **`npm run typecheck`**: PASS (Exit 0)
  - **`npm run lint`**: PASS (Exit 0)
  - **`npm run build`**: PASS (Exit 0, Turbopack compiled in 9.2s)

### 2026-09-07 — Phase 7 Complete & Frozen
- Implemented `events_outbox` and `notification_deliveries` with resilient Node.js queue processing via `NotificationService`.
- Added `report.view` and `audit.view` permissions.
- Built Audit UI with filtering and pagination.
- Built Reporting UI with Bookings, Financial, and Utilisation reports using server-side aggregation.
- Verified all linters, typechecks, and builds pass.

### 2026-09-06 — Phase 6 Complete & Frozen
- Implemented `audit_logs` table and Phase 6 RPC mutations (`cancel_booking_transaction`, `complete_booking_transaction`, `record_balance_payment_transaction`).
- Built server actions, services, and route components for Dashboard, Customers, Staff, and Bookings operations.
- Enforced strict Staff RBAC anti-escalation for role management.
- Verified test suite passes fully (14 passed).
- Verified production build successfully compiles all new Server Actions and routes.

### 2026-09-06 — Tracker Maintenance (Discrepancy Corrections)
- **What changed:** PROJECT_PROGRESS_TRACKER.md corrected with 7 verified discrepancies identified by codebase inspection.
  1. Fixed `get_auth_user_scopes()` return signature — removed non-existent `role_code TEXT` column; confirmed correct signature is `TABLE (company_id UUID, venue_id UUID)`.
  2. Added `20260905215152_venue_management_and_storage.sql` to migration history as EMPTY STUB / NEVER APPLIED (0 bytes, untracked in git, superseded before any SQL was written).
  3. Removed non-existent `upsertVenueAction` from Server Actions inventory (no such function exists in `admin.actions.ts`).
  4. Added `setOperatingHoursAction` to Server Actions inventory (confirmed implemented in `admin.actions.ts`).
  5. Documented `AdminVenueService.upsertBlockedPeriod` as a service method without a server action wrapper (Phase 6 scope).
  6. Added `AdminVenueService` (`web/src/modules/venue/admin.service.ts`) to Important Files.
  7. Added `TenantService` (`web/src/modules/tenant/service.ts`) to Important Files.
- **Why:** Tracker was created before final corrective pass verification; discrepancies were identified by direct source code and migration inspection.
- **Verification:** All 7 corrections verified against live codebase files. No application code, migrations, or migration stubs were modified.
- **Phase affected:** None — documentation maintenance only. Phases 1–5 remain COMPLETE & FROZEN.

### 2026-09-06 — Phase 5 Corrective Pass & Freeze
- Approved and FROZEN Phase 5 after corrective pass.
- Fixed Next.js 15 async route `params` contract across all `src/app` pages and layouts.
- Updated `ClientCheckoutForm` prop type to accept optional `qrUrl: string | null`.
- Verified `npm run typecheck` (PASS 0), `npm run lint` (PASS 0), `npm run test` (PASS 14, SKIPPED 6), and `npm run build` (PASS 0).
- Confirmed `UNIQUE (payment_account_id, transaction_reference)` scoping.

### 2026-09-05
- Completed Phase 5 implementation (Venue management, Storage buckets `payment_proofs` & `venue_assets`, Customer booking flow `/book/[venueSlug]/[fieldId]`, Checkout flow `/checkout/[bookingId]`).
- Completed Phase 4 (Transactional PL/pgsql engine, 30-min slots, concurrency tests).

---

## Antigravity Handoff Notes

If another agent or conversation session resumes work on this project, adhere strictly to the following guidance:

1. **Project Definition:** Turf 2 is a multi-tenant sports turf booking platform built with Next.js 16 (App Router), Supabase (Auth, PostgreSQL, Storage), and Tailwind CSS.
2. **Completed Phases:**
   - **Phases 1–7:** COMPLETE & FROZEN.
   - **Phase 8 Milestones 1, 2, 3, 4:** COMPLETE, VERIFIED & FROZEN.
     - Dedicated test DB configured at `blticunftrrodvxaqnbd.supabase.co`.
     - 104/104 unit/integration tests passing (16 test files).
     - 5/5 Playwright E2E spec files passing (5/5 tests).
     - Clean `tsc --noEmit`, `eslint`, and `next build` (all Exit 0).
     - 6 M4 performance indexes created and applied.
3. **Current Phase:** Phase 8 — Gate A: Production Readiness Sign-Off & Provider Certification (**READY WITH EXTERNAL CONFIGURATION REQUIRED**).
4. **What is Frozen:** Phases 1 through 7, plus Phase 8 Milestones 1, 2, 3, 4. All core schema, booking rules, storage rules, operations logic, notifications, reporting, database hardening triggers, M3 hardening suites, and M4 readiness additions are frozen.
5. **What is Pending:** External deployment provisioning on dedicated production Supabase and Vercel dashboards, followed by production smoke-test SOP execution.
6. **What Should Be Done Next:** Perform external dashboard configuration on production Supabase project (apply migrations, configure Auth, verify private storage buckets, configure PITR) and Vercel project (set Node 22 runtime, configure environment variables, deploy, set up scheduled cron). Once external deployment is live, execute the production smoke-test SOP.
7. **What Must NOT Be Changed:**
   - Do not edit or refactor Phase 4 PL/pgsql RPCs (`execute_booking_transaction`, `approve_booking_transaction`, etc.).
   - Do not change payment validation rule (`amount_minor >= advance_required_minor`).
   - Do not bypass `active_slot_reservations` or `UNIQUE (field_id, slot_start)`.
   - Do not weaken multi-tenant scoping or RLS policies.
   - Do not delete the empty migration stub `20260905215152_venue_management_and_storage.sql`.
   - Do not alter the event-specific idempotency key pattern (`notify_${event.id}_wa`) or introduce SHA-256 deduplication.
8. **Files to Consult First:**
   - [`PROJECT_PROGRESS_TRACKER.md`](file:///c:/Users/anirb/Downloads/Turf%202/PROJECT_PROGRESS_TRACKER.md) (This document)
   - [`PRODUCTION_RUNBOOK.md`](file:///c:/Users/anirb/Downloads/Turf%202/PRODUCTION_RUNBOOK.md) (Operations SOPs)
   - [`web/supabase/combined_migrations.sql`](file:///c:/Users/anirb/Downloads/Turf%202/web/supabase/combined_migrations.sql) (All 9 schema migrations)
   - [`web/src/tests/notifications.m3.test.ts`](file:///c:/Users/anirb/Downloads/Turf%202/web/src/tests/notifications.m3.test.ts)
   - [`web/tests/e2e/staff-approval.spec.ts`](file:///c:/Users/anirb/Downloads/Turf%202/web/tests/e2e/staff-approval.spec.ts)
   - [`web/src/env.ts`](file:///c:/Users/anirb/Downloads/Turf%202/web/src/env.ts)

