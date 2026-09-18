# PRODUCT REQUIREMENTS DOCUMENT
## Antigravity Sports Venue Booking & Management Platform
Version 1.0

### V1 Objective
Digitise sports venue booking and daily operations while making double booking impossible under concurrency.

### Functional Requirements
1. Authenticate with Google OAuth and email/password.
2. Support multiple companies and venues.
3. Support multiple sports and independent fields per venue.
4. Show 30-minute availability.
5. Enforce 60-minute minimum customer booking.
6. Support 30-minute duration extensions.
7. Calculate price server-side.
8. Reserve all selected slots atomically.
9. Require idempotency on booking creation.
10. Support customer QR/UPI payment submission with UTR/reference.
11. Support manual payment approval/rejection.
12. Auto-expire unverified pending bookings after 20 minutes by default.
13. Support staff-created walk-in/phone/manual bookings.
14. Support configurable field pricing.
15. Support customer and staff management.
16. Support Admin, Manager and Sub-manager permissions.
17. Provide dashboard and field calendar.
18. Deliver asynchronous notifications.
19. Audit sensitive actions.
20. Enforce RLS and server-side authorisation.

### Acceptance Criteria
No concurrent double booking; atomic multi-slot reservation; safe approval/expiry race; idempotent retries; secure tenant isolation; working manual booking; working payment verification; working dashboard/calendar; retryable notifications; audited sensitive actions.

### V2
Automated payments/reconciliation, advanced pricing, recurring bookings/blocks, advanced cancellation/refunds/rescheduling, reminders, utilisation analytics, advanced reports, granular permissions and SaaS administration.

### Explicitly Parked
Loyalty, expenses/P&L, CMS, tournament tools, native apps and AI recommendations.
