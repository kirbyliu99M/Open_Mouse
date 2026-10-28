import { serializeJsonLd } from "@/lib/structured-data";

/**
 * One JSON-LD block. A data block is never executed, so the CSP's script-src
 * does not apply to it.
 */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
