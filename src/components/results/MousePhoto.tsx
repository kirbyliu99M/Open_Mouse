/**
 * The official product photo of a mouse, or a neutral silhouette when there is
 * none (`imageUrl` is null or missing). The silhouette carries no text of its
 * own. Nothing sends images yet, so the silhouette is the normal case today.
 * `alt` is empty where the mouse is named right next to the picture.
 */
export function MousePhoto({
  imageUrl,
  alt = "",
  className = "",
}: {
  imageUrl: string | null | undefined;
  alt?: string;
  className?: string;
}) {
  return (
    <div
      className={`results-photo ${className}`.trim()}
      data-has-photo={imageUrl ? "true" : "false"}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a plain site-relative file, sized by its box
        <img src={imageUrl} alt={alt} className="results-photo-img" />
      ) : (
        <svg
          className="results-photo-silhouette"
          viewBox="0 0 200 260"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M100 20C60 20 40 70 40 130C40 200 62 240 100 240C138 240 160 200 160 130C160 70 140 20 100 20Z" />
          <path d="M42 108Q100 128 158 108" />
          <path d="M100 22V112" />
          <rect x="93" y="48" width="14" height="36" rx="7" />
        </svg>
      )}
    </div>
  );
}
