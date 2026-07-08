// Route: /result — shows the finished evaluation: overall launch-readiness
// score plus the per-criterion scorecard (claim validation, storyline,
// product representation, brief alignment).
// TODO: fetch the evaluation (and its scorecard items) from Supabase and
// render them here.

export default function ResultPage() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Result</h1>
      <p className="text-slate-500">Evaluation scorecard goes here.</p>
    </div>
  )
}
