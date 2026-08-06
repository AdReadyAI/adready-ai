// Supabase Storage rejects non-ASCII characters in object keys (400
// InvalidKey), and an unencoded "#" truncates the URL at the fragment
// delimiter before the request is even sent. Strip diacritics down to their
// base letter, then replace anything else outside a safe ASCII set with "_" —
// this is only used to build the storage path; the original name is kept
// for display.
export function sanitizeFilename(name: string): string {
  const withoutDiacritics = name.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return withoutDiacritics.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
}
