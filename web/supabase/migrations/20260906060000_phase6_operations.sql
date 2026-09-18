-- Phase 6: Operations + Customers + Staff + Dashboard
-- 2026-09-06
-- New tables, RPCs, indexes. Does NOT modify any Phase 1-5 migration objects.

-- ============================================================
-- 1. AUDIT LOGS TABLE
-- ============================================================

CREATE TABLE public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
    actor_profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_company_created ON public.audit_logs(company_id, created_at DESC);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs(entity_type, entity_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view scoped audit logs"
    ON public.audit_logs FOR SELECT
    USING (company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s));

-- ============================================================
-- 2. ADD recorded_by TO payments
-- For staff-initiated balance payments; NULL for customer-submitted payments.
-- ============================================================

ALTER TABLE public.payments
    ADD COLUMN recorded_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;

-- ============================================================
-- 3. DASHBOARD PERFORMANCE INDEXES
-- ============================================================

CREATE INDEX idx_bookings_company_start_at ON public.bookings(company_id, start_at);
CREATE INDEX idx_bookings_venue_status_start ON public.bookings(venue_id, status, start_at);
CREATE INDEX idx_payments_booking_status ON public.payments(booking_id, status);

-- ============================================================
-- 4. cancel_booking_transaction RPC
-- Allowed: PAYMENT_PENDING → CANCELLED, CONFIRMED → CANCELLED
-- Releases active_slot_reservations; preserves booking_slots and payment history.
-- Guarded FOR UPDATE prevents concurrent state conflicts.
-- Audit log inserted transactionally inside the RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.cancel_booking_transaction(
    p_booking_id UUID,
    p_cancelled_by UUID,
    p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
    v_booking RECORD;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;

    IF v_booking.status NOT IN ('PAYMENT_PENDING', 'CONFIRMED') THEN
        RAISE EXCEPTION 'Booking cannot be cancelled from status: %. Allowed: PAYMENT_PENDING, CONFIRMED.', v_booking.status;
    END IF;

    UPDATE public.bookings
        SET status = 'CANCELLED',
            cancellation_reason = p_reason,
            updated_at = now()
        WHERE id = p_booking_id
          AND status IN ('PAYMENT_PENDING', 'CONFIRMED');
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Concurrent modification detected — booking cancellation failed.';
    END IF;

    -- Release active slot reservations (preserves booking_slots history)
    DELETE FROM public.active_slot_reservations WHERE booking_id = p_booking_id;

    -- Transactional audit log
    INSERT INTO public.audit_logs (company_id, venue_id, actor_profile_id, event_type, entity_type, entity_id, metadata)
    VALUES (v_booking.company_id, v_booking.venue_id, p_cancelled_by,
            'BOOKING_CANCELLED', 'booking', p_booking_id,
            jsonb_build_object(
                'previous_status', v_booking.status,
                'reason', p_reason,
                'field_id', v_booking.field_id,
                'start_at', v_booking.start_at
            ));

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_booking_transaction(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_booking_transaction(UUID, UUID, TEXT) TO service_role;

-- ============================================================
-- 5. complete_booking_transaction RPC
-- Allowed: CONFIRMED → COMPLETED only.
-- Guarded FOR UPDATE prevents concurrent state conflicts.
-- ============================================================

CREATE OR REPLACE FUNCTION public.complete_booking_transaction(
    p_booking_id UUID,
    p_completed_by UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_updated INTEGER;
    v_booking RECORD;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;

    IF v_booking.status != 'CONFIRMED' THEN
        RAISE EXCEPTION 'Booking cannot be completed from status: %. Required: CONFIRMED.', v_booking.status;
    END IF;

    UPDATE public.bookings
        SET status = 'COMPLETED',
            updated_at = now()
        WHERE id = p_booking_id
          AND status = 'CONFIRMED';
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Concurrent modification detected — booking completion failed.';
    END IF;

    -- Transactional audit log
    INSERT INTO public.audit_logs (company_id, venue_id, actor_profile_id, event_type, entity_type, entity_id, metadata)
    VALUES (v_booking.company_id, v_booking.venue_id, p_completed_by,
            'BOOKING_COMPLETED', 'booking', p_booking_id,
            jsonb_build_object(
                'previous_status', v_booking.status,
                'field_id', v_booking.field_id,
                'start_at', v_booking.start_at
            ));

    RETURN TRUE;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_booking_transaction(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.complete_booking_transaction(UUID, UUID) TO service_role;

-- ============================================================
-- 6. record_balance_payment_transaction RPC
-- Only for CONFIRMED bookings. Amount must not exceed remaining balance.
-- V1 NOTE: payment_method 'OTHER' represents OTHER_OFFLINE in business domain.
-- Audit log inserted transactionally inside the RPC.
-- ============================================================

CREATE OR REPLACE FUNCTION public.record_balance_payment_transaction(
    p_booking_id UUID,
    p_recorded_by UUID,
    p_amount_minor INTEGER,
    p_payment_method TEXT,
    p_transaction_reference TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_booking RECORD;
    v_payment_id UUID;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;

    IF v_booking.status != 'CONFIRMED' THEN
        RAISE EXCEPTION 'Balance payment requires CONFIRMED booking. Current status: %', v_booking.status;
    END IF;
    IF p_amount_minor <= 0 THEN
        RAISE EXCEPTION 'Payment amount must be positive.';
    END IF;
    IF p_amount_minor > v_booking.balance_due_minor THEN
        RAISE EXCEPTION 'Payment amount (%) exceeds remaining balance (%).', p_amount_minor, v_booking.balance_due_minor;
    END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI_MANUAL', 'OTHER') THEN
        RAISE EXCEPTION 'Invalid payment method for staff balance recording: %.', p_payment_method;
    END IF;

    INSERT INTO public.payments (
        booking_id, payment_method, status, amount_minor, payment_type,
        transaction_reference, submitted_at, verified_at, verified_by, recorded_by
    ) VALUES (
        p_booking_id, p_payment_method, 'VERIFIED', p_amount_minor, 'BALANCE',
        NULLIF(p_transaction_reference, ''), now(), now(), p_recorded_by, p_recorded_by
    ) RETURNING id INTO v_payment_id;

    UPDATE public.bookings
        SET balance_due_minor = GREATEST(0, balance_due_minor - p_amount_minor),
            updated_at = now()
        WHERE id = p_booking_id;

    -- Transactional audit log
    INSERT INTO public.audit_logs (company_id, venue_id, actor_profile_id, event_type, entity_type, entity_id, metadata)
    VALUES (v_booking.company_id, v_booking.venue_id, p_recorded_by,
            'PAYMENT_BALANCE_RECORDED', 'payment', v_payment_id,
            jsonb_build_object(
                'amount_minor', p_amount_minor,
                'payment_method', p_payment_method,
                'booking_id', p_booking_id,
                'remaining_balance', GREATEST(0, v_booking.balance_due_minor - p_amount_minor)
            ));

    RETURN v_payment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_balance_payment_transaction(UUID, UUID, INTEGER, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_balance_payment_transaction(UUID, UUID, INTEGER, TEXT, TEXT) TO service_role;
