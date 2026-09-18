-- Add proof_object_path to payments
ALTER TABLE public.payments ADD COLUMN proof_object_path TEXT NULL;

-- Create Storage Buckets
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES 
  ('payment_proofs', 'payment_proofs', false, 5242880, '{image/jpeg, image/png, image/webp}'),
  ('venue_assets', 'venue_assets', false, 5242880, '{image/jpeg, image/png, image/webp}')
ON CONFLICT (id) DO UPDATE SET 
  file_size_limit = 5242880, 
  allowed_mime_types = '{image/jpeg, image/png, image/webp}',
  public = false;

-- RLS for storage.objects
-- Note: storage.objects already has RLS enabled by default in Supabase

-- PAYMENT PROOFS
CREATE POLICY "Customers can upload their own payment proofs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
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
ON storage.objects FOR SELECT
TO authenticated
USING (
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
ON storage.objects FOR SELECT
TO authenticated
USING (
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

-- VENUE ASSETS
CREATE POLICY "Staff can manage venue assets"
ON storage.objects FOR ALL
TO authenticated
USING (
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
