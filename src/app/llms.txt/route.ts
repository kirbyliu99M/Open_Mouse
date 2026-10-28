import { llmsTxt } from "@/lib/llms";

/** `/llms.txt` (src/lib/llms.ts). Static: built once, at build time. */
export const dynamic = "force-static";

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
