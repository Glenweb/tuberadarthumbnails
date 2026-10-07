import type { Metadata } from "next";
import { ScorerClient } from "@/components/score/ScorerClient";

export const metadata: Metadata = {
  title: "Scorer — TubeRadar Thumbnails",
  description: "Score a title and thumbnail pair against the competitor shelf it will appear in.",
};

export default function ScorePage() {
  return <ScorerClient />;
}
