import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

export default async function BookingDetailPage({
  params
}: {
  params: Promise<{ bookingId: string }>
}) {
  const { bookingId } = await params
  const supabase = await createClient()

  const { data: booking, error } = await supabase
    .from('bookings')
    .select('id, status, start_at, end_at, duration_minutes, gross_amount_minor, advance_required_minor, balance_due_minor, fields(name, venues(name, address)), payments(id, status, amount_minor, submitted_at, rejection_reason)')
    .eq('id', bookingId)
    .single()
    
  if (error) {
    console.error('Fetch booking detail error:', error)
  }

  if (!booking) redirect('/account/bookings')

  const bookingFields = booking.fields as unknown as { name: string, venues: { name: string, address: string } }

  return (
    <div className="max-w-2xl mx-auto p-4 md:p-8 space-y-6">
      <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
        <h1 className="text-2xl font-bold mb-1">Booking Details</h1>
        <p className="text-gray-500 text-sm mb-6">Booking ID: {booking.id}</p>
        
        <div className="grid grid-cols-2 gap-4 text-sm mb-6">
          <div>
            <p className="text-gray-500 font-medium">Venue</p>
            <p className="font-semibold">{bookingFields?.venues?.name}</p>
            <p className="text-gray-500 text-xs">{bookingFields?.venues?.address}</p>
          </div>
          <div>
            <p className="text-gray-500 font-medium">Field</p>
            <p className="font-semibold">{bookingFields?.name}</p>
          </div>
          <div>
            <p className="text-gray-500 font-medium">Date & Time</p>
            <p className="font-semibold">{format(new Date(booking.start_at), 'PPP')}</p>
            <p>{format(new Date(booking.start_at), 'p')} - {format(new Date(booking.end_at), 'p')}</p>
          </div>
          <div>
            <p className="text-gray-500 font-medium">Status</p>
            <p className="font-bold">{booking.status}</p>
          </div>
        </div>

        <div className="border-t pt-4">
          <h2 className="text-lg font-bold mb-4">Financials</h2>
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Total Amount</span>
            <span>₹{(booking.gross_amount_minor / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between mb-2">
            <span className="text-gray-600">Advance Paid / Required</span>
            <span>₹{(booking.advance_required_minor / 100).toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg mt-4 border-t pt-4">
            <span>Balance Due at Venue</span>
            <span>₹{(booking.balance_due_minor / 100).toFixed(2)}</span>
          </div>
        </div>
      </div>

      {booking.payments && booking.payments.length > 0 && (
        <div className="bg-white p-6 rounded-lg border border-gray-200 shadow-sm">
          <h2 className="text-lg font-bold mb-4">Payment History</h2>
          <div className="space-y-4">
            {booking.payments.map((p: unknown) => {
              const pay = p as { id: string, amount_minor: number, submitted_at: string, status: string, rejection_reason?: string }
              return (
              <div key={pay.id} className="border-l-4 border-gray-200 pl-4 py-2">
                <div className="flex justify-between">
                  <p className="font-medium text-sm">₹{(pay.amount_minor / 100).toFixed(2)}</p>
                  <p className="text-xs text-gray-500">{format(new Date(pay.submitted_at), 'PPP p')}</p>
                </div>
                <p className="text-sm mt-1 font-semibold">{pay.status}</p>
                {pay.status === 'REJECTED' && pay.rejection_reason && (
                  <p className="text-sm text-red-600 mt-1">Reason: {pay.rejection_reason}</p>
                )}
              </div>
            )})}
          </div>
        </div>
      )}
    </div>
  )
}
