"use client";
import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

export default function ThreadsCallbackPage() {
  const searchParams = useSearchParams();

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (window.opener) {
      if (error) {
        window.opener.postMessage({ error }, "*");
      } else if (code && state) {
        window.opener.postMessage({ code, state }, "*");
      } else {
        window.opener.postMessage({ error: "Missing code or state" }, "*");
      }
      window.close();
    }
  }, [searchParams]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center">
      <div className="text-center">
        <div className="h-8 w-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
        <p className="text-gray-400 text-sm">Completing authentication...</p>
      </div>
    </div>
  );
}
