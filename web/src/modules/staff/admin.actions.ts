'use server'

import { StaffService } from './service'

export async function listStaffAction(
  companyId: string,
  venueId: string,
  options: { page?: number } = {}
) {
  try {
    return await StaffService.listStaff(companyId, venueId, options)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to list staff.')
  }
}

export async function getStaffDetailAction(
  companyId: string,
  venueId: string,
  membershipId: string
) {
  try {
    return await StaffService.getStaffDetail(companyId, venueId, membershipId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch staff member.')
  }
}

export async function addStaffMembershipAction(
  companyId: string,
  venueId: string | null,
  targetProfileId: string,
  roleId: string
) {
  try {
    return await StaffService.addStaffMembership(companyId, venueId, targetProfileId, roleId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to add staff membership.')
  }
}

export async function updateMembershipRoleAction(
  companyId: string,
  venueId: string,
  membershipId: string,
  newRoleId: string
) {
  try {
    await StaffService.updateMembershipRole(companyId, venueId, membershipId, newRoleId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to update staff role.')
  }
}

export async function setMembershipActiveAction(
  companyId: string,
  venueId: string,
  membershipId: string,
  isActive: boolean
) {
  try {
    await StaffService.setMembershipActive(companyId, venueId, membershipId, isActive)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to update membership status.')
  }
}

export async function revokeMembershipAction(
  companyId: string,
  venueId: string,
  membershipId: string
) {
  try {
    await StaffService.revokeMembership(companyId, venueId, membershipId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to revoke membership.')
  }
}

export async function listRolesAction() {
  try {
    return await StaffService.listRoles()
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch roles.')
  }
}
