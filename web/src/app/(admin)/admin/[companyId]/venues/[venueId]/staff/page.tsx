import { StaffService } from '@/modules/staff/service'
import { redirect } from 'next/navigation'

export default async function StaffPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string; venueId: string }>
  searchParams: Promise<{ page?: string }>
}) {
  const { companyId, venueId } = await params
  const sp = await searchParams
  const page = parseInt(sp.page ?? '1')

  let result: Awaited<ReturnType<typeof StaffService.listStaff>> = { staff: [], total: 0 }
  let error: string | null = null

  try {
    result = await StaffService.listStaff(companyId, venueId, { page })
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load staff.'
    if (error.includes('Unauthorized')) redirect('/')
  }

  const { staff, total } = result
  const pageSize = 20
  const totalPages = Math.ceil(total / pageSize)

  const roleColors: Record<string, string> = {
    admin: 'bg-purple-100 text-purple-800',
    manager: 'bg-blue-100 text-blue-800',
    sub_manager: 'bg-gray-100 text-gray-700',
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
          <p className="text-sm text-gray-500">{total} member{total !== 1 ? 's' : ''}</p>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 text-sm">{error}</div>}

      {staff.length === 0 && !error ? (
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center text-gray-500 text-sm">
          No staff members found.
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
          {staff.map(m => (
            <a key={m.membershipId} href={`/admin/${companyId}/venues/${venueId}/staff/${m.membershipId}`} className="flex items-center justify-between p-4 hover:bg-gray-50 transition-colors">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-gray-900">{m.fullName ?? '—'}</p>
                  {!m.isActive && <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded">Inactive</span>}
                </div>
                <p className="text-xs text-gray-500">{m.email}{m.phone ? ` · ${m.phone}` : ''}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`px-2 py-0.5 rounded text-xs font-medium ${roleColors[m.roleCode] ?? 'bg-gray-100 text-gray-600'}`}>{m.roleName}</span>
                <span className="text-xs text-gray-400">{m.venueId ? 'Venue' : 'Company-wide'}</span>
              </div>
            </a>
          ))}
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex gap-2 items-center justify-center">
          {page > 1 && <a href={`?page=${page - 1}`} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">← Previous</a>}
          <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
          {page < totalPages && <a href={`?page=${page + 1}`} className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Next →</a>}
        </div>
      )}
    </div>
  )
}
