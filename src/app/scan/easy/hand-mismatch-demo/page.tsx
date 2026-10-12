import { guardDevOnlyRoute } from "../../demo-guard";
import { HandMismatchDemoClient } from "./HandMismatchDemoClient";

export default function HandMismatchDemoPage() {
  guardDevOnlyRoute();
  return <HandMismatchDemoClient />;
}
