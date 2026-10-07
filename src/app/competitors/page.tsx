import type { Metadata } from "next";
import { CompetitorsClient } from "@/components/CompetitorsClient";

export const metadata: Metadata = {
  title: "Shelf — TubeRadar Thumbnails",
  description: "Analyse the competitor shelf for any keyword: visual conventions, title patterns and the quality bar you have to clear.",
};

export default function CompetitorsPage() {
  return <CompetitorsClient />;
}
