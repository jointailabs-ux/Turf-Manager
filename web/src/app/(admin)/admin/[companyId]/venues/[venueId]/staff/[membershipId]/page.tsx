import { StaffService } from '@/modules/staff/service'
import { redirect } from 'next/navigation'
import { updateMembershipRoleAction, setMembershipActiveAction, revokeMembershipAction } from '@/modules/staff/admin.actions'

export default async function StaffDetailPage({
  params,
}: {
  params: Promise<{ companyId: string; venueId: string; membershipId: string }>
}) {
  const { companyId, venueId, membershipId } = await params

  let member: Awaited<ReturnType<typeof StaffService.getStaffDetail>> | null = null
  let roles: Awaited<ReturnType<typeof StaffService.listRoles>> = []
  let error: string | null = null

  try {
    ;[member, roles] = await Promise.all([
      StaffService.getStaffDetail(companyId, venueId, membershipId),
      StaffService.listRoles(),
    ])
  } catch (err) {
    error = err instanceof Error ? err.message : 'Failed to load staff member.'
    if (error.includes('Unauthorized')) redirect('/')
  }

  if (!member) {
    return <div className="text-red-600 text-sm">{error ?? 'Staff member not found.'}</div>
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <a href={`/admin/${companyId}/venues/${venueId}/staff`} className="hover:underline">Staff</a>
        <span>›</span>
        <span>{member.fullName ?? member.email}</span>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Profile */}
        <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
          <h2 className="text-base font-semibold">Member Details</h2>
          <dl className="space-y-2 text-sm">
            <div><dt className="text-gray-500">Name</dt><dd className="font-medium">{member.fullName ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Email</dt><dd>{member.email}</dd></div>
            <div><dt className="text-gray-500">Phone</dt><dd>{member.phone ?? '—'}</dd></div>
            <div><dt className="text-gray-500">Role</dt><dd className="font-medium">{member.roleName} ({member.roleCode})</dd></div>
            <div><dt className="text-gray-500">Scope</dt><dd>{member.venueId ? 'Venue-specific' : 'Company-wide'}</dd></div>
            <div>
              <dt className="text-gray-500">Status</dt>
              <dd className={member.isActive ? 'text-green-700 font-medium' : 'text-red-600 font-medium'}>
                {member.isActive ? 'Active' : 'Inactive'}
              </dd>
            </div>
          </dl>
        </div>

        {/* Actions */}
        <div className="space-y-4">
          {/* Change role */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <h2 className="text-base font-semibold">Change Role</h2>
            <p className="text-xs text-gray-500">Anti-escalation enforced: you can only grant roles below your own level.</p>
            <form action={async (fd: FormData) => {
              'use server'
              await updateMembershipRoleAction(companyId, venueId, membershipId, fd.get('roleId') as string)
            }} className="flex gap-2">
              <select name="roleId" defaultValue={member.roleId} className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm">
                {roles.map(r => (
                  <option key={r.id} value={r.id}>{r.name} ({r.code})</option>
                ))}
              </select>
              <button type="submit" className="px-4 py-2 bg-black text-white text-sm font-medium rounded-md hover:bg-gray-800">
                Update
              </button>
            </form>
          </div>

          {/* Activate / Deactivate */}
          <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-3">
            <h2 className="text-base font-semibold">Membership Status</h2>
            <p className="text-xs text-gray-500">Deactivated members lose all access immediately. All subsequent server checks will reject their requests.</p>
            <div className="flex gap-2">
              {!member.isActive && (
                <form action={async () => {
                  'use server'
                  await setMembershipActiveAction(companyId, venueId, membershipId, true)
                }}>
                  <button type="submit" className="px-4 py-2 bg-green-700 text-white text-sm font-medium rounded-md hover:bg-green-800">
                    Activate
                  </button>
                </form>
              )}
              {member.isActive && (
                <form action={async () => {
                  'use server'
                  await setMembershipActiveAction(companyId, venueId, membershipId, false)
                }}>
                  <button type="submit" className="px-4 py-2 bg-yellow-600 text-white text-sm font-medium rounded-md hover:bg-yellow-700">
                    Deactivate
                  </button>
                </form>
              )}
              <form action={async () => {
                'use server'
                await revokeMembershipAction(companyId, venueId, membershipId)
                redirect(`/admin/${companyId}/venues/${venueId}/staff`)
              }}>
                <button type="submit" className="px-4 py-2 bg-red-700 text-white text-sm font-medium rounded-md hover:bg-red-800">
                  Revoke Access
                </button>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
