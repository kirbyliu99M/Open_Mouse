import type { Metadata } from "next";
import { scanSheetCopy } from "@/lib/copy/scan-sheet";
import { getLocale } from "@/server/i18n/getLocale";
import ScanClient from "./ScanClient";
import "./scan.css";

export async function generateMetadata(): Promise<Metadata> {
  const copy = scanSheetCopy(await getLocale());
  return { title: copy.metaTitle, description: copy.metaDescription };
}

export default function ScanPage() {
  return <ScanClient />;
}
