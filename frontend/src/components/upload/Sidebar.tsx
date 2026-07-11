
export default function Sidebar() {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          What we'll analyze
        </h2>
        <ul className="list-disc border-t border-[#E2E1DC]  list-inside mt-2 text-sm text-[#5F5E5A] space-y-3">
            <li className="flex items-center mt-3">
              <div className="bg-[#E1F5EE] text-[#1D9E75] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">✓</div>
              Product representation
            </li>
            <li className="flex items-center">
              <div className="bg-[#E1F5EE] text-[#1D9E75] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">✓</div>
              Messaging clarity
            </li>
            <li className="flex items-center">
              <div className="bg-[#E1F5EE] text-[#1D9E75] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">✓</div>
              Storyline and pacing
            </li>
            <li className="flex items-center">
              <div className="bg-[#E1F5EE] text-[#1D9E75] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">✓</div>
              Claims and substantiation
            </li>
            <li className="flex items-center">
              <div className="bg-[#E1F5EE] text-[#1D9E75] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">✓</div>
              CTA effectiveness
            </li>
            <li className="flex items-center">
              <div className="bg-[#E1F5EE] text-[#1D9E75] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">✓</div>
              Overall ad readiness
            </li>
        </ul>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-slate-900">
          How it works
        </h2>
        <ol className="list-decimal border-t border-[#E2E1DC] list-inside mt-2 text-sm text-[#5F5E5A] space-y-6">
            <li className="flex items-center mt-3">
                <div className="bg-[#EEEDFE] text-[#534AB7] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">1</div>
                Upload videos and brief
            </li>
            <li className="flex items-center">
                <div className="bg-[#EEEDFE] text-[#534AB7] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">2</div>
                Tool evaluates videos against multiple frameworks
            </li>
            <li className="flex items-center">
                <div className="bg-[#EEEDFE] text-[#534AB7] w-6 h-6 p-1 rounded-full text-center text-xs mr-2">3</div>
                Receive scorecard and repair guide
            </li>
        </ol>
      </section>
    </div>
  )
}