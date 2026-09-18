import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { ClientCheckoutForm } from './ClientCheckoutForm'
import { StorageService } from '@/modules/storage/service'

export default async function CheckoutPage({
  params
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = await params
  const supabase = await createClient()

  const { createClient: createAdminClient } = await import('@supabase/supabase-js')
  const adminClient = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )

  // Fetch Booking
  const { data: booking, error } = await adminClient
    .from('bookings')
    .select('id, status, expires_at, advance_required_minor, gross_amount_minor, company_id, venue_id, customers(profile_id)')
    .eq('id', bookingId)
    .single()
  
  if (error) {
    console.error('Checkout fetch error:', error)
  }

  if (!booking) redirect('/')

  // Fetch Venue Payment Accounts
  const { data: accounts } = await adminClient
    .from('payment_accounts')
    .select('id, display_name, upi_id, qr_object_path')
    .eq('company_id', booking.company_id)
    .eq('is_active', true)
    .or(`venue_id.eq.${booking.venue_id},venue_id.is.null`)

  // Pre-generate QR URLs using service role
  const accountsWithQrs = await Promise.all((accounts || []).map(async (acc) => {
    let qrUrl = null
    if (acc.qr_object_path) {
      qrUrl = await StorageService.getVenueAssetSignedUrl(acc.id)
    }
    return { ...acc, qrUrl }
  }))

  const isExpired = new Date(booking.expires_at) <= new Date()
  const canPay = booking.status === 'PAYMENT_PENDING' && !isExpired

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h1 className="text-2xl font-bold mb-2">Checkout</h1>
        <div className="flex justify-between border-b pb-4 mb-4">
          <span className="text-gray-500">Total Amount</span>
          <span className="font-medium">₹{(booking.gross_amount_minor / 100).toFixed(2)}</span>
        </div>
        <div className="flex justify-between font-bold text-lg">
          <span>Advance Required</span>
          <span>₹{(booking.advance_required_minor / 100).toFixed(2)}</span>
        </div>
      </div>

      {!canPay && (
        <div className="p-4 bg-red-50 text-red-800 rounded-md">
          {booking.status !== 'PAYMENT_PENDING' ? `Booking is currently: ${booking.status}` : 'This booking has expired. Please create a new booking.'}
        </div>
      )}

      {canPay && (
        <ClientCheckoutForm 
          bookingId={booking.id} 
          advanceRequired={booking.advance_required_minor}
          paymentAccounts={accountsWithQrs} 
        />
      )}
    </div>
  )
}
