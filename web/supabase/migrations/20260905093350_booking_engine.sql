-- 0. Strengthen Existing Tables (Composite FK preparation & Config)
ALTER TABLE public.fields ADD CONSTRAINT fields_venue_id_id_key UNIQUE (venue_id, id);

ALTER TABLE public.venues ADD COLUMN advance_payment_type TEXT NOT NULL DEFAULT 'PERCENTAGE' CHECK (advance_payment_type IN ('PERCENTAGE', 'FIXED'));
ALTER TABLE public.venues ADD COLUMN advance_payment_value INTEGER NOT NULL DEFAULT 30 CHECK (
  (advance_payment_type = 'PERCENTAGE' AND advance_payment_value >= 0 AND advance_payment_value <= 100) OR
  (advance_payment_type = 'FIXED' AND advance_payment_value >= 0)
);

-- 1. Idempotency Keys
CREATE TABLE public.idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    scope_key TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    result_status TEXT NOT NULL,
    result_resource_id UUID,
    response_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ NOT NULL,
    UNIQUE(actor_id, scope_key, idempotency_key)
);

-- 2. Supporting Pre-requisite Tables (Operating Hours, Blocks, Pricing)
CREATE TABLE public.pricing_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    venue_id UUID NOT NULL,
    field_id UUID,
    rule_type TEXT NOT NULL,
    amount_minor INTEGER NOT NULL,
    effective_from TIMESTAMPTZ,
    effective_to TIMESTAMPTZ,
    is_active BOOLEAN NOT NULL DEFAULT true,
    FOREIGN KEY (company_id, venue_id) REFERENCES public.venues(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (venue_id, field_id) REFERENCES public.fields(venue_id, id) ON DELETE CASCADE
);

CREATE TABLE public.operating_hours (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    venue_id UUID NOT NULL,
    field_id UUID,
    weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6),
    opens_at TIME,
    closes_at TIME,
    is_closed BOOLEAN NOT NULL DEFAULT false,
    FOREIGN KEY (company_id, venue_id) REFERENCES public.venues(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (venue_id, field_id) REFERENCES public.fields(venue_id, id) ON DELETE CASCADE
);

CREATE TABLE public.blocked_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    venue_id UUID NOT NULL,
    field_id UUID,
    starts_at TIMESTAMPTZ NOT NULL,
    ends_at TIMESTAMPTZ NOT NULL,
    reason TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    FOREIGN KEY (company_id, venue_id) REFERENCES public.venues(company_id, id) ON DELETE CASCADE,
    FOREIGN KEY (venue_id, field_id) REFERENCES public.fields(venue_id, id) ON DELETE CASCADE,
    CHECK (ends_at > starts_at)
);

-- 3. Payment Accounts
CREATE TABLE public.payment_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    venue_id UUID,
    display_name TEXT NOT NULL,
    upi_id TEXT,
    qr_object_path TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    FOREIGN KEY (company_id, venue_id) REFERENCES public.venues(company_id, id) ON DELETE CASCADE
);

-- 4. Bookings
CREATE TABLE public.bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL,
    venue_id UUID NOT NULL,
    field_id UUID NOT NULL,
    customer_id UUID REFERENCES public.customers(id) ON DELETE RESTRICT,
    created_by_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    source TEXT NOT NULL CHECK (source IN ('ONLINE', 'WALK_IN', 'PHONE')),
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'PAYMENT_PENDING', 'CONFIRMED', 'PAYMENT_REJECTED', 'EXPIRED', 'CANCELLED', 'COMPLETED')),
    start_at TIMESTAMPTZ NOT NULL,
    end_at TIMESTAMPTZ NOT NULL,
    duration_minutes INTEGER NOT NULL,
    gross_amount_minor INTEGER NOT NULL,
    advance_required_minor INTEGER NOT NULL,
    balance_due_minor INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'INR',
    pricing_snapshot JSONB NOT NULL,
    expires_at TIMESTAMPTZ,
    cancellation_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (company_id, venue_id) REFERENCES public.venues(company_id, id) ON DELETE RESTRICT,
    FOREIGN KEY (venue_id, field_id) REFERENCES public.fields(venue_id, id) ON DELETE RESTRICT,
    CHECK (end_at > start_at)
);
CREATE TRIGGER set_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 5. Booking Slots (Historical)
CREATE TABLE public.booking_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES public.fields(id) ON DELETE RESTRICT,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (slot_end > slot_start)
);

-- 6. Active Slot Reservations (Inventory Guard)
CREATE TABLE public.active_slot_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES public.fields(id) ON DELETE RESTRICT,
    slot_start TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(field_id, slot_start)
);

-- 7. Payments
CREATE TABLE public.payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    payment_account_id UUID REFERENCES public.payment_accounts(id) ON DELETE RESTRICT,
    payment_method TEXT NOT NULL CHECK (payment_method IN ('UPI_QR', 'UPI_MANUAL', 'CASH', 'CARD', 'OTHER')),
    status TEXT NOT NULL CHECK (status IN ('PENDING_VERIFICATION', 'VERIFIED', 'REJECTED')),
    amount_minor INTEGER NOT NULL,
    payment_type TEXT NOT NULL CHECK (payment_type IN ('ADVANCE', 'FULL', 'BALANCE')),
    transaction_reference TEXT,
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    verified_at TIMESTAMPTZ,
    verified_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT,
    rejection_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (payment_account_id, transaction_reference)
);
CREATE TRIGGER set_payments_updated_at BEFORE UPDATE ON public.payments FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 8. Indexes
CREATE INDEX idx_bookings_company_id ON public.bookings(company_id);
CREATE INDEX idx_bookings_venue_id ON public.bookings(venue_id);
CREATE INDEX idx_bookings_customer_id ON public.bookings(customer_id);
CREATE INDEX idx_bookings_start_at ON public.bookings(start_at);
CREATE INDEX idx_active_slots_field_start ON public.active_slot_reservations(field_id, slot_start);
CREATE INDEX idx_payments_booking_id ON public.payments(booking_id);


-- 9. RPC Transaction Wrappers

-- Create Booking Transaction
CREATE OR REPLACE FUNCTION public.execute_booking_transaction(
    p_idempotency_key JSONB,
    p_booking JSONB,
    p_slots JSONB,
    p_active_reservations JSONB
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_booking_id UUID;
    v_slot JSONB;
    v_res JSONB;
BEGIN
    INSERT INTO public.idempotency_keys (
        actor_id, scope_key, idempotency_key, request_hash, result_status, created_at, expires_at
    ) VALUES (
        (p_idempotency_key->>'actor_id')::UUID, p_idempotency_key->>'scope_key',
        p_idempotency_key->>'idempotency_key', p_idempotency_key->>'request_hash',
        'PENDING', now(), now() + interval '24 hours'
    );

    INSERT INTO public.bookings (
        id, company_id, venue_id, field_id, customer_id, created_by_profile_id,
        source, status, start_at, end_at, duration_minutes,
        gross_amount_minor, advance_required_minor, balance_due_minor, currency, pricing_snapshot, expires_at
    ) VALUES (
        (p_booking->>'id')::UUID, (p_booking->>'company_id')::UUID, (p_booking->>'venue_id')::UUID,
        (p_booking->>'field_id')::UUID, NULLIF(p_booking->>'customer_id', '')::UUID,
        (p_booking->>'created_by_profile_id')::UUID, p_booking->>'source', p_booking->>'status',
        (p_booking->>'start_at')::TIMESTAMPTZ, (p_booking->>'end_at')::TIMESTAMPTZ,
        (p_booking->>'duration_minutes')::INTEGER, (p_booking->>'gross_amount_minor')::INTEGER,
        (p_booking->>'advance_required_minor')::INTEGER, (p_booking->>'balance_due_minor')::INTEGER,
        COALESCE(p_booking->>'currency', 'INR'), (p_booking->>'pricing_snapshot')::JSONB,
        (p_booking->>'expires_at')::TIMESTAMPTZ
    ) RETURNING id INTO v_booking_id;

    FOR v_slot IN SELECT * FROM jsonb_array_elements(p_slots) LOOP
        INSERT INTO public.booking_slots (id, booking_id, field_id, slot_start, slot_end)
        VALUES ((v_slot->>'id')::UUID, v_booking_id, (v_slot->>'field_id')::UUID, (v_slot->>'slot_start')::TIMESTAMPTZ, (v_slot->>'slot_end')::TIMESTAMPTZ);
    END LOOP;

    FOR v_res IN SELECT * FROM jsonb_array_elements(p_active_reservations) LOOP
        INSERT INTO public.active_slot_reservations (id, booking_id, field_id, slot_start)
        VALUES ((v_res->>'id')::UUID, v_booking_id, (v_res->>'field_id')::UUID, (v_res->>'slot_start')::TIMESTAMPTZ);
    END LOOP;

    UPDATE public.idempotency_keys
    SET result_status = 'SUCCESS', result_resource_id = v_booking_id
    WHERE actor_id = (p_idempotency_key->>'actor_id')::UUID AND scope_key = p_idempotency_key->>'scope_key' AND idempotency_key = p_idempotency_key->>'idempotency_key';

    RETURN v_booking_id;
END;
$$;

-- Expire Booking Transaction
CREATE OR REPLACE FUNCTION public.expire_booking_transaction(p_booking_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM public.bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
    
    IF v_status != 'PAYMENT_PENDING' THEN 
        -- Already processed (confirmed, expired, etc), graceful exit for scheduler idempotency
        RETURN FALSE; 
    END IF;

    UPDATE public.bookings 
    SET status = 'EXPIRED', updated_at = now()
    WHERE id = p_booking_id AND status = 'PAYMENT_PENDING' AND expires_at <= now();

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Booking has not yet reached its expiry time.';
    END IF;

    DELETE FROM public.active_slot_reservations WHERE booking_id = p_booking_id;
    RETURN TRUE;
END;
$$;

-- Approve Booking Transaction
CREATE OR REPLACE FUNCTION public.approve_booking_transaction(p_booking_id UUID, p_payment_id UUID, p_verified_by UUID) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
    v_payment RECORD;
    v_booking RECORD;
    v_payment_account RECORD;
BEGIN
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found.'; END IF;

    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;

    IF v_payment.payment_method IN ('UPI_QR', 'UPI_MANUAL') AND v_payment.payment_account_id IS NULL THEN
        RAISE EXCEPTION 'UPI payments must specify a receiving payment account.';
    END IF;

    IF v_payment.payment_account_id IS NOT NULL THEN
        SELECT * INTO v_payment_account FROM public.payment_accounts WHERE id = v_payment.payment_account_id;
        IF v_payment_account.company_id != v_booking.company_id THEN RAISE EXCEPTION 'Payment account belongs to a different tenant.'; END IF;
    END IF;

    IF v_payment.booking_id != p_booking_id THEN RAISE EXCEPTION 'Payment does not belong to this booking.'; END IF;
    IF v_booking.status != 'PAYMENT_PENDING' THEN RAISE EXCEPTION 'Booking is not pending payment.'; END IF;
    IF v_booking.expires_at <= now() THEN RAISE EXCEPTION 'Booking has expired.'; END IF;
    IF v_payment.amount_minor < v_booking.advance_required_minor THEN RAISE EXCEPTION 'Payment amount is insufficient.'; END IF;
    IF v_payment.status != 'PENDING_VERIFICATION' THEN RAISE EXCEPTION 'Payment is not pending verification.'; END IF;

    UPDATE public.bookings 
    SET status = 'CONFIRMED', updated_at = now()
    WHERE id = p_booking_id AND status = 'PAYMENT_PENDING' AND expires_at > now();
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'Failed to transition booking to CONFIRMED.'; END IF;

    UPDATE public.payments 
    SET status = 'VERIFIED', verified_at = now(), verified_by = p_verified_by, updated_at = now()
    WHERE id = p_payment_id AND status = 'PENDING_VERIFICATION';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'Failed to transition payment to VERIFIED.'; END IF;

    RETURN TRUE;
END;
$$;

-- Reject Booking Transaction
CREATE OR REPLACE FUNCTION public.reject_booking_transaction(p_booking_id UUID, p_payment_id UUID, p_verified_by UUID, p_reason TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
    v_payment RECORD;
    v_booking RECORD;
BEGIN
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id;
    IF NOT FOUND OR v_payment.booking_id != p_booking_id THEN RAISE EXCEPTION 'Payment mismatch or not found.'; END IF;

    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id;
    IF NOT FOUND OR v_booking.status != 'PAYMENT_PENDING' THEN RAISE EXCEPTION 'Booking not eligible for rejection.'; END IF;

    UPDATE public.bookings 
    SET status = 'PAYMENT_REJECTED', updated_at = now()
    WHERE id = p_booking_id AND status = 'PAYMENT_PENDING';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'Failed to reject booking.'; END IF;

    UPDATE public.payments 
    SET status = 'REJECTED', verified_at = now(), verified_by = p_verified_by, rejection_reason = p_reason, updated_at = now()
    WHERE id = p_payment_id AND status = 'PENDING_VERIFICATION';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'Failed to reject payment.'; END IF;

    DELETE FROM public.active_slot_reservations WHERE booking_id = p_booking_id;

    RETURN TRUE;
END;
$$;

-- Restrict RPC execution
REVOKE EXECUTE ON FUNCTION public.execute_booking_transaction(JSONB, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_booking_transaction(JSONB, JSONB, JSONB, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.expire_booking_transaction(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_booking_transaction(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.approve_booking_transaction(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_booking_transaction(UUID, UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reject_booking_transaction(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_booking_transaction(UUID, UUID, UUID, TEXT) TO service_role;


-- 10. Row Level Security (RLS) Policies
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_slot_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

-- Deny All Base Mutations
-- (Implicitly denied by lack of FOR INSERT/UPDATE/DELETE policies)

-- Idempotency: Users can see their own
CREATE POLICY "Users can view own idempotency keys" ON public.idempotency_keys FOR SELECT USING (actor_id = auth.uid());

-- Pricing & Hours & Blocks: Staff view scoped, Customers see all for booking
CREATE POLICY "Users can view pricing" ON public.pricing_rules FOR SELECT USING (
  venue_id IN (SELECT v.id FROM public.venues v)
);
CREATE POLICY "Users can view hours" ON public.operating_hours FOR SELECT USING (
  venue_id IN (SELECT v.id FROM public.venues v)
);
CREATE POLICY "Users can view blocks" ON public.blocked_periods FOR SELECT USING (
  venue_id IN (SELECT v.id FROM public.venues v)
);

-- Payment Accounts: Strictly scoped to tenant
CREATE POLICY "Users can view payment accounts" ON public.payment_accounts FOR SELECT USING (
  company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s)
);

-- Bookings: Customers see own, Staff see scoped
CREATE POLICY "Users can view assigned bookings" ON public.bookings FOR SELECT USING (
  customer_id IN (SELECT c.id FROM public.customers c JOIN public.profiles p ON c.profile_id = p.id WHERE p.auth_user_id = auth.uid())
  OR
  venue_id IN (SELECT um.venue_id FROM public.user_memberships um WHERE um.profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid()))
  OR
  company_id IN (SELECT um.company_id FROM public.user_memberships um WHERE um.profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid()) AND um.venue_id IS NULL)
);

-- Slots & Reservations: Cascade from bookings
CREATE POLICY "Users can view slots for assigned bookings" ON public.booking_slots FOR SELECT USING (
  booking_id IN (SELECT b.id FROM public.bookings b)
);
CREATE POLICY "Users can view reservations for assigned bookings" ON public.active_slot_reservations FOR SELECT USING (
  booking_id IN (SELECT b.id FROM public.bookings b)
);

-- Payments: Customers see own payments, Staff see scoped
CREATE POLICY "Users can view assigned payments" ON public.payments FOR SELECT USING (
  booking_id IN (SELECT b.id FROM public.bookings b)
);
