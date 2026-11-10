"use client";

import { TesterClient } from "@/client/tester/TesterClient";
import { measuredPipeline } from "../../easy/live-measured-demo/LiveMeasuredDemoClient";

/** The tester page with the live-measured demo's pipeline (dev only). */
export function TesterDemoClient({ open }: { readonly open: boolean }) {
  return <TesterClient open={open} runPhotoPipelineImpl={measuredPipeline} />;
}
