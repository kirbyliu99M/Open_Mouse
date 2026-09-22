import type { Metadata } from "next";
import type { ReactNode } from "react";
import { auth } from "../auth";
import { BeaconOnUnload } from "./BeaconOnUnload";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open_Mouse",
  description: "Finding a mouse that fits your hand. Currently in development.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const session = await auth();
  return (
    <html lang="en">
      <body>
        <BeaconOnUnload anonymous={!session?.user} />
        {children}
      </body>
    </html>
  );
}
