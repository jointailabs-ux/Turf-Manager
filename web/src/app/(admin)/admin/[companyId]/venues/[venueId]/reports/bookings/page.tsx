import { ReportService } from '@/modules/report/service'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function BookingReportPage({
  params,
  searchParams
}: {
  params: Promise<{ companyId: string; venueId: string }>
  searchParams: Promise<{ start?: string; end?: string; fieldId?: string }>
}) {
  const { companyId, venueId } = await params
  const { start, end, fieldId } = await searchParams

  const today = new Date().toISOString().split('T')[0]
  const startDate = start || `${today}T00:00:00.000Z`
  const endDate = end || `${today}T23:59:59.999Z`

  let reportData: Awaited<ReturnType<typeof ReportService.getBookingReport>> | null = null
  let error: string | null = null

  try {
    reportData = await ReportService.getBookingReport({
      companyId,
      venueId,
      startDate,
      endDate,
      fieldId
    })
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load report.'
    if (error.includes('Unauthorized')) redirect(`/admin/${companyId}/venues/${venueId}/dashboard`)
  }

  if (error || !reportData) {
    return <div className="p-6 text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>
  }

  const { totalBookings, totalDurationMinutes, byStatus } = reportData

  return (
    <div className="space-y-6 mt-6">
      {/* Filters */}
      <form className="bg-white border border-gray-200 rounded-lg p-4 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Start Date (ISO)</label>
          <input type="text" name="start" defaultValue={startDate} className="px-3 py-1.5 border border-gray-300 rounded text-sm w-48" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">End Date (ISO)</label>
          <input type="text" name="end" defaultValue={endDate} className="px-3 py-1.5 border border-gray-300 rounded text-sm w-48" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Field ID</label>
          <input type="text" name="fieldId" defaultValue={fieldId || ''} className="px-3 py-1.5 border border-gray-300 rounded text-sm w-48" placeholder="All Fields" />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-black text-white text-sm font-medium rounded hover:bg-gray-800">
          Apply
        </button>
      </form>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Total Bookings</h3>
          <p className="mt-2 text-3xl font-bold">{totalBookings}</p>
        </div>
        <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Total Duration (Hours)</h3>
          <p className="mt-2 text-3xl font-bold">{(totalDurationMinutes / 60).toFixed(1)}</p>
        </div>
      </div>

      {/* By Status */}
      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
          <h3 className="text-sm font-semibold">Bookings by Status</h3>
        </div>
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
            <tr>
              <th className="px-6 py-3">Status</th>
              <th className="px-6 py-3 text-right">Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Object.entries(byStatus).map(([status, count]) => (
              <tr key={status} className="hover:bg-gray-50">
                <td className="px-6 py-3 font-medium">{status}</td>
                <td className="px-6 py-3 text-right">{count}</td>
              </tr>
            ))}
            {Object.keys(byStatus).length === 0 && (
              <tr><td colSpan={2} className="px-6 py-6 text-center text-gray-500">No data for selected period.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
