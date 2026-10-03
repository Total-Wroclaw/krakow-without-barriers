// Photo privacy for user reports (pure helpers, usable on server and client).
// A photo is served publicly only when visibility === 'public': the AI found no people, faces or licence
// plates (people === 'none'), or the city office approved it. AI failure, 'present', 'unclear' and photos
// stored before the check stay hidden until the city reviews them.
import type { PhotoPeople, PhotoVisibility, Report, ReportPhoto } from './schemas';

/** All photos of a report; legacy reports only have photoPath (photo id 'main'). */
export function photoList(report: Report): ReportPhoto[] {
  return report.photos ?? (report.photoPath ? [{ id: 'main', path: report.photoPath, createdAt: report.obtainedAt }] : []);
}

export function initialVisibility(people: PhotoPeople | undefined): PhotoVisibility {
  return people === 'none' ? 'public' : 'hidden';
}

export const isPublicPhoto = (photo: ReportPhoto) => photo.visibility === 'public';

/** Path of the first publicly visible photo, or null. */
export function publicPhotoPath(report: Report): string | null {
  return photoList(report).find(isPublicPhoto)?.path ?? null;
}

/** Public form: hidden photos lose path and AI description. */
export function publicPhotos(report: Report): ReportPhoto[] {
  return photoList(report).map(p =>
    isPublicPhoto(p)
      ? { id: p.id, path: p.path, createdAt: p.createdAt, visibility: 'public', ...(p.analysis ? { analysis: p.analysis } : {}) }
      : { id: p.id, createdAt: p.createdAt, hidden: true, reason: 'privacy' },
  );
}

/** City office path for any photo (cookie-protected route). */
export const cityPhotoPath = (reportId: string, photoId: string) => `/api/city/reports/${encodeURIComponent(reportId)}/photos/${encodeURIComponent(photoId)}`;
