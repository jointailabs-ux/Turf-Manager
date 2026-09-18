# PHASE 2 IMPLEMENTATION REPORT: Authentication & Identity

## 1. Files Created/Modified
- **Created Migration:** `web/supabase/migrations/20260904204901_init_auth_profiles.sql`
- **Created UI/Actions:**
  - `web/src/app/(auth)/login/page.tsx` (Login/Signup form)
  - `web/src/app/(auth)/login/actions.ts` (Server actions for Auth operations)
  - `web/src/app/auth/callback/route.ts` (OAuth and Email verification callback)
- **Created Identity Service:**
  - `web/src/modules/auth/service.ts` (Server-authoritative identity and profile resolution)
  - `web/src/modules/auth/service.test.ts` (Vitest test suite)
- **Modified Middleware:**
  - `web/src/middleware.ts` (Next.js middleware router)
  - `web/src/lib/supabase/middleware.ts` (Supabase session refresh and route protection logic)

## 2. Database Migrations Created
A single migration `init_auth_profiles.sql` was created, implementing:
- `public.profiles` table (UUID `id`, uniquely tied to `auth.users(id)`).
- `public.customers` table (uniquely tied to `public.profiles(id)`).
- A Postgres trigger (`handle_new_user`) that listens for `INSERT ON auth.users` and safely guarantees an atomic global profile creation.
- Strict PostgreSQL Row Level Security (RLS) policies allowing users to view and update only their own profile and customer record.

## 3. Authentication Flows Implemented
- **Email/Password Signup:** Accepts email and password, creates an `auth.users` row, triggering the creation of the global profile, returning to `/dashboard`.
- **Email/Password Login:** Validates credentials via Supabase SSR, sets cookies, and redirects.
- **Sign Out:** Server action clearing session cookies securely.
- **OAuth Callback:** Route handler at `/auth/callback` exchanging code for session safely regardless of load balancer configurations.

## 4. Profile Architecture
- Implemented a **Global Profile Foundation**. 
- A profile represents the physical person (`public.profiles`) independently of any company, venue, staff role, or membership.
- Customer identity (`public.customers`) is created explicitly as a 1:1 map to the global profile, ensuring users can be both staff and customers simultaneously without identity duplication.
- Authorisation (RBAC) relies completely on Phase 3/4 memberships, strictly preventing "global role" misconfigurations.

## 5. Session Architecture
- Uses Supabase SSR client for cookie-based authentication.
- Auth tokens are parsed purely on the server (`createServerClient`).
- The client cannot manipulate their authenticated ID. The user UUID is derived directly from the signed JWT via `supabase.auth.getUser()`.

## 6. Route Protection
- Route protection is enforced at the edge via `src/middleware.ts`.
- The middleware proactively checks for a valid session. If a user attempts to access protected arrays (e.g. `['/admin', '/dashboard', '/profile']`) without a valid session, they are redirected to `/login`.
- Inside Application Domain Services (like `AuthService`), `requireUser()` provides a secondary unbypassable protection layer.

## 7. Security Decisions
- Server-authoritative resolution: We never trust client-supplied UUIDs or scopes. 
- Zod is utilized for rigid schema validation on all server action payload inputs.
- The service-role key is never exposed to the client (guaranteed by test and `NEXT_PUBLIC` variable prefix rules).
- Profile creation relies on a database trigger (`SECURITY DEFINER`) to prevent race conditions and ensure full atomicity.

## 8. Environment Variables
No new environment variables were required for Phase 2. We continue relying on:
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 9. Tests Created and Results
Created `src/modules/auth/service.test.ts`. 
**Results:** 6/6 tests passing.
**Test Coverage:**
- Verifies `AuthService.getUser()` correctly resolves authenticated users.
- Verifies `AuthService.requireUser()` correctly rejects unauthenticated access.
- Verifies `AuthService.getProfile()` resolves the global identity mapping securely.
- Verifies that no service-role secrets or sensitive backend environment variables leak into `NEXT_PUBLIC_` namespace (preventing accidental exposure).

## 10. Lint Result
- Command: `npm run lint`
- Result: **Passed** (0 errors, 0 warnings).

## 11. Typecheck Result
- Command: `npm run typecheck`
- Result: **Passed** (Strict TypeScript compilation succeeded).

## 12. Build Result
- Command: `npm run build`
- Result: **Passed** (Compiled successfully in 21 seconds. Generated static pages and dynamic routes properly).

## 13. Limitations
- Full Google OAuth UI button is missing pending UI/UX detailed screens, though the callback structure is fully capable of processing the flow.
- We cannot fully test OAuth callbacks strictly in unit tests without extensive mocking, so unit tests focus on domain-service resolution and security validation.

## 14. Deviations from the Master Bible
- **None.** Identity and authentication accurately match the V1 objective for global profiling separate from RBAC. All work remains tightly within V1 constraints.
