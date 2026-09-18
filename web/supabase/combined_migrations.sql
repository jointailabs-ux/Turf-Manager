-- Combined Migration Script for Turf 2 Supabase Project (Phases 1-8)

-- ============================================================
-- 1. INIT AUTH & PROFILES
-- ============================================================
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    auth_user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT,
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID UNIQUE NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = auth_user_id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = auth_user_id);

CREATE POLICY "Users can view own customer record" ON public.customers FOR SELECT USING (
    profile_id IN (SELECT id FROM public.profiles WHERE auth_user_id = auth.uid())
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (auth_user_id, full_name, email)
    VALUES (
        NEW.id,
        NEW.raw_user_meta_data->>'full_name',
        NEW.email
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- ============================================================
-- 2. TENANT HIERARCHY & RBAC
-- ============================================================
CREATE TABLE public.companies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    currency TEXT NOT NULL DEFAULT 'INR',
    default_timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    contacts JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE public.venues (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    address JSONB,
    contacts JSONB,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(company_id, slug)
);

ALTER TABLE public.venues ADD CONSTRAINT venues_company_id_id_key UNIQUE (company_id, id);

CREATE TABLE public.sports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
);

CREATE TABLE public.venue_sports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    sport_id UUID NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(venue_id, sport_id)
);
ALTER TABLE public.venue_sports ADD CONSTRAINT venue_sports_venue_id_id_key UNIQUE (venue_id, id);

CREATE TABLE public.fields (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    venue_sport_id UUID NOT NULL REFERENCES public.venue_sports(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    description TEXT,
    base_price_minor INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(venue_id, name)
);

ALTER TABLE public.fields 
    ADD CONSTRAINT fields_venue_sport_fkey 
    FOREIGN KEY (venue_id, venue_sport_id) 
    REFERENCES public.venue_sports (venue_id, id);

CREATE TABLE public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
);

CREATE TABLE public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE public.user_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE NULLS NOT DISTINCT (profile_id, company_id, venue_id)
);

ALTER TABLE public.user_memberships 
    ADD CONSTRAINT memberships_venue_fkey 
    FOREIGN KEY (company_id, venue_id) 
    REFERENCES public.venues (company_id, id) ON DELETE CASCADE;

CREATE TRIGGER set_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_fields_updated_at BEFORE UPDATE ON public.fields FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_user_memberships_updated_at BEFORE UPDATE ON public.user_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.get_auth_user_scopes()
RETURNS TABLE (company_id UUID, venue_id UUID) 
SECURITY DEFINER 
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT um.company_id, um.venue_id
  FROM public.user_memberships um
  JOIN public.profiles p ON um.profile_id = p.id
  WHERE p.auth_user_id = auth.uid() 
    AND um.is_active = true;
END;
$$ LANGUAGE plpgsql;

REVOKE EXECUTE ON FUNCTION public.get_auth_user_scopes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_user_scopes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_scopes() TO service_role;

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view assigned companies" ON public.companies FOR SELECT USING (
  id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s)
);

CREATE POLICY "Users can view assigned venues" ON public.venues FOR SELECT USING (
  id IN (SELECT s.venue_id FROM public.get_auth_user_scopes() s WHERE s.venue_id IS NOT NULL)
  OR
  company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s WHERE s.venue_id IS NULL)
);

CREATE POLICY "Authenticated users can view sports" ON public.sports FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can view venue_sports for assigned venues" ON public.venue_sports FOR SELECT USING (
  venue_id IN (SELECT v.id FROM public.venues v)
);

CREATE POLICY "Users can view fields for assigned venues" ON public.fields FOR SELECT USING (
  venue_id IN (SELECT v.id FROM public.venues v)
);

CREATE POLICY "Users can view own memberships" ON public.user_memberships FOR SELECT USING (
  profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid())
);

CREATE POLICY "Authenticated users can view roles" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view permissions" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);


-- ============================================================
-- 3. BOOKING ENGINE
-- ============================================================
ALTER TABLE public.fields ADD CONSTRAINT fields_venue_id_id_key UNIQUE (venue_id, id);

ALTER TABLE public.venues ADD COLUMN advance_payment_type TEXT NOT NULL DEFAULT 'PERCENTAGE' CHECK (advance_payment_type IN ('PERCENTAGE', 'FIXED'));
ALTER TABLE public.venues ADD COLUMN advance_payment_value INTEGER NOT NULL DEFAULT 30 CHECK (
  (advance_payment_type = 'PERCENTAGE' AND advance_payment_value >= 0 AND advance_payment_value <= 100) OR
  (advance_payment_type = 'FIXED' AND advance_payment_value >= 0)
);

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

CREATE TABLE public.booking_slots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES public.fields(id) ON DELETE RESTRICT,
    slot_start TIMESTAMPTZ NOT NULL,
    slot_end TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (slot_end > slot_start)
);

CREATE TABLE public.active_slot_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    field_id UUID NOT NULL REFERENCES public.fields(id) ON DELETE RESTRICT,
    slot_start TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(field_id, slot_start)
);

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

CREATE INDEX idx_bookings_company_id ON public.bookings(company_id);
CREATE INDEX idx_bookings_venue_id ON public.bookings(venue_id);
CREATE INDEX idx_bookings_customer_id ON public.bookings(customer_id);
CREATE INDEX idx_bookings_start_at ON public.bookings(start_at);
CREATE INDEX idx_active_slots_field_start ON public.active_slot_reservations(field_id, slot_start);
CREATE INDEX idx_payments_booking_id ON public.payments(booking_id);

-- Booking RPCs
CREATE OR REPLACE FUNCTION public.execute_booking_transaction(
    p_idempotency_key JSONB,
    p_booking JSONB,
    p_slots JSONB,
    p_active_reservations JSONB
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.expire_booking_transaction(p_booking_id UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_updated INTEGER;
    v_status TEXT;
BEGIN
    SELECT status INTO v_status FROM public.bookings WHERE id = p_booking_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;
    
    IF v_status != 'PAYMENT_PENDING' THEN RETURN FALSE; END IF;

    UPDATE public.bookings 
    SET status = 'EXPIRED', updated_at = now()
    WHERE id = p_booking_id AND status = 'PAYMENT_PENDING' AND expires_at <= now();

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'Booking has not yet reached its expiry time.'; END IF;

    DELETE FROM public.active_slot_reservations WHERE booking_id = p_booking_id;
    RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_booking_transaction(p_booking_id UUID, p_payment_id UUID, p_verified_by UUID) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

CREATE OR REPLACE FUNCTION public.reject_booking_transaction(p_booking_id UUID, p_payment_id UUID, p_verified_by UUID, p_reason TEXT) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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

REVOKE EXECUTE ON FUNCTION public.execute_booking_transaction(JSONB, JSONB, JSONB, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.execute_booking_transaction(JSONB, JSONB, JSONB, JSONB) TO service_role;

REVOKE EXECUTE ON FUNCTION public.expire_booking_transaction(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_booking_transaction(UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.approve_booking_transaction(UUID, UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.approve_booking_transaction(UUID, UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.reject_booking_transaction(UUID, UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reject_booking_transaction(UUID, UUID, UUID, TEXT) TO service_role;

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.operating_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blocked_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_slot_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own idempotency keys" ON public.idempotency_keys FOR SELECT USING (actor_id = auth.uid());
CREATE POLICY "Users can view pricing" ON public.pricing_rules FOR SELECT USING (venue_id IN (SELECT v.id FROM public.venues v));
CREATE POLICY "Users can view hours" ON public.operating_hours FOR SELECT USING (venue_id IN (SELECT v.id FROM public.venues v));
CREATE POLICY "Users can view blocks" ON public.blocked_periods FOR SELECT USING (venue_id IN (SELECT v.id FROM public.venues v));
CREATE POLICY "Users can view payment accounts" ON public.payment_accounts FOR SELECT USING (company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s));

CREATE POLICY "Users can view assigned bookings" ON public.bookings FOR SELECT USING (
  customer_id IN (SELECT c.id FROM public.customers c JOIN public.profiles p ON c.profile_id = p.id WHERE p.auth_user_id = auth.uid())
  OR
  venue_id IN (SELECT um.venue_id FROM public.user_memberships um WHERE um.profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid()))
  OR
  company_id IN (SELECT um.company_id FROM public.user_memberships um WHERE um.profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid()) AND um.venue_id IS NULL)
);

CREATE POLICY "Users can view slots for assigned bookings" ON public.booking_slots FOR SELECT USING (booking_id IN (SELECT b.id FROM public.bookings b));
CREATE POLICY "Users can view reservations for assigned bookings" ON public.active_slot_reservations FOR SELECT USING (booking_id IN (SELECT b.id FROM public.bookings b));
CREATE POLICY "Users can view assigned payments" ON public.payments FOR SELECT USING (booking_id IN (SELECT b.id FROM public.bookings b));


-- ============================================================
-- 4. STORAGE & ASSETS
-- ============================================================
ALTER TABLE public.payments ADD COLUMN proof_object_path TEXT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('payment_proofs', 'payment_proofs', false, 5242880, '{image/jpeg, image/png, image/webp}'),
  ('venue_assets', 'venue_assets', false, 5242880, '{image/jpeg, image/png, image/webp}')
ON CONFLICT (id) DO UPDATE SET 
  file_size_limit = 5242880, 
  allowed_mime_types = '{image/jpeg, image/png, image/webp}',
  public = false;

CREATE POLICY "Customers can upload their own payment proofs"
ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'payment_proofs' AND
  auth.uid() = (
    SELECT p.auth_user_id
    FROM public.customers c
    JOIN public.profiles p ON c.profile_id = p.id
    JOIN public.bookings b ON b.customer_id = c.id
    JOIN public.payments pay ON pay.booking_id = b.id
    WHERE pay.id::TEXT = (regexp_split_to_array(storage.objects.name, '/'))[3]
  )
);

CREATE POLICY "Customers can view their own payment proofs"
ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'payment_proofs' AND
  auth.uid() = (
    SELECT p.auth_user_id
    FROM public.customers c
    JOIN public.profiles p ON c.profile_id = p.id
    JOIN public.bookings b ON b.customer_id = c.id
    JOIN public.payments pay ON pay.booking_id = b.id
    WHERE pay.id::TEXT = (regexp_split_to_array(storage.objects.name, '/'))[3]
  )
);

CREATE POLICY "Staff can view payment proofs for their venues"
ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'payment_proofs' AND
  EXISTS (
    SELECT 1
    FROM public.user_memberships um
    JOIN public.profiles p ON um.profile_id = p.id
    JOIN public.roles r ON um.role_id = r.id
    LEFT JOIN public.role_permissions rp ON r.id = rp.role_id
    LEFT JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.auth_user_id = auth.uid()
      AND um.company_id::TEXT = (regexp_split_to_array(storage.objects.name, '/'))[1]
      AND (um.venue_id IS NULL OR um.venue_id::TEXT = (regexp_split_to_array(storage.objects.name, '/'))[2])
      AND (r.code IN ('admin', 'manager') OR perm.code IN ('payment.view', 'payment.approve'))
  )
);

CREATE POLICY "Staff can manage venue assets"
ON storage.objects FOR ALL TO authenticated USING (
  bucket_id = 'venue_assets' AND
  EXISTS (
    SELECT 1
    FROM public.user_memberships um
    JOIN public.profiles p ON um.profile_id = p.id
    JOIN public.roles r ON um.role_id = r.id
    LEFT JOIN public.role_permissions rp ON r.id = rp.role_id
    LEFT JOIN public.permissions perm ON rp.permission_id = perm.id
    WHERE p.auth_user_id = auth.uid()
      AND um.company_id::TEXT = (regexp_split_to_array(storage.objects.name, '/'))[1]
      AND (um.venue_id IS NULL OR um.venue_id::TEXT = (regexp_split_to_array(storage.objects.name, '/'))[2])
      AND (r.code IN ('admin', 'manager') OR perm.code = 'settings.manage')
  )
);


-- ============================================================
-- 5. OPERATIONS & AUDIT LOGS
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

ALTER TABLE public.payments ADD COLUMN recorded_by UUID REFERENCES public.profiles(id) ON DELETE RESTRICT;

CREATE INDEX idx_bookings_company_start_at ON public.bookings(company_id, start_at);
CREATE INDEX idx_bookings_venue_status_start ON public.bookings(venue_id, status, start_at);
CREATE INDEX idx_payments_booking_status ON public.payments(booking_id, status);

CREATE OR REPLACE FUNCTION public.cancel_booking_transaction(
    p_booking_id UUID,
    p_cancelled_by UUID,
    p_reason TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF v_updated = 0 THEN RAISE EXCEPTION 'Concurrent modification detected — booking cancellation failed.'; END IF;

    DELETE FROM public.active_slot_reservations WHERE booking_id = p_booking_id;

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

CREATE OR REPLACE FUNCTION public.complete_booking_transaction(
    p_booking_id UUID,
    p_completed_by UUID
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
    IF v_updated = 0 THEN RAISE EXCEPTION 'Concurrent modification detected — booking completion failed.'; END IF;

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

CREATE OR REPLACE FUNCTION public.record_balance_payment_transaction(
    p_booking_id UUID,
    p_recorded_by UUID,
    p_amount_minor INTEGER,
    p_payment_method TEXT,
    p_transaction_reference TEXT
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    v_booking RECORD;
    v_payment_id UUID;
BEGIN
    SELECT * INTO v_booking FROM public.bookings WHERE id = p_booking_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found.'; END IF;

    IF v_booking.status != 'CONFIRMED' THEN
        RAISE EXCEPTION 'Balance payment requires CONFIRMED booking. Current status: %', v_booking.status;
    END IF;
    IF p_amount_minor <= 0 THEN RAISE EXCEPTION 'Payment amount must be positive.'; END IF;
    IF p_amount_minor > v_booking.balance_due_minor THEN RAISE EXCEPTION 'Payment amount (%) exceeds remaining balance (%).', p_amount_minor, v_booking.balance_due_minor; END IF;
    IF p_payment_method NOT IN ('CASH', 'UPI_MANUAL', 'OTHER') THEN RAISE EXCEPTION 'Invalid payment method for staff balance recording: %.', p_payment_method; END IF;

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


-- ============================================================
-- 6. NOTIFICATIONS, OUTBOX & REPORTING PERMISSIONS
-- ============================================================
CREATE TABLE public.events_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING',
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_events_outbox_status ON public.events_outbox(status);
CREATE INDEX idx_events_outbox_company ON public.events_outbox(company_id, created_at DESC);

CREATE TABLE public.notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events_outbox(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
    recipient_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    channel TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_reference TEXT,
    status TEXT NOT NULL,
    error_message TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    sent_at TIMESTAMPTZ
);

CREATE INDEX idx_notification_deliveries_company ON public.notification_deliveries(company_id, created_at DESC);

ALTER TABLE public.events_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_deliveries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff can view scoped events"
    ON public.events_outbox FOR SELECT
    USING (company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s));

CREATE POLICY "Staff can view scoped notification deliveries"
    ON public.notification_deliveries FOR SELECT
    USING (company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s));

INSERT INTO public.permissions (code, name) VALUES
('audit.view', 'View Audit Logs'),
('report.view', 'View Reports')
ON CONFLICT (code) DO NOTHING;

DO $$
DECLARE
    v_admin_role_id UUID;
    v_manager_role_id UUID;
    v_audit_perm_id UUID;
    v_report_perm_id UUID;
BEGIN
    SELECT id INTO v_admin_role_id FROM public.roles WHERE code = 'admin';
    SELECT id INTO v_manager_role_id FROM public.roles WHERE code = 'manager';
    
    SELECT id INTO v_audit_perm_id FROM public.permissions WHERE code = 'audit.view';
    SELECT id INTO v_report_perm_id FROM public.permissions WHERE code = 'report.view';

    IF v_admin_role_id IS NOT NULL THEN
        IF v_audit_perm_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_admin_role_id, v_audit_perm_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_report_perm_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_admin_role_id, v_report_perm_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;

    IF v_manager_role_id IS NOT NULL THEN
        IF v_audit_perm_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_manager_role_id, v_audit_perm_id) ON CONFLICT DO NOTHING;
        END IF;
        IF v_report_perm_id IS NOT NULL THEN
            INSERT INTO public.role_permissions (role_id, permission_id) VALUES (v_manager_role_id, v_report_perm_id) ON CONFLICT DO NOTHING;
        END IF;
    END IF;
END $$;


-- ============================================================
-- 7. PHASE 8 HARDENING: AUDIT LOGS APPEND-ONLY TRIGGER
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_audit_append_only()
RETURNS TRIGGER AS $$
BEGIN
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NULL;
    END IF;

    RAISE EXCEPTION 'Audit logs are append-only. Modification or deletion is strictly prohibited.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS prevent_audit_update ON public.audit_logs;
DROP TRIGGER IF EXISTS prevent_audit_delete ON public.audit_logs;

CREATE TRIGGER prevent_audit_update
    BEFORE UPDATE ON public.audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_audit_append_only();

CREATE TRIGGER prevent_audit_delete
    BEFORE DELETE ON public.audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_audit_append_only();


-- ============================================================
-- 8. PHASE 8 M4 HARDENING: PERFORMANCE INDEXES
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_audit_logs_venue_created
ON public.audit_logs(company_id, venue_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_outbox_status_retry_created
ON public.events_outbox(status, retry_count, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_notification_deliveries_status_created
ON public.notification_deliveries(status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_payments_status_submitted
ON public.payments(status, submitted_at ASC);

CREATE INDEX IF NOT EXISTS idx_blocked_periods_field_dates
ON public.blocked_periods(field_id, starts_at, ends_at);

CREATE INDEX IF NOT EXISTS idx_bookings_venue_start_at
ON public.bookings(venue_id, start_at DESC);


