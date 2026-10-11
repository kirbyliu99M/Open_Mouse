/**
 * The size, in pixels, of every committed product photo
 * (`public/images/mice/*.webp`, from `tools/mouse-media`). They go on the
 * `<img>` as `width` and `height`; the box has its own aspect ratio and the
 * image is `object-fit: contain` inside it, so a photo of another shape would
 * still not move the page. Pinned against the real files by a test.
 */
export const MOUSE_PHOTO_WIDTH = 555;
export const MOUSE_PHOTO_HEIGHT = 480;

/**
 * The official product photo of a mouse, or a neutral silhouette when there is
 * none (`imageUrl` is null or missing: two catalogue mice have no photo). The
 * silhouette carries no text of its own. `alt` is empty where the mouse is
 * named right next to the picture. The photo is lazy and decoded off the main
 * thread, except the one at the top of the page (`priority`), which loads at
 * once and is not lazy.
 */
export function MousePhoto({
  imageUrl,
  alt = "",
  className = "",
  priority = false,
}: {
  imageUrl: string | null | undefined;
  alt?: string;
  className?: string;
  /** The photo at the top of the page: eager, high priority. */
  priority?: boolean;
}) {
  return (
    <div
      className={`results-photo ${className}`.trim()}
      data-has-photo={imageUrl ? "true" : "false"}
    >
      {imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- a plain site-relative file, sized by its box
        <img
          src={imageUrl}
          alt={alt}
          className="results-photo-img"
          width={MOUSE_PHOTO_WIDTH}
          height={MOUSE_PHOTO_HEIGHT}
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : undefined}
          decoding="async"
        />
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
