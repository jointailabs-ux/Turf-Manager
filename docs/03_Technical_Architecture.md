# TECHNICAL ARCHITECTURE
## Antigravity Sports Venue Booking Platform
Version 1.0

## Architecture
Browser → Next.js/TypeScript → application/domain services → Supabase Auth/PostgreSQL/Storage → scheduler/jobs → notification provider.

Use a modular monolith.

## Stack
Next.js, TypeScript, Tailwind CSS, Supabase Auth, Supabase PostgreSQL, Supabase Storage, Zod (or equivalent), managed hosting, CI/CD.

## Application Modules
Auth; tenancy/membership; venues; sports; fields; availability; bookings; pricing; payments; customers; RBAC; notifications; audit; reporting.

## Booking Engine
Generate 30-minute slots. Validate hours and blocks. Calculate price. Create booking and historical booking_slots. Insert every required active_slot_reservations row in one PostgreSQL transaction. UNIQUE(field_id, slot_start) is the final conflict guard.

## Expiry
Use guarded state transitions. Approval and expiry must be mutually exclusive. Release active reservations in the same transaction as expiry/rejection/cancellation.

## Identity
Global profile plus scoped memberships. Company-wide or venue-scoped membership. Never trust client-selected tenant context.

## RLS
Every tenant-scoped table receives RLS policies. Server-side services also enforce permission and scope.

## Async Work
Use an outbox/event record or database-backed job table. Notification delivery and retries occur outside the booking transaction.

## Storage
Private bucket for payment proof. Authorised signed URLs only.

## Dashboard
Independent query endpoints/services for today, revenue, pending payments, field overview and calendar.

## Deployment
Development, staging and production. Versioned migrations. CI lint/typecheck/test/build. Backups and restore runbook.

## Scaling
Optimise PostgreSQL first. Add Redis/cache/read replicas only when measurement justifies them.
