'use server'

import { DashboardService } from './service'

export async function getTodaySummaryAction(
  companyId: string,
  venueId: string,
  date: string,
  timezone: string
) {
  try {
    return await DashboardService.getTodaySummary(companyId, venueId, date, timezone)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch dashboard summary.')
  }
}

export async function getRevenueSummaryAction(
  companyId: string,
  venueId: string,
  period: 'weekly' | 'monthly'
) {
  try {
    return await DashboardService.getRevenueSummary(companyId, venueId, period)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch revenue summary.')
  }
}

export async function getPendingPaymentQueueAction(
  companyId: string,
  venueId: string,
  options: { page?: number } = {}
) {
  try {
    return await DashboardService.getPendingPaymentQueue(companyId, venueId, options)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch payment queue.')
  }
}

export async function getTodayBookingListAction(
  companyId: string,
  venueId: string,
  date: string,
  options: { page?: number } = {}
) {
  try {
    return await DashboardService.getTodayBookingList(companyId, venueId, date, options)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch today\'s bookings.')
  }
}

export async function getFieldCalendarAction(
  companyId: string,
  venueId: string,
  fieldId: string,
  date: string
) {
  try {
    return await DashboardService.getFieldCalendar(companyId, venueId, fieldId, date)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : 'Failed to fetch field calendar.')
  }
}
