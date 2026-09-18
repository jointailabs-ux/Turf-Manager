-- Phase 7: Notifications, Audit UI, Reporting
-- 2026-09-07

-- ============================================================
-- 1. NOTIFICATIONS OUTBOX & DELIVERIES
-- ============================================================

-- Outbox for business events (e.g., BOOKING_CREATED)
CREATE TABLE public.events_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id UUID NOT NULL,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, PROCESSED, FAILED
    error_message TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    processed_at TIMESTAMPTZ
);

CREATE INDEX idx_events_outbox_status ON public.events_outbox(status);
CREATE INDEX idx_events_outbox_company ON public.events_outbox(company_id, created_at DESC);

-- Delivery records for actual notifications sent (email, SMS, WhatsApp)
CREATE TABLE public.notification_deliveries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events_outbox(id) ON DELETE CASCADE,
    company_id UUID REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE SET NULL,
    recipient_profile_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    channel TEXT NOT NULL, -- WHATSAPP, SMS, EMAIL
    provider TEXT NOT NULL, -- e.g., 'MOCK', 'TWILIO'
    provider_reference TEXT,
    status TEXT NOT NULL, -- PENDING, SIMULATED, DELIVERED, FAILED
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

-- ============================================================
-- 2. NEW PERMISSIONS (audit.view, report.view)
-- ============================================================

INSERT INTO public.permissions (code, name) VALUES
('audit.view', 'View Audit Logs'),
('report.view', 'View Reports')
ON CONFLICT (code) DO NOTHING;

-- Grant to admin and manager roles
-- (Assuming roles 'admin' and 'manager' exist based on Phase 3 conventions)
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
