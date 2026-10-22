"use client";

import { useParams } from "next/navigation";
import AllSitesGenerator from "@/components/AllSitesGenerator";

export default function AllSitesGeneratePage() {
  const { id } = useParams<{ id: string }>();
  return <AllSitesGenerator projectId={id} />;
}
