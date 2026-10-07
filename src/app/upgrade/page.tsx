import type { Metadata } from "next";
import { UpgradeClient } from "@/components/UpgradeClient";

export const metadata: Metadata = {
  title: "Plan — TubeRadar Thumbnails",
  description: "Credits, limits and upgrade tiers for the TubeRadar Thumbnails module.",
};

export default function UpgradePage() {
  return <UpgradeClient />;
}
