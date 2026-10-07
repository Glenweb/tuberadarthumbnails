import type { Metadata } from "next";
import { StudioClient } from "@/components/studio/StudioClient";

export const metadata: Metadata = {
  title: "Studio — TubeRadar Thumbnails",
  description: "Generate thumbnail variants from a YouTube URL or a prompt, edit the overlays, and score them against the shelf.",
};

export default function StudioPage() {
  return <StudioClient />;
}
