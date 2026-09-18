import { redirect } from 'next/navigation'

export default async function ReportsIndexPage({
  params
}: {
  params: Promise<{ companyId: string; venueId: string }>
}) {
  const { companyId, venueId } = await params
  redirect(`/admin/${companyId}/venues/${venueId}/reports/bookings`)
}
