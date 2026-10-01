import { guardDemoRouteFromProduction } from "../../demo-guard";
import { HandMismatchDemoClient } from "./HandMismatchDemoClient";

export default function HandMismatchDemoPage() {
  guardDemoRouteFromProduction();
  return <HandMismatchDemoClient />;
}
