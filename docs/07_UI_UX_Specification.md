# UI / UX SPECIFICATION

## Design
Modern, sporty, premium and energetic without being flashy. Customer side is visual and booking-focused. Admin side is fast and information-dense.

## Customer Navigation
Home, Venues, Book, My Bookings, Profile.

## Booking Flow
Venue → Sport → Field → Date → Time/Duration → Summary → Payment Instructions → UTR/Reference → Pending Verification → Confirmation.

## Availability
30-minute grid with Available, Selected, Pending Payment, Confirmed, Blocked and Closed states. Refresh/reconcile if availability changes before submission.

## Summary
Show venue, sport, field, date, start/end, duration, gross amount, advance, balance and payment instructions.

## Payment
Show QR/account, amount, UTR/reference, optional proof, expiry and verification status. Never claim screenshot is proof of payment.

## Admin
Dashboard cards, calendar, payment queue, current bookings, field overview, customers and staff.

## Manual Booking
Customer → venue → sport → field → date → time → duration → payment method/status. Uses exactly the same availability/concurrency engine as online bookings.

## Accessibility
Keyboard navigation, visible focus, labels, accessible errors, sufficient contrast and no colour-only status indicators. Minimum target width 320px.

## Loading/Error
Every async component gets loading, empty, error and retry states where appropriate.
