import { AuditService } from '@/modules/audit/service'
import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

function formatDate(iso: string) {
  return new Date(iso).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })
}

export default async function AuditPage({
  params,
  searchParams
}: {
  params: Promise<{ companyId: string; venueId: string }>
  searchParams: Promise<{ page?: string; eventType?: string; entityType?: string }>
}) {
  const { companyId, venueId } = await params
  const { page = '1', eventType, entityType } = await searchParams

  const pageNum = parseInt(page, 10) || 1
  const pageSize = 50

  let auditData: Awaited<ReturnType<typeof AuditService.getAuditLogs>> | null = null
  let error: string | null = null

  try {
    auditData = await AuditService.getAuditLogs(companyId, venueId, {
      page: pageNum,
      pageSize,
      eventType,
      entityType
    })
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load audit logs.'
    if (error.includes('Unauthorized')) redirect(`/admin/${companyId}/venues/${venueId}/dashboard`)
  }

  if (error || !auditData) {
    return <div className="p-6 text-red-600 bg-red-50 border border-red-200 rounded">{error}</div>
  }

  const { items, total } = auditData
  const totalPages = Math.ceil(total / pageSize)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Audit History</h1>
      </div>

      {/* Filters (Server-driven via query params) */}
      <form className="bg-white border border-gray-200 rounded-lg p-4 flex gap-4 items-end">
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Event Type</label>
          <input type="text" name="eventType" defaultValue={eventType || ''} placeholder="e.g. BOOKING_CREATED" className="px-3 py-1.5 border border-gray-300 rounded text-sm w-48" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-700 mb-1">Entity Type</label>
          <input type="text" name="entityType" defaultValue={entityType || ''} placeholder="e.g. booking" className="px-3 py-1.5 border border-gray-300 rounded text-sm w-48" />
        </div>
        <button type="submit" className="px-4 py-1.5 bg-black text-white text-sm font-medium rounded hover:bg-gray-800">
          Filter
        </button>
        {(eventType || entityType) && (
          <a href={`/admin/${companyId}/venues/${venueId}/audit`} className="px-4 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded">
            Clear
          </a>
        )}
      </form>

      <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
        <table className="w-full text-left text-sm whitespace-nowrap">
          <thead className="bg-gray-50 border-b border-gray-200 text-gray-500 font-medium">
            <tr>
              <th className="px-4 py-3">Timestamp</th>
              <th className="px-4 py-3">Actor</th>
              <th className="px-4 py-3">Event Type</th>
              <th className="px-4 py-3">Entity Type</th>
              <th className="px-4 py-3">Entity ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {items.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-500">No audit logs found.</td></tr>
            ) : (
              items.map((log) => (
                <tr key={log.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-500">{formatDate(log.createdAt)}</td>
                  <td className="px-4 py-3 font-medium">{log.actorName}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded text-xs">{log.eventType}</span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{log.entityType}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">{log.entityId ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center bg-white p-4 border border-gray-200 rounded-lg text-sm">
          <a
            href={pageNum > 1 ? `?page=${pageNum - 1}&eventType=${eventType||''}&entityType=${entityType||''}` : '#'}
            className={`px-3 py-1.5 rounded border ${pageNum === 1 ? 'text-gray-400 border-gray-100 cursor-not-allowed' : 'hover:bg-gray-50'}`}
          >
            Previous
          </a>
          <span className="text-gray-500">Page {pageNum} of {totalPages}</span>
          <a
            href={pageNum < totalPages ? `?page=${pageNum + 1}&eventType=${eventType||''}&entityType=${entityType||''}` : '#'}
            className={`px-3 py-1.5 rounded border ${pageNum === totalPages ? 'text-gray-400 border-gray-100 cursor-not-allowed' : 'hover:bg-gray-50'}`}
          >
            Next
          </a>
        </div>
      )}
    </div>
  )
}
