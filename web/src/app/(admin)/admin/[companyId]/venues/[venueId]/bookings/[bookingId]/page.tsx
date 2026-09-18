import { BookingAdminService } from '@/modules/booking/admin.service'
import { redirect } from 'next/navigation'
import {
  cancelBookingAction,
  completeBookingAction,
  approveBookingAction,
  rejectBookingAction,
  recordBalancePaymentAction,
} from '@/modules/booking/admin.actions'

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatCurrency(minor: number) {
  return `₹${(minor / 100).toFixed(2)}`
}

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-800',
  PAYMENT_PENDING: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-blue-100 text-blue-800',
  PAYMENT_REJECTED: 'bg-orange-100 text-orange-800',
  DRAFT: 'bg-gray-50 text-gray-500',
}

const PAYMENT_STATUS_STYLES: Record<string, string> = {
  VERIFIED: 'bg-green-100 text-green-800',
  PENDING_VERIFICATION: 'bg-yellow-100 text-yellow-800',
  REJECTED: 'bg-red-100 text-red-800',
}

export default async function BookingDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; venueId: string; bookingId: string }>
}) {
  const { companyId, venueId, bookingId } = await params
  console.log(">> RENDERING BOOKING DETAIL PAGE:", { companyId, venueId, bookingId });

  let booking: Awaited<ReturnType<typeof BookingAdminService.getBookingDetail>> | null = null
  let error: string | null = null

  try {
    booking = await BookingAdminService.getBookingDetail(companyId, venueId, bookingId)
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load booking.'
    if (error.includes('Unauthorized')) redirect('/')
  }

  if (!booking) {
    return <div className="text-red-600 text-sm">{error ?? 'Booking not found.'}</div>
  }

  const canCancel = ['PAYMENT_PENDING', 'CONFIRMED'].includes(booking.status)
  const canComplete = booking.status === 'CONFIRMED'
  const pendingPayment = booking.payments.find(p => p.status === 'PENDING_VERIFICATION')
  const canApprove = !!pendingPayment && booking.status === 'PAYMENT_PENDING'
  const canRecordBalance = booking.status === 'CONFIRMED' && booking.balanceDueMinor > 0

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <a href={`/admin/${companyId}/venues/${venueId}/bookings`} className="hover:underline">Bookings</a>
        <span>›</span>
        <span>{bookingId.slice(0, 8)}…</span>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Booking Detail</h1>
          <p className="text-sm text-gray-500">{booking.source} · {formatDateTime(booking.startAt)}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[booking.status] ?? 'bg-gray-100'}`}>{booking.status}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Booking info */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold">Booking</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">Customer</dt><dd>{booking.customerName ?? 'Walk-in'}{booking.customerEmail ? ` (${booking.customerEmail})` : ''}</dd></div>
            <div><dt className="text-gray-500">Field</dt><dd>{booking.fieldId}</dd></div>
            <div><dt className="text-gray-500">Start</dt><dd className="font-medium">{formatDateTime(booking.startAt)}</dd></div>
            <div><dt className="text-gray-500">End</dt><dd>{formatDateTime(booking.endAt)}</dd></div>
            <div><dt className="text-gray-500">Duration</dt><dd>{booking.durationMinutes} minutes</dd></div>
            <div><dt className="text-gray-500">Created at</dt><dd>{formatDateTime(booking.createdAt)}</dd></div>
            {booking.expiresAt && <div><dt className="text-gray-500">Expires at</dt><dd>{formatDateTime(booking.expiresAt)}</dd></div>}
            {booking.cancellationReason && <div><dt className="text-gray-500">Cancellation reason</dt><dd className="text-red-700">{booking.cancellationReason}</dd></div>}
          </dl>
        </div>

        {/* Financial summary */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold">Financials</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">Gross Booking Value</dt><dd className="font-medium">{formatCurrency(booking.grossAmountMinor)}</dd></div>
            <div><dt className="text-gray-500">Advance Required</dt><dd>{formatCurrency(booking.advanceRequiredMinor)}</dd></div>
            <div><dt className="text-gray-500">Balance Due</dt><dd className={booking.balanceDueMinor > 0 ? 'text-yellow-700 font-medium' : 'text-green-700'}>{formatCurrency(booking.balanceDueMinor)}</dd></div>
          </dl>
          <p className="text-xs text-gray-400">Gross Booking Value ≠ Verified Collections. Check payment records below.</p>
        </div>
      </div>

      {/* Operations */}
      {(canCancel || canComplete || canApprove || canRecordBalance) && (
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
          <h2 className="text-base font-semibold">Operations</h2>
          <div className="flex flex-wrap gap-3">
            {canApprove && pendingPayment && (
              <form action={async () => {
                'use server'
                await approveBookingAction(bookingId, pendingPayment.id)
              }}>
                <button type="submit" className="px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-md hover:bg-green-800">
                  ✓ Approve Payment
                </button>
              </form>
            )}
            {canApprove && pendingPayment && (
              <form action={async (fd: FormData) => {
                'use server'
                await rejectBookingAction(bookingId, pendingPayment.id, fd.get('reason') as string || 'Rejected by staff.')
              }} className="flex gap-2">
                <input type="text" name="reason" placeholder="Rejection reason" className="px-3 py-2 border border-gray-300 rounded-md text-sm" />
                <button type="submit" className="px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-md hover:bg-orange-700">
                  ✕ Reject Payment
                </button>
              </form>
            )}
            {canComplete && (
              <form action={async () => {
                'use server'
                await completeBookingAction(companyId, venueId, bookingId)
              }}>
                <button type="submit" className="px-4 py-2 bg-blue-700 text-white text-sm font-medium rounded-md hover:bg-blue-800">
                  Mark Completed
                </button>
              </form>
            )}
            {canCancel && (
              <form action={async (fd: FormData) => {
                'use server'
                await cancelBookingAction(companyId, venueId, bookingId, fd.get('reason') as string || 'Cancelled by staff.')
              }} className="flex gap-2">
                <input type="text" name="reason" placeholder="Cancellation reason" className="px-3 py-2 border border-gray-300 rounded-md text-sm" />
                <button type="submit" className="px-4 py-2 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800">
                  Cancel Booking
                </button>
              </form>
            )}
          </div>

          {canRecordBalance && (
            <div className="border-t border-gray-100 pt-5">
              <h3 className="text-sm font-medium mb-3">Record Balance Payment</h3>
              <p className="text-xs text-gray-500 mb-3">V1 Note: &quot;Other Offline&quot; maps to database value <code>OTHER</code>.</p>
              <form action={async (fd: FormData) => {
                'use server'
                const amountRupees = parseFloat(fd.get('amountRupees') as string)
                if (isNaN(amountRupees) || amountRupees <= 0) throw new Error('Invalid amount.')
                await recordBalancePaymentAction(companyId, venueId, bookingId, {
                  paymentMethod: fd.get('paymentMethod') as 'CASH' | 'UPI_MANUAL' | 'OTHER',
                  amountMinor: Math.round(amountRupees * 100),
                  transactionReference: (fd.get('transactionReference') as string) || undefined,
                })
              }} className="flex flex-wrap gap-2 items-end">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Amount (₹)</label>
                  <input type="number" name="amountRupees" step="0.01" min="0.01" required placeholder="e.g. 500.00" className="w-28 px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Method</label>
                  <select name="paymentMethod" className="px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="CASH">Cash</option>
                    <option value="UPI_MANUAL">UPI Manual</option>
                    <option value="OTHER">Other Offline</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Reference (optional)</label>
                  <input type="text" name="transactionReference" placeholder="UTR / reference" className="w-36 px-3 py-2 border border-gray-300 rounded-md text-sm" />
                </div>
                <button type="submit" className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800">
                  Record Payment
                </button>
              </form>
            </div>
          )}
        </div>
      )}

      {/* Payments */}
      <div>
        <h2 className="text-base font-semibold mb-3">Payment History ({booking.payments.length})</h2>
        {booking.payments.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">No payments recorded.</div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {booking.payments.map(p => (
              <div key={p.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{formatCurrency(p.amountMinor)} · {p.paymentMethod} · {p.paymentType}</p>
                  <p className="text-xs text-gray-500">Submitted {formatDateTime(p.submittedAt)}{p.transactionReference ? ` · Ref: ${p.transactionReference}` : ''}</p>
                  {p.verifiedAt && <p className="text-xs text-gray-400">Verified {formatDateTime(p.verifiedAt)}</p>}
                </div>
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${PAYMENT_STATUS_STYLES[p.status] ?? 'bg-gray-100'}`}>{p.status}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
