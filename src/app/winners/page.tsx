import type { Metadata } from "next";
import { WinnersClient } from "@/components/WinnersClient";

export const metadata: Metadata = {
  title: "Winners — TubeRadar Thumbnails",
  description: "Your saved title and thumbnail pairings, with predicted versus actual performance.",
};

export default function WinnersPage() {
  return <WinnersClient />;
}
