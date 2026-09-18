import { BookingAdminService } from '@/modules/booking/admin.service'
import { redirect } from 'next/navigation'

const STATUS_STYLES: Record<string, string> = {
  CONFIRMED: 'bg-green-100 text-green-800',
  PAYMENT_PENDING: 'bg-yellow-100 text-yellow-800',
  CANCELLED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-gray-100 text-gray-600',
  COMPLETED: 'bg-blue-100 text-blue-800',
  PAYMENT_REJECTED: 'bg-orange-100 text-orange-800',
  DRAFT: 'bg-gray-50 text-gray-500',
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
}

function formatCurrency(minor: number) {
  return `₹${(minor / 100).toFixed(2)}`
}

export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; venueId: string }>
  searchParams: Promise<{ status?: string; date?: string; page?: string }>
}) {
  const { companyId, venueId } = await params
  const sp = await searchParams
  const status = sp.status ?? ''
  const date = sp.date ?? ''
  const page = parseInt(sp.page ?? '1')

  let result: Awaited<ReturnType<typeof BookingAdminService.listBookings>> = { bookings: [], total: 0 }
  let error: string | null = null

  try {
    result = await BookingAdminService.listBookings(companyId, venueId, {
      status: status || undefined,
      date: date || undefined,
      page,
    })
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load bookings.'
    if (error.includes('Unauthorized')) redirect('/')
  }

  const { bookings, total } = result
  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)

  const statuses = ['', 'PAYMENT_PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED', 'PAYMENT_REJECTED']

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Bookings</h1>
          <p className="text-sm text-gray-500">{total} booking{total !== 1 ? 's' : ''}</p>
        </div>
        <a href={`/admin/${companyId}/venues/${venueId}/bookings/new`} className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800">
          + Manual Booking
        </a>
      </div>

      {/* Filters */}
      <form method="GET" className="flex gap-2 flex-wrap">
        <select name="status" defaultValue={status} className="px-3 py-2 border border-gray-300 rounded-md text-sm">
          <option value="">All statuses</option>
          {statuses.slice(1).map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" name="date" defaultValue={date} className="px-3 py-2 border border-gray-300 rounded-md text-sm" />
        <button type="submit" className="px-4 py-2 bg-gray-100 text-sm font-medium rounded-md hover:bg-gray-200">Filter</button>
        {(status || date) && <a href={`/admin/${companyId}/venues/${venueId}/bookings`} className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 rounded-md">Clear</a>}
      </form>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>}

      {bookings.length === 0 && !error ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500 text-sm">
          No bookings found.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {bookings.map(b => (
            <a key={b.id} href={`/admin/${companyId}/venues/${venueId}/bookings/${b.id}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <div>
                <p className="text-sm font-medium">{b.customerName ?? 'Walk-in'}</p>
                <p className="text-xs text-gray-500">{formatDateTime(b.startAt)} · {b.durationMinutes}m · {b.source}</p>
              </div>
              <div className="text-right">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[b.status] ?? 'bg-gray-100'}`}>{b.status}</span>
                <p className="text-xs text-gray-500 mt-0.5">{formatCurrency(b.grossAmountMinor)}</p>
              </div>
            </a>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 items-center justify-center">
          {page > 1 && <a href={`?page=${page - 1}&status=${status}&date=${date}`} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">← Previous</a>}
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          {page < totalPages && <a href={`?page=${page + 1}&status=${status}&date=${date}`} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Next →</a>}
        </div>
      )}
    </div>
  )
}
