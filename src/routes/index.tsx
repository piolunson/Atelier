import { createFileRoute } from "@tanstack/react-router";
import { MaskStudio } from "@/components/lightcraft/mask-studio";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return <MaskStudio />;
}
