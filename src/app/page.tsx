import type { Metadata } from "next";
import { OverviewClient } from "@/components/OverviewClient";

export const metadata: Metadata = {
  title: "TubeRadar Thumbnails",
  description: "Generate, score and compare YouTube thumbnail and title pairs against the shelf they will actually appear in.",
};

export default function HomePage() {
  return <OverviewClient />;
}
