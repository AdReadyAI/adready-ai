// Route: /upload — entry point of the flow.
// TODO: build the upload form here — file input for the video, brand/title
// fields, a submit handler that uploads to Supabase Storage and inserts an
// `evaluations` row, then navigates to /loading.

export default function UploadPage() {
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold text-slate-900">Upload</h1>
      <p className="text-slate-500">Upload form goes here.</p>
    </div>
  )
}
