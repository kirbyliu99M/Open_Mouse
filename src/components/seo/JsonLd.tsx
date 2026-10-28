import { serializeJsonLd, type JsonLdObject } from "@/lib/structured-data";

/**
 * One `<script type="application/ld+json">`. It is data, not script: the
 * browser never runs it, so the CSP's `script-src` does not apply.
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
