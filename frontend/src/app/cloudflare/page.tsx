"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function PreviousCloudflarePage() {
  const router = useRouter();
  useEffect(() => { router.replace("/source-articles"); }, [router]);
  return <p className="text-sm text-gray-400">Opening Source Image Articles…</p>;
}
