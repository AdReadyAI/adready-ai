
import CampaignForm from "./CampaignForm";

export default function CampaignSection() {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="font-semibold text-lg text-slate-900 flex items-center gap-2 mb-4"><span className="bg-[#534AB7] text-white w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>Tell us about your ad</h2>

      <CampaignForm />
    </section>
  )
}