# SPORTS VENUE BOOKING & MANAGEMENT PLATFORM
## Product & Technical Bible — Antigravity
Version 1.0 | 5 September 2026

## 0. Source of Truth
This is the master specification. It combines the Product Bible, PRD, technical architecture and V1 build contract. V1 is the only implementation scope; V2 is roadmap only.

## 1. Product Vision
A responsive web platform for sports venue/turf operators to manage companies, venues, sports, independently bookable fields, availability, bookings, customers, staff, payments, notifications and reporting.

Company → Venue → Sport → Field.

## 2. Users
- Admin: full control within authorised company scope.
- Manager: operational access according to assigned permissions.
- Sub-manager: restricted operational access according to assigned permissions.
- Customer: browse availability, book, submit payment information and view own bookings.

A person has one global identity and may simultaneously be a customer and staff member for one or more companies/venues. Role is never inferred from Google login or email domain.

## 3. V1 Scope
Authentication; multi-company/venue/sport/field management; 30-minute availability; 60-minute minimum customer booking; field pricing; customer bookings; walk-in/phone/manual staff bookings; manual QR/UPI payment; UTR/reference verification; balance recording; dashboard/calendar; customers; RBAC; notifications; audit; idempotency; RLS; tests; deployment.

## 4. V1 Non-Scope
Automated payment gateway/reconciliation; advanced pricing; recurring bookings; advanced refunds/rescheduling; native apps; SaaS/Super Admin; loyalty; expenses/P&L; CMS/gallery/offers/tournaments; AI recommendations.

## 5. Booking Rules
- Scheduling unit: 30 minutes.
- Minimum customer duration: 60 minutes.
- Extensions: 30-minute increments.
- Server validates field status, operating hours, blocks and availability.
- Price is calculated server-side and snapshotted.
- All required slots are reserved atomically.
- Online and manual bookings use the same reservation engine.

## 6. Booking States
DRAFT (transient only) → PAYMENT_PENDING → CONFIRMED.
PAYMENT_PENDING may become PAYMENT_REJECTED or EXPIRED.
CONFIRMED may become CANCELLED or COMPLETED.
Only the backend may perform state transitions.

## 7. Payment
Default PAYMENT_PENDING expiry: 20 minutes, configurable per company/venue.
Default advance: 30% of booking value, configurable as fixed amount or percentage.

Customer QR flow requires UTR/transaction reference. Screenshot is optional evidence and never authoritative. Staff verify against the actual receiving account/payment source. Duplicate reference detection is scoped to company/payment account. Expired bookings cannot be approved.

Staff/offline methods: CASH, UPI_MANUAL, OTHER_OFFLINE.

## 8. Dashboard
Today bookings; gross booking value; verified advance collected; pending payments; confirmed/cancelled/expired counts; weekly revenue; monthly summary; current-day bookings; field overview; calendar; payment queue; customer/staff shortcuts.

Financial metrics remain distinct: gross booking value, advance required, verified collections, balance due, refunds and net/realised revenue.

## 9. Notifications
Event-driven and asynchronous. Events: booking created, payment submitted, payment approved/rejected, booking expired/cancelled. Provider abstraction supports WhatsApp/SMS/email. Notifications must not block booking/payment transactions and must be retryable/idempotent.

## 10. RBAC
Suggested permissions:
booking.view, booking.create_manual, booking.cancel, booking.complete, customer.view, customer.manage, payment.view, payment.approve, payment.record_balance, field.view, field.manage, pricing.view, pricing.manage, staff.view, staff.manage, reports.view, settings.view, settings.manage, audit.view, notification.view, notification.retry.

Memberships may be company-wide or venue-scoped.

## 11. Security
Supabase Auth; server-side authorisation; PostgreSQL RLS; least privilege; private payment-proof storage; rate limiting; secure headers; no secrets in frontend; no client-controlled tenant/role/price/status; important mutations audited.

## 12. Technical Architecture
Browser → Next.js/TypeScript → server/domain services → Supabase Auth/PostgreSQL/Storage → background jobs → notification provider.

Use a secure modular monolith. Do not introduce microservices or Redis until measured need exists.

## 13. Slot Architecture
Use historical `booking_slots` plus current `active_slot_reservations`.

`active_slot_reservations` has UNIQUE(field_id, slot_start).

Booking transaction:
1. validate request;
2. generate all 30-minute slots;
3. validate operating hours/blocks;
4. calculate price;
5. create booking;
6. create booking_slots;
7. insert every active_slot_reservation;
8. persist payment state/idempotency result;
9. commit.

Any slot conflict rolls back the entire transaction.

On rejection/expiry/cancellation, active reservations are released transactionally while history remains.

## 14. Expiry/Approval Race
Approval requires PAYMENT_PENDING and `expires_at > now()`.
Expiry requires PAYMENT_PENDING and `expires_at <= now()`.
Only the transaction that wins the guarded state transition may perform the corresponding slot release/retention.

## 15. Idempotency
Store actor, scope, key, request hash, result status/resource and timestamps. Same key + same request returns the original result. Same key + different request hash returns conflict.

## 16. Database
Core tables: companies, venues, sports, venue_sports, fields, profiles, customers, roles, permissions, role_permissions, user_memberships, pricing_rules, operating_hours, blocked_periods, payment_accounts, bookings, booking_slots, active_slot_reservations, payments, payment_transactions, notification_events, notifications, notification_templates, audit_logs, idempotency_keys and scheduler/job records.

Store timestamps in UTC and INR money as integer paise.

## 17. Performance & Reliability
Independent dashboard widgets; pagination; indexed booking/status/date queries; no oversized dashboard request. Initial targets: availability p95 <500ms; booking command p95 <1s excluding external providers; test at least 200 concurrent users. Daily backups and restore procedure.

## 18. Testing
Unit: duration/slots/pricing. Integration: transactional booking. Concurrency: same-slot race. Security: RLS and multi-membership. State: approval/rejection/expiry/cancellation. Idempotency. Notifications. Dashboard. End-to-end booking journey.

## 19. Antigravity Build Contract
Never put security-critical rules only in the frontend. Never implement check-then-insert booking without DB enforcement. Never bypass concurrency for staff bookings. Never expose payment proof publicly. Never silently implement V2. Ship migrations, tests and documentation with each module.

## 20. V2 Roadmap
Automated payments/reconciliation; advanced pricing; recurring bookings/blocks; advanced cancellation/refunds/rescheduling; automated reminders; utilisation and revenue analytics; advanced reports/exports; granular permissions; SaaS/Super Admin.

# END
