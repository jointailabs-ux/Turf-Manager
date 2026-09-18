import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardService } from '@/modules/dashboard/service'

function formatCurrency(minor: number): string {
  return `₹${(minor / 100).toFixed(2)}`
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; venueId: string }>
  searchParams: Promise<{ date?: string }>
}) {
  const { companyId, venueId } = await params
  const sp = await searchParams
  const today = sp.date ?? new Date().toISOString().split('T')[0]

  const supabase = await createClient()
  const { data: venue } = await supabase.from('venues').select('name, timezone').eq('id', venueId).eq('company_id', companyId).single()
  if (!venue) redirect('/')

  let summary = null
  let revenueWeekly = null
  let revenueMonthly = null
  let pendingQueue = null
  let todayBookings = null
  let summaryError: string | null = null

  try {
    ;[summary, revenueWeekly, revenueMonthly, pendingQueue, todayBookings] = await Promise.all([
      DashboardService.getTodaySummary(companyId, venueId, today, venue.timezone),
      DashboardService.getRevenueSummary(companyId, venueId, 'weekly'),
      DashboardService.getRevenueSummary(companyId, venueId, 'monthly'),
      DashboardService.getPendingPaymentQueue(companyId, venueId, { pageSize: 10 }),
      DashboardService.getTodayBookingList(companyId, venueId, today, { pageSize: 20 }),
    ])
  } catch (err) {
    summaryError = err instanceof Error ? err.message : 'Failed to load dashboard.'
  }

  const statusColors: Record<string, string> = {
    CONFIRMED: 'bg-green-100 text-green-800',
    PAYMENT_PENDING: 'bg-yellow-100 text-yellow-800',
    CANCELLED: 'bg-red-100 text-red-800',
    EXPIRED: 'bg-gray-100 text-gray-700',
    COMPLETED: 'bg-blue-100 text-blue-800',
    PAYMENT_REJECTED: 'bg-orange-100 text-orange-800',
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-gray-500">{venue.name} — {today}</p>
        </div>
        <form method="GET" className="flex gap-2 items-center">
          <input type="date" name="date" defaultValue={today} className="px-3 py-1.5 border border-gray-300 rounded-md text-sm" />
          <button type="submit" className="px-4 py-1.5 bg-black text-white text-sm rounded-md hover:bg-gray-800">Filter</button>
        </form>
      </div>

      {summaryError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{summaryError}</div>
      )}

      {summary && (
        <>
          {/* Today metrics */}
          <div>
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Today — {today}</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Total Bookings', value: summary.totalBookings, color: 'text-gray-900' },
                { label: 'Confirmed', value: summary.confirmedCount, color: 'text-green-700' },
                { label: 'Pending Payment', value: summary.pendingCount, color: 'text-yellow-700' },
                { label: 'Cancelled', value: summary.cancelledCount, color: 'text-red-700' },
                { label: 'Expired', value: summary.expiredCount, color: 'text-gray-500' },
                { label: 'Completed', value: summary.completedCount, color: 'text-blue-700' },
                { label: 'Gross Booking Value', value: formatCurrency(summary.grossValueMinor), color: 'text-gray-900' },
                { label: 'Verified Advance Collected', value: formatCurrency(summary.verifiedAdvanceMinor), color: 'text-green-700' },
              ].map(card => (
                <div key={card.label} className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">{card.label}</p>
                  <p className={`text-2xl font-bold ${card.color}`}>{card.value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Revenue */}
          {revenueWeekly && revenueMonthly && (
            <div>
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Revenue Period</h2>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Last 7 Days — Gross Booking Value</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(revenueWeekly.grossValueMinor)}</p>
                  <p className="text-xs text-gray-400 mt-1">{revenueWeekly.confirmedCount + revenueWeekly.completedCount} bookings (confirmed + completed)</p>
                </div>
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <p className="text-xs text-gray-500 mb-1">Last 30 Days — Gross Booking Value</p>
                  <p className="text-2xl font-bold text-gray-900">{formatCurrency(revenueMonthly.grossValueMinor)}</p>
                  <p className="text-xs text-gray-400 mt-1">{revenueMonthly.confirmedCount + revenueMonthly.completedCount} bookings (confirmed + completed)</p>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Pending Approval Queue */}
      {pendingQueue && pendingQueue.items.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Pending Payment Approval ({pendingQueue.total})
          </h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {pendingQueue.items.map(item => (
              <div key={item.paymentId} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{item.customerName ?? 'Walk-in'}</p>
                  <p className="text-xs text-gray-500">{formatCurrency(item.amountMinor)} via {item.paymentMethod} · {formatDate(item.submittedAt)}</p>
                </div>
                <a href={`/admin/${companyId}/venues/${venueId}/bookings/${item.bookingId}`} className="px-3 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-md hover:bg-yellow-200">
                  Review
                </a>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's booking list */}
      {todayBookings && todayBookings.bookings.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">Today&apos;s Bookings ({todayBookings.total})</h2>
          <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
            {todayBookings.bookings.map(b => (
              <div key={b.id} className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{b.customerName ?? 'Walk-in'} · <span className="text-gray-500">{formatDate(b.startAt)} – {formatDate(b.endAt)}</span></p>
                  <p className="text-xs text-gray-400">{b.source} · {formatCurrency(b.grossAmountMinor)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColors[b.status] ?? 'bg-gray-100'}`}>{b.status}</span>
                  <a href={`/admin/${companyId}/venues/${venueId}/bookings/${b.id}`} className="text-xs text-blue-600 hover:underline">View</a>
                </div>
              </div>
            ))}
          </div>
          {todayBookings.total > 20 && (
            <p className="text-xs text-gray-400 mt-2">Showing 20 of {todayBookings.total}. <a href={`/admin/${companyId}/venues/${venueId}/bookings?date=${today}`} className="underline">View all</a></p>
          )}
        </div>
      )}

      {todayBookings && todayBookings.bookings.length === 0 && summary && summary.totalBookings === 0 && (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500 text-sm">
          No bookings for {today}.
        </div>
      )}
    </div>
  )
}
