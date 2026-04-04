type Agency = {
  name: string
  address: string
  address2?: string
  city: string
  state: string
  zip: string
  phone: string
  contactName: string
}

export default function AgencyCard({ agency }: { agency: Agency }) {
  return (
    <div className="bg-[#F7F5F1] rounded-xl p-6 mb-8 flex flex-col sm:flex-row sm:items-start gap-6">
      <div className="flex-1">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#2A7F7F] mb-1">Agency</p>
        <h2 className="text-xl font-bold text-[#1B2B4B] mb-3">{agency.name}</h2>
        <div className="text-sm text-gray-600 space-y-1">
          <p>{agency.address}{agency.address2 ? `, ${agency.address2}` : ''}</p>
          <p>{agency.city}, {agency.state} {agency.zip}</p>
          <p>{agency.phone}</p>
        </div>
      </div>
      <div className="sm:text-right">
        <p className="text-xs font-semibold uppercase tracking-widest text-[#2A7F7F] mb-1">Primary Contact</p>
        <p className="text-sm font-medium text-[#1B2B4B]">{agency.contactName}</p>
      </div>
    </div>
  )
}
