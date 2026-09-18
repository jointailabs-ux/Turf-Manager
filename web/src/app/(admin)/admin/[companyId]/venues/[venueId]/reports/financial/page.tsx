import { ReportService } from '@/modules/report/service'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

function formatCurrency(minor: number) {
  return `₹${(minor / 100).toFixed(2)}`
}

export default async function FinancialReportPage({
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

  let reportData: Awaited<ReturnType<typeof ReportService.getFinancialReport>> | null = null
  let error: string | null = null

  try {
    reportData = await ReportService.getFinancialReport({
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

  const { totalGrossValueMinor, verifiedCollectionsAdvanceMinor, remainingBalanceDueMinor } = reportData

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm">
          <h3 className="text-sm font-medium text-gray-500">Gross Booking Value</h3>
          <p className="mt-2 text-3xl font-bold">{formatCurrency(totalGrossValueMinor)}</p>
        </div>
        <div className="bg-white p-6 border border-green-200 rounded-lg shadow-sm bg-green-50">
          <h3 className="text-sm font-medium text-green-800">Verified Collections (Advance)</h3>
          <p className="mt-2 text-3xl font-bold text-green-900">{formatCurrency(verifiedCollectionsAdvanceMinor)}</p>
        </div>
        <div className="bg-white p-6 border border-yellow-200 rounded-lg shadow-sm bg-yellow-50">
          <h3 className="text-sm font-medium text-yellow-800">Remaining Balance Due</h3>
          <p className="mt-2 text-3xl font-bold text-yellow-900">{formatCurrency(remainingBalanceDueMinor)}</p>
        </div>
      </div>
    </div>
  )
}
