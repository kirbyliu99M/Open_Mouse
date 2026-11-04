import type { Metadata } from "next";
import { guardDevOnlyRoute } from "../../demo-guard";
import { CardLiveDemoClient } from "./CardLiveDemoClient";

export const metadata: Metadata = {
  title: "Easy scan, card mode with a fixed result (mock data)",
  description:
    "Dev/demo route: the real easy-scan camera whose card-mode photo analysis always answers 'measured', for tests.",
  robots: { index: false, follow: false },
};

export default function CardLiveDemoPage() {
  guardDevOnlyRoute();
  return <CardLiveDemoClient />;
}
