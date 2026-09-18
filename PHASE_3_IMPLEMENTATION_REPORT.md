# PHASE 3 IMPLEMENTATION REPORT: Tenant Hierarchy & Database Foundation (Security Fixes Applied)

## 1. Exact Migration Changes (Security Fixes)
- **Created Migration:** `web/supabase/migrations/20260905041514_tenant_hierarchy.sql`
- **Issue 1 Fix (Membership Integrity):** Added a database-level composite constraint to ensure `venue_id` assigned to a membership fundamentally belongs to the `company_id`.
  - Added: `ALTER TABLE public.venues ADD CONSTRAINT venues_company_id_id_key UNIQUE (company_id, id);`
  - Added: `ALTER TABLE public.user_memberships ADD CONSTRAINT memberships_venue_fkey FOREIGN KEY (company_id, venue_id) REFERENCES public.venues (company_id, id) ON DELETE CASCADE;`
- **Issue 2 Fix (Security Definer Hardening):** 
  - Revoked public execution rights from the RLS helper function.
  - Added: `REVOKE EXECUTE ON FUNCTION public.get_auth_user_scopes() FROM PUBLIC;`
  - Added: `GRANT EXECUTE ON FUNCTION public.get_auth_user_scopes() TO authenticated;`
  - Added: `GRANT EXECUTE ON FUNCTION public.get_auth_user_scopes() TO service_role;`

## 2. Exact RLS Policies
The following policies enforce all SELECT operations. Note that **no INSERT/UPDATE/DELETE policies are defined**, meaning PostgreSQL safely defaults to **DENY-ALL** for mutations by arbitrary authenticated users. All tenant mutations are strictly reserved for the `service_role` via backend application validation.
- `Companies`: `USING (id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s))`
- `Venues`: `USING (id IN (SELECT s.venue_id FROM public.get_auth_user_scopes() s WHERE s.venue_id IS NOT NULL) OR company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s WHERE s.venue_id IS NULL))`
- `Venue_Sports`: `USING (venue_id IN (SELECT v.id FROM public.venues v))`
- `Fields`: `USING (venue_id IN (SELECT v.id FROM public.venues v))`
- `User_Memberships`: `USING (profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid()))`

## 3. Helper Functions & Security Definer Configuration
```sql
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
```
- **Why Security Definer is Required:** It bypasses the SELECT RLS on `user_memberships` (which restricts users to seeing only their own memberships). Without this, querying `venues` with RLS would create a recursive loop locking the database execution.
- **Why it's Safe:** It accepts no arguments and permanently locks its filtering to `auth.uid()`, physically preventing any user from reading scopes belonging to another user.

## 4. Integration Test Results & Database Constraints
I have written the complete `rls.integration.test.ts` suite required to verify scenarios 1-16 via the live `supabase-js` client.

> **CRITICAL ENVIRONMENT BLOCKER**
> When executing `npx supabase start` to spin up the local PostgreSQL database, the command failed with:
> `docker: command not found (podman also not found) — install Docker Desktop or Podman and ensure it is on PATH`
> Because Docker is unavailable in this environment, I am unable to autonomously spin up the database to execute `vitest run src/tests/rls.integration.test.ts`. 

The test script is fully prepared. To see the concrete execution, please install Docker Desktop on your machine, run `npx supabase start`, and then execute `npm run test`.

## 5. Build & Validation Results
- **Lint:** `npm run lint` → Passed (0 errors, 0 warnings).
- **Typecheck:** `npm run typecheck` → Passed.
- **Unit Tests:** `npm run test` → Passed (Domain Service unit tests run locally without Docker successfully).
- **Build:** `npm run build` → Passed (Compiled successfully in 2.7s).
