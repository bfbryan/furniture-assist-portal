export default function InactivePage() {
  return (
    <div className="min-h-screen bg-[#F7F5F1] flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-md p-12 max-w-md text-center">
        <div style={{ fontSize: '40px', marginBottom: '16px' }}>⚠️</div>
        <h1 className="font-montserrat font-extrabold text-xl text-[#1B2B4B] mb-3">
          Account Inactive
        </h1>
        <p className="text-sm text-[#7A8899] leading-relaxed">
          Your agency account has been deactivated. If you believe this is an error or would like to reinstate your account, please contact us.
        </p>
        <a href="mailto:agencies@furnitureassist.com"
          className="inline-block mt-6 px-6 py-3 rounded-lg bg-[#1B2B4B] text-white font-montserrat font-bold text-sm">
          Contact Furniture Assist
        </a>
      </div>
    </div>
  )
}