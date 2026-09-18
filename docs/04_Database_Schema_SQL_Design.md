# DATABASE SCHEMA & SQL DESIGN
## Antigravity Sports Venue Booking Platform

## Core Tables
companies(id, name, slug, currency, default_timezone, contacts, is_active, timestamps)
venues(id, company_id, name, slug, timezone, address, contacts, is_active, timestamps)
sports(id, name, slug, is_active)
venue_sports(id, venue_id, sport_id, is_active)
fields(id, venue_id, venue_sport_id, name, description, base_price_minor, is_active, timestamps)
profiles(id, auth_user_id, full_name, email, phone, is_active, timestamps)
customers(id, profile_id, timestamps)
roles(id, code, name)
permissions(id, code, name)
role_permissions(role_id, permission_id)
user_memberships(id, profile_id, company_id, venue_id nullable, role_id, is_active, timestamps)
pricing_rules(id, company_id, venue_id, field_id, rule_type, amount_minor, effective dates, is_active)
operating_hours(id, venue_id/field_id, weekday, opens_at, closes_at, is_closed)
blocked_periods(id, company_id, venue_id, field_id nullable, starts_at, ends_at, reason, created_by)
payment_accounts(id, company_id, venue_id nullable, display_name, upi_id, qr_object_path, is_active)
bookings(id, company_id, venue_id, field_id, customer_id, created_by_profile_id, source, status, start_at, end_at, duration_minutes, gross_amount_minor, advance_required_minor, balance_due_minor, currency, pricing_snapshot, expires_at, cancellation fields, timestamps)
booking_slots(id, booking_id, field_id, slot_start, slot_end, created_at)
active_slot_reservations(id, booking_id, field_id, slot_start, created_at)
payments(id, booking_id, payment_account_id, payment_method, status, amount_minor, payment_type, submitted_at, verified_at, verified_by, rejection_reason, timestamps)
payment_transactions(id, payment_id, company_id, payment_account_id, normalized_reference, provider fields, metadata, created_at)
notification_events(id, company_id, event_type, aggregate_type, aggregate_id, payload, idempotency_key, created_at, processed_at)
notifications(id, event_id, booking_id, channel, recipient, template_id, status, retry_count, provider response, timestamps)
notification_templates(id, company_id nullable, channel, event_type, version, content, is_active)
audit_logs(id, company_id nullable, action_type, entity_type, entity_id, performed_by, performed_by_role, old_value, new_value, ip_address, created_at)
idempotency_keys(id, actor_id, scope_key, idempotency_key, request_hash, result_status, result_resource_id, response_payload, created_at, expires_at)

## Critical Constraints
UNIQUE(active_slot_reservations.field_id, active_slot_reservations.slot_start)
UNIQUE(idempotency_keys.actor_id, scope_key, idempotency_key)
Foreign keys and check constraints on states, amounts and timestamps.

## Indexes
Bookings by company/date/status; active reservations by field/slot; payments by booking/status; payment references by company/payment account; notifications by status/retry; audit logs by entity/actor/time; memberships by profile/company/venue; blocks by field/time.

## RLS
Customer access is limited to own resources. Staff access is limited to authorised membership scope and permissions. Tenant IDs from the client are never trusted.

## Money
INR in integer paise. UTC timestamps. Venue timezone controls local calendar/operating hours.
