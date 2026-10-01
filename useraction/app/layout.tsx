import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PageLens — Page Analyzer",
  description: "Analyze your website's metadata, headings, images, and indexing directives.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
