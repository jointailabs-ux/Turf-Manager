-- Phase 8: Hardening - Append-Only Audit Logs
-- 2026-09-07

CREATE OR REPLACE FUNCTION public.enforce_audit_append_only()
RETURNS TRIGGER AS $$
BEGIN
    -- Allow service_role or postgres superuser to perform operations if needed for maintenance
    IF current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
        RETURN NULL;
    END IF;

    -- Block UPDATE or DELETE for any standard application access (authenticated or anon)
    RAISE EXCEPTION 'Audit logs are append-only. Modification or deletion is strictly prohibited.';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Apply trigger to block UPDATE
CREATE TRIGGER prevent_audit_update
    BEFORE UPDATE ON public.audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_audit_append_only();

-- Apply trigger to block DELETE
CREATE TRIGGER prevent_audit_delete
    BEFORE DELETE ON public.audit_logs
    FOR EACH STATEMENT EXECUTE FUNCTION public.enforce_audit_append_only();

