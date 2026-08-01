"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function FacebookCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error_description") || searchParams.get("error");
    if (!window.opener) return;
    window.opener.postMessage(
      error
        ? { source: "facebook-oauth", error }
        : code && state
          ? { source: "facebook-oauth", code, state }
          : { source: "facebook-oauth", error: "Missing OAuth code or state" },
      window.location.origin,
    );
    window.close();
  }, [searchParams]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#080d16] text-white">
      <div className="text-center">
        <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#1877f2] border-t-transparent" />
        <p className="mt-4 text-sm text-slate-400">Connecting your Facebook Pages…</p>
      </div>
    </main>
  );
}
