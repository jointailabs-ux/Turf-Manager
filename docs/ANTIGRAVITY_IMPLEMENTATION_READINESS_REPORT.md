# ANTIGRAVITY IMPLEMENTATION READINESS REPORT

## 1. DOCUMENTS FOUND
The following documentation files were discovered in the provided ZIP archive (`Antigravity_Sports_Venue_Booking_Product_Technical_Docs_v1.0.zip`):
- `01_Product_Technical_Bible_v1.0` (.md and .docx)
- `02_PRD_V1_V2` (.md and .docx)
- `03_Technical_Architecture` (.md and .docx)
- `04_Database_Schema_SQL_Design` (.md and .docx)
- `05_RBAC_Permission_Matrix` (.md and .docx)
- `06_API_Specification` (.md and .docx)
- `07_UI_UX_Specification` (.md and .docx)

**Master Source of Truth:** `01_Product_Technical_Bible_v1.0` is the absolute master specification. In the event of any contradiction, it takes full precedence.

## 2. REQUIREMENT UNDERSTANDING
- **System Architecture:** A responsive web platform deployed as a modular monolith using Next.js, TypeScript, and Supabase (Auth, PostgreSQL, Storage). It features background jobs for async tasks and notifications.
- **Major Business Workflows:** 
  - Multi-tenant venue administration (Company → Venue → Sport → Field).
  - Online booking and manual staff bookings with a strict 30-minute availability slot and 60-minute minimum duration.
  - Payment flows involving QR/UPI submission, manual UTR verification, approval, rejection, and auto-expiry.
  - Granular RBAC supporting Admin, Manager, Sub-manager, and Customer profiles with venue-level scoping.
- **V1 Scope:** Core booking engine with absolute concurrency protection, manual payment verification via UTR, multi-tenancy management, basic dashboard/calendar, role-based access control, async notifications, and strict server-side validation/RLS. Features like automated payment gateways, recurring bookings, and advanced refunds are strictly V2 and excluded from this build.

## 3. V1 MODULE BREAKDOWN
1. **Authentication:** Next.js + Supabase Auth.
2. **Profiles & Tenancy:** User profiles, companies, user memberships, and multi-tenancy contexts.
3. **Venues & Sports:** Venue management, sport mapping, and sports fields.
4. **Fields & Operations:** Operating hours and blocked periods per field.
5. **Pricing:** Configurable base pricing and field pricing snapshot logic.
6. **Availability:** Grid generation and live availability calculation.
7. **Booking Engine:** The core transaction engine handling slots, price calculation, validation, and idempotency.
8. **Payments:** Payment accounts, payment submission, and manual verification/approval queues.
9. **Manual Bookings:** Offline booking channels (Walk-in, Phone, etc.) respecting the exact same concurrency rules.
10. **Customers:** Customer directory and history (scoped).
11. **RBAC:** Roles, explicit permissions, and scope assignment (Admin, Manager, Sub-manager).
12. **Dashboard & Calendar:** Widgets for revenue, bookings today, pending payments, and a calendar view.
13. **Notifications:** Event generation and async delivery via external providers.
14. **Audit:** Audit logging for sensitive entity changes.
15. **Background Jobs:** Scheduler/jobs for auto-expiring unverified payments and retrying notifications.

## 4. DATABASE REVIEW
- **Proposed Tables Reviewed:** All core tables proposed align logically with the business requirements.
- **Missing Foreign Keys / Constraints:** Need to explicitly define foreign keys for `bookings.created_by_profile_id`, `audit_logs.performed_by`, and mapping tables (`venue_sports`). Constraints needed for `bookings.status` (enum or check), `payments.status`, and valid currency values.
- **Missing Indexes:** Need indexes on `bookings.status` + `expires_at` (for the auto-expiry job), `booking_slots.slot_start`/`slot_end`, and `active_slot_reservations.created_at`. 
- **RLS Requirements:** All tenant-scoped tables (`venues`, `fields`, `bookings`, `payments`, etc.) must have RLS policies restricting read/write based on `auth.uid()` and matching records in `user_memberships`.
- **Integrity Problems:** Ensuring `expires_at` logic on bookings does not conflict with payment verification requires strict row-level locking (`SELECT FOR UPDATE`) during state transitions to prevent race conditions.

## 5. BOOKING ENGINE REVIEW
- **30-Minute Slot Generation & Multi-slot Booking:** Bookings > 30 mins will generate multiple `active_slot_reservations`. 
- **Concurrent Booking / DB Uniqueness:** Double booking is made impossible by the constraint `UNIQUE(field_id, slot_start)` on `active_slot_reservations`. Any overlapping concurrent booking attempt will trigger a PostgreSQL unique constraint violation and rollback the entire transaction.
- **Transaction Boundaries:** Validation, slot generation, price calculation, booking creation, slot reservation insertion, and idempotency key creation must happen within a single monolithic ACID PostgreSQL transaction.
- **Expiry vs. Approval Race:** The state transition must lock the booking row (`SELECT ... FOR UPDATE`). If `expires_at <= now()`, approval fails. If `expires_at > now()`, approval succeeds. Expiry/Rejection/Cancellation transactions will atomically delete the `active_slot_reservations` while keeping `booking_slots` for history.
- **Idempotency:** A unique `Idempotency-Key` prevents double-charging or duplicate bookings during network retries.
- **Manual Bookings:** Walk-ins will trigger the exact same database function/transaction as online bookings, ensuring zero bypasses of the availability constraints.

## 6. RBAC REVIEW
- **Hierarchy:** Global profiles -> `user_memberships` (linked to `company_id` and optionally `venue_id`) -> `role_id`.
- **Explicit Permissions:** Permissions (e.g., `payment.approve`, `booking.create_manual`) are verified server-side. Sub-managers need explicit grants for payment approvals; it cannot be assumed.
- **Enforcement:** Client-supplied roles or scopes are ignored. API endpoints will decode the Auth token, resolve memberships, and apply both application-level permission checks and RLS.

## 7. MULTI-TENANCY REVIEW
- **RLS & Application Authorization:** Application-level code will extract `company_id`/`venue_id` from the requested URL or payload, verify against the authenticated user's `user_memberships`, and then execute the query. RLS acts as a second, unbypassable defense layer. 

## 8. API REVIEW
- **Missing Endpoints:** May need endpoints for fetching available payment methods/accounts per venue.
- **Unsafe Endpoints / Missing Validation:** Ensure `POST /bookings` calculates pricing entirely server-side (ignoring client-sent totals).
- **Missing Idempotency:** Any `POST` mutation, especially for payments and bookings, must require an idempotency key header.
- **Client-Controlled Fields:** Any payload containing `status`, `amount`, or `tenant_id` must be re-derived or strictly validated server-side.

## 9. UI/UX REVIEW
- The UI specification correctly aligns with backend rules. By ensuring 30-minute grid increments and clear status colors, the customer experience matches backend constraints. The pending verification state provides the necessary UX feedback for the manual payment approval workflow.

## 10. SECURITY REVIEW
- **Tenant Isolation:** Enforced via strict RLS.
- **Privilege Escalation:** Mitigated by never trusting client-side JWT claims about permissions; all permissions are evaluated server-side.
- **IDOR Risks:** Direct object references (e.g., `GET /bookings/:id`) must validate that the user is the owner OR a staff member with appropriate scope.
- **File Upload Risks:** Payment proofs must be uploaded to a private Supabase Storage bucket. Signed URLs will be issued only to authorized staff.
- **Payment Manipulation:** Amount validation and verification against UTR happens offline by staff. The system locks down the booking to only accept the expected `advance_required_minor`.

## 11. PERFORMANCE REVIEW
- **Important Indexes:** `bookings` by `(company_id, status, created_at)` for dashboards, `active_slot_reservations` by `(field_id, slot_start)`.
- **Availability Query:** Availability needs to quickly query `active_slot_reservations` and `blocked_periods`. Doing this over a 1-week or 1-month window is fast with proper indexes.
- **Background Jobs:** Polling for expired `PAYMENT_PENDING` bookings requires an index on `(status, expires_at)`.

## 12. IMPLEMENTATION PLAN
- **Phase 1:** Project foundation (Next.js, Supabase setup, CI/linting).
- **Phase 2:** Authentication & Profiles.
- **Phase 3:** Tenant hierarchy (Companies, Venues, Sports, Fields, DB schema, RLS).
- **Phase 4:** RBAC & Memberships.
- **Phase 5:** Operating Hours & Blocks.
- **Phase 6:** Availability & Pricing rules.
- **Phase 7:** Booking engine (Transactions, Slots, Concurrency).
- **Phase 8:** Payments (Submission, Approval, Expiry job).
- **Phase 9:** Manual bookings (Staff flows).
- **Phase 10:** Dashboard, Calendar, and Customers.
- **Phase 11:** Notifications & Audit logging.
- **Phase 12:** Hardening (Testing, Security audit).
- **Phase 13:** Deployment.

## 13. TEST STRATEGY
- **Mandatory Tests:**
  - **Concurrency:** Blast the booking endpoint with 10 simultaneous requests for the exact same field/slot; only 1 must succeed.
  - **State Transitions:** Race condition tests for Approval vs. Expiry.
  - **Multi-slot Conflicts:** Try booking 60 mins where the second 30 mins is already booked.
  - **RLS/Multi-company:** Verify user in Company A cannot view or manipulate Bookings in Company B.
  - **Idempotency:** Re-send the same booking request; verify DB state remains unchanged but returns success.

## 14. RISKS / AMBIGUITIES
None at this time. All requirements are clear and constraints are strictly defined by the Master Bible.

## 15. RECOMMENDATIONS

### 15.1 Background Jobs Architecture (V1)
**Evaluation:**
- **Redis/Upstash + External Worker:** Introduces unnecessary infrastructure complexity and external dependencies for V1.
- **`pg_cron` / Supabase scheduling:** Native to Postgres. Good for simple polling, but lacks robust built-in retry logic, application context, and observability.
- **Database-Backed Job/Outbox Pattern:** Uses a Postgres table (e.g., `notification_events`, `scheduler_jobs`) to queue tasks (e.g., notifications, expiry sweeping). A simple application-level worker (or serverless API route triggered by a basic cron) queries this table, processes the work, and updates the row status.

**Recommendation:**
Use a **Database-Backed Job/Outbox Pattern**. It relies purely on PostgreSQL for state, requires zero new infrastructure (no Redis), provides explicit transaction guarantees (e.g., inserting a notification event in the exact same transaction as a booking creation), and offers built-in visibility and retry tracking.

### 15.2 Booking Engine Transaction Strategy
**Evaluation of Approaches:**

**A. Application Domain Service + PostgreSQL Transaction:**
- **Maintainability & Testability:** High. TypeScript allows for clean abstractions, easy unit testing of pricing and slot generation logic, and straightforward error parsing.
- **Concurrency Safety & Guarantees:** 100% safe. As long as all operations are wrapped in a single `BEGIN ... COMMIT` transaction, the `UNIQUE(field_id, slot_start)` constraint on `active_slot_reservations` structurally prevents any double-booking. The DB acts as the final authority.
- **RLS Interaction:** Excellent. The Supabase client natively injects the authenticated user's context, making RLS seamless.
- **Security:** Business rules are strictly enforced server-side.

**B. PL/pgSQL Booking Procedure:**
- **Maintainability & Testability:** Low. Complex pricing calculations, dynamic hour validations, and debugging are significantly harder in SQL. 
- **Concurrency Safety:** 100% safe, but redundant since the database constraint handles the heavy lifting of conflict prevention.
- **RLS Interaction:** Can be tricky depending on how `SECURITY DEFINER` vs `SECURITY INVOKER` is set up.

**Recommendation:**
Use **Application Domain Service + PostgreSQL Transaction (Option A)**. 
Because the database constraint (`UNIQUE`) provides absolute mathematical certainty against double-bookings, pushing the business logic (slot math, pricing, validation) into a PL/pgSQL stored procedure introduces unnecessary maintenance overhead. Wrapping the operations in a single application-driven Postgres transaction provides the perfect balance of developer velocity, testability, and impenetrable concurrency safety.
