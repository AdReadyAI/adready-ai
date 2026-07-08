// Route: /loading — shown while the AI evaluation pipeline is processing a
// submitted video.
// TODO: poll or subscribe to the evaluation's `status` column and navigate to
// /result once it's `completed` (or show an error state if `failed`).

export default function LoadingPage() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Loading</h1>
      <p className="text-slate-500">Loading/processing state goes here.</p>
    </div>
  )
}
