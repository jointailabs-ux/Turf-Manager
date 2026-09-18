# API SPECIFICATION
## Base Path
`/api/v1`

## Auth
Supabase Auth session establishes identity. API derives permissions and membership scope server-side.

## Availability
GET /venues
GET /venues/:venueId/sports
GET /fields/:fieldId/availability?date=YYYY-MM-DD

## Booking
POST /bookings/preview
POST /bookings — requires Idempotency-Key
GET /bookings/my
GET /bookings/:id
GET /admin/bookings
POST /admin/bookings/manual
POST /bookings/:id/cancel

## Payment
POST /bookings/:id/payment-submission
POST /bookings/:id/payment-approve
POST /bookings/:id/payment-reject
POST /bookings/:id/balance
GET /bookings/:id/payments

## Management
POST/PATCH /admin/venues
POST/PATCH /admin/fields
POST /admin/fields/:id/blocks
GET/PATCH /admin/pricing/:fieldId
GET /admin/memberships
POST /admin/memberships/invite
PATCH /admin/memberships/:id
PATCH /admin/memberships/:id/permissions

## Dashboard
GET /dashboard/today
GET /dashboard/revenue
GET /dashboard/pending-payments
GET /dashboard/field-overview
GET /dashboard/calendar

## Audit
GET /admin/audit-logs
GET /admin/audit-logs/:id
GET /admin/audit-logs/entity/:type/:id

## Rules
Validate all input. Authorise before data access. Scope every query. Use transactions for multi-record commands. Never accept client final price, status or tenant ownership. Return stable machine-readable error codes.
