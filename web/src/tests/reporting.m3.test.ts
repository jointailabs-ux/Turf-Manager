import { describe, it, expect, beforeAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { ReportService } from '../modules/report/service'
import { AuthService } from '../modules/auth/service'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'http://127.0.0.1:54321'
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon_key_placeholder'
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service_role_key_placeholder'

let adminClient: any
let isDbAvailable = false

try {
  const res = await fetch(`${supabaseUrl}/rest/v1/`).catch(() => null)
  isDbAvailable = !!res
} catch {
  isDbAvailable = false
}

if (isDbAvailable) {
  adminClient = createClient<any>(supabaseUrl, supabaseServiceKey)
}

describe.skipIf(!isDbAvailable)('Milestone 3 — Reporting & Financial Calculations Suite', { timeout: 30000 }, () => {
  let companyId: string
  let venueId: string
  let otherCompanyId: string
  let otherVenueId: string
  let field1Id: string
  let field2Id: string
  let staffUser: { id: string; auth_user_id: string; email: string }
  let unauthorizedUser: { id: string; auth_user_id: string; email: string }

  // Target local date: 2026-10-15 in 'Asia/Kolkata' (UTC+5:30)
  // Local midnight start: 2026-10-15 00:00:00 IST -> 2026-10-14T18:30:00.000Z
  // Local midnight end: 2026-10-15 23:59:59.999 IST -> 2026-10-15T18:29:59.999Z
  const venueTz = 'Asia/Kolkata'
  const localTargetDate = '2026-10-15'
  const dayBounds = ReportService.getVenueDayBounds(localTargetDate, venueTz)

  beforeAll(async () => {
    const ts = Date.now()
    // 1. Create main company & venue
    const { data: comp } = await adminClient
      .from('companies')
      .insert({ name: `M3 Reporting Company ${ts}`, slug: `m3-rep-comp-${ts}` })
      .select('id')
      .single()
    companyId = comp!.id

    const { data: ven } = await adminClient
      .from('venues')
      .insert({
        company_id: companyId,
        name: `M3 Reporting Venue ${ts}`,
        slug: `m3-rep-ven-${ts}`,
        timezone: venueTz,
        is_active: true,
      })
      .select('id')
      .single()
    venueId = ven!.id

    // 2. Create another tenant for isolation testing
    const { data: otherComp } = await adminClient
      .from('companies')
      .insert({ name: `Other Company ${ts}`, slug: `other-comp-${ts}` })
      .select('id')
      .single()
    otherCompanyId = otherComp!.id

    const { data: otherVen } = await adminClient
      .from('venues')
      .insert({
        company_id: otherCompanyId,
        name: `Other Venue ${ts}`,
        slug: `other-ven-${ts}`,
        timezone: venueTz,
        is_active: true,
      })
      .select('id')
      .single()
    otherVenueId = otherVen!.id

    // 3. Create Sports & Fields
    const { data: sport } = await adminClient.from('sports').select('id').limit(1).single()
    let sportId = sport?.id
    if (!sportId) {
      const { data: s } = await adminClient.from('sports').insert({ name: 'Cricket', slug: `cricket-${ts}` }).select('id').single()
      sportId = s!.id
    }

    const { data: vs } = await adminClient.from('venue_sports').insert({ venue_id: venueId, sport_id: sportId, is_active: true }).select('id').single()
    const { data: f1 } = await adminClient.from('fields').insert({ venue_id: venueId, venue_sport_id: vs!.id, name: 'Pitch 1', base_price_minor: 100000, is_active: true }).select('id').single()
    const { data: f2 } = await adminClient.from('fields').insert({ venue_id: venueId, venue_sport_id: vs!.id, name: 'Pitch 2', base_price_minor: 150000, is_active: true }).select('id').single()
    field1Id = f1!.id
    field2Id = f2!.id

    // 4. Create Staff with report.view permission
    const staffEmail = `staff_rep_${ts}@test.com`
    const { data: authStaff } = await adminClient.auth.admin.createUser({ email: staffEmail, password: 'password123', email_confirm: true })
    await new Promise(r => setTimeout(r, 500))

    const { data: profStaff } = await adminClient.from('profiles').select('*').eq('auth_user_id', authStaff.user!.id).single()
    staffUser = { id: profStaff.id, auth_user_id: authStaff.user!.id, email: staffEmail }

    const { data: roleStaff } = await adminClient.from('roles').insert({ code: `MANAGER_${ts}`, name: 'Manager' }).select('id').single()
    const { data: permReport } = await adminClient.from('permissions').select('id').eq('code', 'report.view').single()
    if (permReport) {
      await adminClient.from('role_permissions').insert({ role_id: roleStaff!.id, permission_id: permReport.id })
    }

    await adminClient.from('user_memberships').insert({
      profile_id: staffUser.id,
      company_id: companyId,
      venue_id: venueId,
      role_id: roleStaff!.id,
      is_active: true
    })

    // 5. Create Unauthorized user (no memberships, customer only)
    const unauthEmail = `unauth_rep_${ts}@test.com`
    const { data: authUnauth } = await adminClient.auth.admin.createUser({ email: unauthEmail, password: 'password123', email_confirm: true })
    await new Promise(r => setTimeout(r, 500))
    const { data: profUnauth } = await adminClient.from('profiles').select('*').eq('auth_user_id', authUnauth.user!.id).single()
    unauthorizedUser = { id: profUnauth.id, auth_user_id: authUnauth.user!.id, email: unauthEmail }

    // 6. Insert Synthetic Bookings with known exact paise minor values on local target date
    // Booking 1: CONFIRMED on Pitch 1 (60 mins, gross = 120,000 paise, advance = 40,000 paise, balance = 80,000 paise)
    // Start: 2026-10-15 10:00:00 IST -> 2026-10-15T04:30:00.000Z
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      venue_id: venueId,
      field_id: field1Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'CONFIRMED',
      start_at: '2026-10-15T04:30:00.000Z',
      end_at: '2026-10-15T05:30:00.000Z',
      duration_minutes: 60,
      gross_amount_minor: 120000,
      advance_required_minor: 40000,
      balance_due_minor: 80000,
      currency: 'INR',
      pricing_snapshot: { base: 100000 },
    })

    // Booking 2: COMPLETED on Pitch 2 (90 mins, gross = 225,000 paise, advance = 75,000 paise, balance = 0 paise)
    // Start: 2026-10-15 14:00:00 IST -> 2026-10-15T08:30:00.000Z
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      venue_id: venueId,
      field_id: field2Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'COMPLETED',
      start_at: '2026-10-15T08:30:00.000Z',
      end_at: '2026-10-15T10:00:00.000Z',
      duration_minutes: 90,
      gross_amount_minor: 225000,
      advance_required_minor: 75000,
      balance_due_minor: 0,
      currency: 'INR',
      pricing_snapshot: { base: 150000 },
    })

    // Booking 3: CANCELLED on Pitch 1 (60 mins, gross = 100,000 paise, advance = 30,000 paise, balance = 100,000 paise)
    // Start: 2026-10-15 16:00:00 IST -> 2026-10-15T10:30:00.000Z
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      venue_id: venueId,
      field_id: field1Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'CANCELLED',
      start_at: '2026-10-15T10:30:00.000Z',
      end_at: '2026-10-15T11:30:00.000Z',
      duration_minutes: 60,
      gross_amount_minor: 100000,
      advance_required_minor: 30000,
      balance_due_minor: 100000,
      currency: 'INR',
      pricing_snapshot: { base: 100000 },
    })

    // Booking 4: PAYMENT_PENDING on Pitch 2 (60 mins, gross = 150,000 paise, advance = 50,000 paise, balance = 150,000 paise)
    // Start: 2026-10-15 18:00:00 IST -> 2026-10-15T12:30:00.000Z
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      venue_id: venueId,
      field_id: field2Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'PAYMENT_PENDING',
      start_at: '2026-10-15T12:30:00.000Z',
      end_at: '2026-10-15T13:30:00.000Z',
      duration_minutes: 60,
      gross_amount_minor: 150000,
      advance_required_minor: 50000,
      balance_due_minor: 150000,
      currency: 'INR',
      pricing_snapshot: { base: 150000 },
    })

    // Booking 5: Outside tenant booking (Other company) on target date
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: otherCompanyId,
      venue_id: otherVenueId,
      field_id: field1Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'CONFIRMED',
      start_at: '2026-10-15T04:30:00.000Z',
      end_at: '2026-10-15T05:30:00.000Z',
      duration_minutes: 60,
      gross_amount_minor: 999999,
      advance_required_minor: 333333,
      balance_due_minor: 666666,
      currency: 'INR',
      pricing_snapshot: {},
    })

    // Booking 6: BEFORE local midnight boundary (2026-10-14 23:30:00 IST -> 2026-10-14T18:00:00.000Z)
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      venue_id: venueId,
      field_id: field1Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'CONFIRMED',
      start_at: '2026-10-14T18:00:00.000Z',
      end_at: '2026-10-14T19:00:00.000Z',
      duration_minutes: 60,
      gross_amount_minor: 50000,
      advance_required_minor: 20000,
      balance_due_minor: 30000,
      currency: 'INR',
      pricing_snapshot: {},
    })

    // Booking 7: AFTER local midnight boundary (2026-10-16 00:30:00 IST -> 2026-10-15T19:00:00.000Z)
    await adminClient.from('bookings').insert({
      id: crypto.randomUUID(),
      company_id: companyId,
      venue_id: venueId,
      field_id: field1Id,
      created_by_profile_id: staffUser.id,
      source: 'ONLINE',
      status: 'CONFIRMED',
      start_at: '2026-10-15T19:00:00.000Z',
      end_at: '2026-10-15T20:00:00.000Z',
      duration_minutes: 60,
      gross_amount_minor: 60000,
      advance_required_minor: 20000,
      balance_due_minor: 40000,
      currency: 'INR',
      pricing_snapshot: {},
    })
  })

  it('1. Exact Financial Totals in integer minor units (paise)', async () => {
    // Mock AuthService user to be staff with report.view
    AuthService.getUser = async () => ({ id: staffUser.auth_user_id } as never)

    const report = await ReportService.getFinancialReport({
      companyId,
      venueId,
      startDate: dayBounds.startDate,
      endDate: dayBounds.endDate,
    })

    // Active (non-cancelled) bookings on target date:
    // Booking 1: gross 120,000, advance 40,000, balance 80,000 (CONFIRMED)
    // Booking 2: gross 225,000, advance 75,000, balance 0 (COMPLETED)
    // Booking 4: gross 150,000, advance 50,000, balance 150,000 (PAYMENT_PENDING)
    // Booking 3 is CANCELLED (excluded from active gross/balance)
    // Expected Gross Value = 120,000 + 225,000 + 150,000 = 495,000 paise
    expect(report.totalGrossValueMinor).toBe(495000)

    // Verified collections apply to CONFIRMED and COMPLETED:
    // Booking 1 advance (40,000) + Booking 2 advance (75,000) = 115,000 paise
    expect(report.verifiedCollectionsAdvanceMinor).toBe(115000)

    // Remaining balance due = 80,000 + 0 + 150,000 = 230,000 paise
    expect(report.remainingBalanceDueMinor).toBe(230000)
  })

  it('2. Booking summary report: total counts, duration, and counts by status', async () => {
    AuthService.getUser = async () => ({ id: staffUser.auth_user_id } as never)

    const report = await ReportService.getBookingReport({
      companyId,
      venueId,
      startDate: dayBounds.startDate,
      endDate: dayBounds.endDate,
    })

    // Total bookings on target date: 4 (Booking 1, 2, 3, 4)
    expect(report.totalBookings).toBe(4)
    expect(report.totalDurationMinutes).toBe(60 + 90 + 60 + 60) // 270 mins
    expect(report.byStatus['CONFIRMED']).toBe(1)
    expect(report.byStatus['COMPLETED']).toBe(1)
    expect(report.byStatus['CANCELLED']).toBe(1)
    expect(report.byStatus['PAYMENT_PENDING']).toBe(1)
  })

  it('3. Utilisation Report: aggregates booked duration by field for CONFIRMED/COMPLETED', async () => {
    AuthService.getUser = async () => ({ id: staffUser.auth_user_id } as never)

    const report = await ReportService.getUtilisationReport({
      companyId,
      venueId,
      startDate: dayBounds.startDate,
      endDate: dayBounds.endDate,
    })

    // Occupied = CONFIRMED (Booking 1, 60m on Pitch 1) + COMPLETED (Booking 2, 90m on Pitch 2)
    expect(report.totalBookedMinutes).toBe(150)
    expect(report.byField[field1Id]).toBe(60)
    expect(report.byField[field2Id]).toBe(90)
  })

  it('4. Timezone boundaries: deterministic inclusive/exclusive boundaries around local midnight', async () => {
    AuthService.getUser = async () => ({ id: staffUser.auth_user_id } as never)

    // Day bounds for 2026-10-15 in 'Asia/Kolkata':
    // start: 2026-10-14T18:30:00.000Z
    // end:   2026-10-15T18:29:59.999Z

    // Booking 6 started at 2026-10-14T18:00:00.000Z (23:30 local previous day) -> EXCLUDED
    // Booking 7 started at 2026-10-15T19:00:00.000Z (00:30 local next day) -> EXCLUDED
    const report = await ReportService.getBookingReport({
      companyId,
      venueId,
      startDate: dayBounds.startDate,
      endDate: dayBounds.endDate,
    })

    // Should only contain the 4 bookings strictly within the local calendar day
    expect(report.totalBookings).toBe(4)

    // Expanding bounds to include previous day includes Booking 6
    const wideReport = await ReportService.getBookingReport({
      companyId,
      venueId,
      startDate: '2026-10-14T00:00:00.000Z',
      endDate: dayBounds.endDate,
    })
    expect(wideReport.totalBookings).toBe(5)
  })

  it('5. Tenant Isolation: foreign tenant booking data is completely excluded', async () => {
    AuthService.getUser = async () => ({ id: staffUser.auth_user_id } as never)

    const report = await ReportService.getFinancialReport({
      companyId,
      venueId,
      startDate: dayBounds.startDate,
      endDate: dayBounds.endDate,
    })

    // Foreign tenant booking has gross = 999,999 paise. It must NOT bleed into our total.
    expect(report.totalGrossValueMinor).toBe(495000)
    expect(report.totalGrossValueMinor).not.toContain(999999)
  })

  it('6. RBAC: User without report.view permission is strictly denied', async () => {
    // Unauthorized user has no memberships with report.view
    AuthService.getUser = async () => ({ id: unauthorizedUser.auth_user_id } as never)

    await expect(
      ReportService.getFinancialReport({
        companyId,
        venueId,
        startDate: dayBounds.startDate,
        endDate: dayBounds.endDate,
      })
    ).rejects.toThrow(/report\.view permission required/)

    await expect(
      ReportService.getBookingReport({
        companyId,
        venueId,
        startDate: dayBounds.startDate,
        endDate: dayBounds.endDate,
      })
    ).rejects.toThrow(/report\.view permission required/)
  })
})
