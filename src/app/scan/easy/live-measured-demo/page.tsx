import type { Metadata } from "next";
import { guardDemoRouteFromProduction } from "../../demo-guard";
import { LiveMeasuredDemoClient } from "./LiveMeasuredDemoClient";

export const metadata: Metadata = {
  title: "Easy scan, live camera with a fixed result (mock data)",
  description:
    "Dev/demo route: the real easy-scan camera with a pipeline that always answers 'measured', for tests and screenshots.",
  robots: { index: false, follow: false },
};

export default function LiveMeasuredDemoPage() {
  guardDemoRouteFromProduction();
  return <LiveMeasuredDemoClient />;
}
