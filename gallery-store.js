// The gallery bucket, shared by the public page and the review screen.
//
// The bucket is private, so there is no public URL to build the way badge art
// builds one. Every picture is fetched through a signed URL, and asking for one
// is itself the permission check: anon may sign an object an approved row
// points at, a professor may sign any of them, and nobody may sign a
// photograph that is still waiting.
import { supabase } from './supabase-client.js';

export const GALLERY_BUCKET = 'gallery';

// An hour. Long enough that nobody runs out of time looking at a page, short
// enough that a URL copied out of the developer tools is not a permanent link
// to something that may be taken down tomorrow.
const SIGNED_FOR = 3600;

// One request for the whole page rather than one per picture. Returns a Map
// from object path to URL; a path that could not be signed is simply absent,
// and the caller renders a gap rather than a broken image.
export async function signedUrls(paths, seconds = SIGNED_FOR) {
  const wanted = [...new Set(paths.filter(Boolean))];
  if (!wanted.length) return new Map();

  const { data, error } = await supabase.storage
    .from(GALLERY_BUCKET).createSignedUrls(wanted, seconds);
  if (error || !data) return new Map();

  return new Map(data
    .filter((row) => row.signedUrl && !row.error)
    .map((row) => [row.path, row.signedUrl]));
}

export async function signedUrl(path, seconds = SIGNED_FOR) {
  return (await signedUrls([path], seconds)).get(path) || null;
}

// Both renditions of one submission, named after the same uuid. The database
// checks this shape before it will store a row, so the two sides agree on what
// a submission path looks like rather than one trusting the other.
export function newSubmissionPaths() {
  const id = crypto.randomUUID();
  return {
    full: `submissions/${id}.jpg`,
    thumb: `submissions/${id}-thumb.jpg`
  };
}
