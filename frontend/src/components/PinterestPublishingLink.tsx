"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import { getUserEmail } from "@/lib/auth";

export default function PinterestPublishingLink({ siteId }: { siteId?: string | null }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  useEffect(() => { setAllowed(getUserEmail()?.trim().toLowerCase() === "khalil@gmail.com"); }, []);
  if (!allowed) return null;
  return <div className="flex flex-col gap-1">
    <button type="button" disabled={!siteId} onClick={() => router.push(`/pinterest-gallery/publishing?site_id=${siteId}`)}
      className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#E60023] px-3 py-2 text-xs font-semibold text-white transition hover:bg-[#c90020] disabled:cursor-not-allowed disabled:opacity-40">
      <Send size={14} /> Start Publishing on Pinterest
    </button>
    {!siteId && <span className="text-xs text-gray-400">Select a website to start publishing.</span>}
  </div>;
}
