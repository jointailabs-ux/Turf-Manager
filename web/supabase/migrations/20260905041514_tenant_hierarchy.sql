-- 1. Create Core Tables

-- Companies
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

-- Venues
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

-- Safely allow composite foreign keys from user_memberships
ALTER TABLE public.venues ADD CONSTRAINT venues_company_id_id_key UNIQUE (company_id, id);

-- Sports (Global Catalog)
CREATE TABLE public.sports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true
);

-- Venue Sports (Intersection)
CREATE TABLE public.venue_sports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    venue_id UUID NOT NULL REFERENCES public.venues(id) ON DELETE CASCADE,
    sport_id UUID NOT NULL REFERENCES public.sports(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    UNIQUE(venue_id, sport_id)
);
-- We need this composite unique key to safely allow composite foreign keys from fields
ALTER TABLE public.venue_sports ADD CONSTRAINT venue_sports_venue_id_id_key UNIQUE (venue_id, id);

-- Fields
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

-- Enforce that field's venue_sport actually belongs to the same venue
ALTER TABLE public.fields 
    ADD CONSTRAINT fields_venue_sport_fkey 
    FOREIGN KEY (venue_id, venue_sport_id) 
    REFERENCES public.venue_sports (venue_id, id);


-- 2. RBAC & Memberships

-- Roles
CREATE TABLE public.roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
);

-- Permissions
CREATE TABLE public.permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
);

-- Role Permissions
CREATE TABLE public.role_permissions (
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- User Memberships
CREATE TABLE public.user_memberships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    company_id UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
    venue_id UUID REFERENCES public.venues(id) ON DELETE CASCADE, -- Null means company-wide scope
    role_id UUID NOT NULL REFERENCES public.roles(id) ON DELETE RESTRICT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- A profile can only have one active membership per venue (or one global company membership)
    UNIQUE NULLS NOT DISTINCT (profile_id, company_id, venue_id)
);

-- Enforce that venue_id belongs to company_id (MATCH SIMPLE allows venue_id to be NULL)
ALTER TABLE public.user_memberships 
    ADD CONSTRAINT memberships_venue_fkey 
    FOREIGN KEY (company_id, venue_id) 
    REFERENCES public.venues (company_id, id) ON DELETE CASCADE;


-- 3. Triggers for updated_at

CREATE TRIGGER set_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_venues_updated_at BEFORE UPDATE ON public.venues FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_fields_updated_at BEFORE UPDATE ON public.fields FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER set_user_memberships_updated_at BEFORE UPDATE ON public.user_memberships FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- 4. RLS Helper Function

-- This function resolves the user's active membership scopes WITHOUT infinite recursion in RLS.
-- SECURITY DEFINER ensures it can read user_memberships even if RLS is enabled on it.
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

-- Restrict execution of this sensitive helper to only authenticated sessions and the backend
REVOKE EXECUTE ON FUNCTION public.get_auth_user_scopes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_auth_user_scopes() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_auth_user_scopes() TO service_role;


-- 5. Enable Row Level Security (RLS)

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_sports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_memberships ENABLE ROW LEVEL SECURITY;

-- 6. RLS Policies

-- Companies: Users can see companies they have a membership in.
CREATE POLICY "Users can view assigned companies" 
ON public.companies FOR SELECT 
USING (
  id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s)
);

-- Venues: Users can see venues they are specifically scoped to, OR all venues in a company if they have company-wide scope (venue_id IS NULL)
CREATE POLICY "Users can view assigned venues" 
ON public.venues FOR SELECT 
USING (
  id IN (SELECT s.venue_id FROM public.get_auth_user_scopes() s WHERE s.venue_id IS NOT NULL)
  OR
  company_id IN (SELECT s.company_id FROM public.get_auth_user_scopes() s WHERE s.venue_id IS NULL)
);

-- Sports: Global catalog, readable by all authenticated users
CREATE POLICY "Authenticated users can view sports" 
ON public.sports FOR SELECT 
TO authenticated
USING (true);

-- Venue Sports: Readable if user can read the venue
CREATE POLICY "Users can view venue_sports for assigned venues" 
ON public.venue_sports FOR SELECT 
USING (
  venue_id IN (
    SELECT v.id FROM public.venues v -- relays on the venue policy
  )
);

-- Fields: Readable if user can read the venue
CREATE POLICY "Users can view fields for assigned venues" 
ON public.fields FOR SELECT 
USING (
  venue_id IN (
    SELECT v.id FROM public.venues v -- relays on the venue policy
  )
);

-- Memberships: Users can read their own memberships
CREATE POLICY "Users can view own memberships" 
ON public.user_memberships FOR SELECT 
USING (
  profile_id IN (SELECT p.id FROM public.profiles p WHERE p.auth_user_id = auth.uid())
);

-- Roles, Permissions, Role Permissions: Readable by all authenticated users
CREATE POLICY "Authenticated users can view roles" ON public.roles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view permissions" ON public.permissions FOR SELECT TO authenticated USING (true);
CREATE POLICY "Authenticated users can view role_permissions" ON public.role_permissions FOR SELECT TO authenticated USING (true);

-- Base Insert/Update policies for Tenant Data (Very restrictive for now, Staff management logic will come later, 
-- but we allow service_role to manage them. For V1 we want strict server-side staff checks)
-- We do not allow arbitrary clients to insert venues or fields.
