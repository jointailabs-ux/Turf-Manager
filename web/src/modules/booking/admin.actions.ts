'use server'

import { BookingAdminService } from './admin.service'
import { BookingService } from './service'
import type { StaffPaymentMethod } from './admin.service'
import { revalidatePath } from 'next/cache'

export async function listBookingsAction(
  companyId: string,
  venueId: string,
  filters: { status?: string; date?: string; fieldId?: string; page?: number } = {}
) {
  try {
    return await BookingAdminService.listBookings(companyId, venueId, filters)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to list bookings.')
  }
}

export async function getBookingDetailAction(
  companyId: string,
  venueId: string,
  bookingId: string
) {
  try {
    return await BookingAdminService.getBookingDetail(companyId, venueId, bookingId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch booking.')
  }
}

export async function cancelBookingAction(
  companyId: string,
  venueId: string,
  bookingId: string,
  reason: string
) {
  try {
    await BookingAdminService.cancelBooking(companyId, venueId, bookingId, reason)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to cancel booking.')
  }
}

export async function completeBookingAction(
  companyId: string,
  venueId: string,
  bookingId: string
) {
  try {
    await BookingAdminService.completeBooking(companyId, venueId, bookingId)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to complete booking.')
  }
}

export async function createManualBookingAction(
  companyId: string,
  venueId: string,
  request: {
    fieldId: string
    customerId?: string
    source: 'WALK_IN' | 'PHONE'
    startAt: string
    durationMinutes: number
    idempotencyKey: string
  }
) {
  try {
    return await BookingAdminService.createManualBooking(companyId, venueId, request)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to create manual booking.')
  }
}

export async function submitStaffPaymentAction(
  companyId: string,
  venueId: string,
  bookingId: string,
  data: { paymentMethod: StaffPaymentMethod; amountMinor: number; transactionReference?: string }
) {
  try {
    return await BookingAdminService.submitStaffPayment(companyId, venueId, bookingId, data)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to submit staff payment.')
  }
}

export async function recordBalancePaymentAction(
  companyId: string,
  venueId: string,
  bookingId: string,
  data: { paymentMethod: StaffPaymentMethod; amountMinor: number; transactionReference?: string }
) {
  try {
    return await BookingAdminService.recordBalancePayment(companyId, venueId, bookingId, data)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to record balance payment.')
  }
}

export async function approveBookingAction(bookingId: string, paymentId: string) {
  try {
    await BookingService.approveBooking(bookingId, paymentId)
    revalidatePath('/admin', 'layout')
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to approve booking.')
  }
}

export async function rejectBookingAction(bookingId: string, paymentId: string, reason: string) {
  try {
    await BookingService.rejectBooking(bookingId, paymentId, reason)
    revalidatePath('/admin', 'layout')
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to reject booking.')
  }
}
