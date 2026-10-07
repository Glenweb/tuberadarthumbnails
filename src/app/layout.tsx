import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "TubeRadar Thumbnails — thumbnail & title optimisation",
  description:
    "Generate, score and compare YouTube thumbnail and title pairs against the competitor shelf they will actually appear in.",
};

export const viewport: Viewport = {
  themeColor: "#06070c",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-dvh">
        <div className="flex min-h-dvh flex-col lg:flex-row">
          <Nav />
          <main className="flex-1 min-w-0">{children}</main>
        </div>
      </body>
    </html>
  );
}
