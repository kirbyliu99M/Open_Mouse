import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  // Each page gives its own title; the template adds the site name after it.
  // The home page has none, so it shows the default.
  title: { default: "Open_Mouse", template: "%s · Open_Mouse" },
  description: "Finding a mouse that fits your hand. Currently in development.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
