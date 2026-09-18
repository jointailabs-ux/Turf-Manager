import { ReactNode } from 'react'

export default async function ReportsLayout({
  children,
  params
}: {
  children: ReactNode
  params: Promise<{ companyId: string; venueId: string }>
}) {
  const { companyId, venueId } = await params

  const tabs = [
    { label: 'Bookings', href: `/admin/${companyId}/venues/${venueId}/reports/bookings` },
    { label: 'Financial', href: `/admin/${companyId}/venues/${venueId}/reports/financial` },
    { label: 'Utilisation', href: `/admin/${companyId}/venues/${venueId}/reports/utilisation` },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Reports</h1>
      </div>

      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-6">
          {tabs.map((tab) => (
            <a
              key={tab.label}
              href={tab.href}
              className="border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300 whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm transition-colors"
            >
              {tab.label}
            </a>
          ))}
        </nav>
      </div>

      <div>{children}</div>
    </div>
  )
}
