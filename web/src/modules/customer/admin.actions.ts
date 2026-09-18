'use server'

import { CustomerService } from './service'

export async function listCustomersAction(
  companyId: string,
  venueId: string,
  options: { page?: number; search?: string } = {}
) {
  try {
    return await CustomerService.listCustomers(companyId, venueId, options)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to list customers.')
  }
}

export async function getCustomerDetailAction(
  companyId: string,
  venueId: string,
  customerId: string
) {
  try {
    return await CustomerService.getCustomerDetail(companyId, venueId, customerId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch customer.')
  }
}

export async function createCustomerAction(
  companyId: string,
  venueId: string,
  data: { email: string; fullName: string; phone?: string }
) {
  try {
    return await CustomerService.createCustomer(companyId, venueId, data)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to create customer.')
  }
}

export async function updateCustomerAction(
  companyId: string,
  venueId: string,
  customerId: string,
  data: { fullName?: string; phone?: string }
) {
  try {
    await CustomerService.updateCustomer(companyId, venueId, customerId, data)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to update customer.')
  }
}

export async function searchCustomersAction(
  companyId: string,
  venueId: string,
  search: string
) {
  try {
    return await CustomerService.searchCustomers(companyId, venueId, search)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to search customers.')
  }
}
