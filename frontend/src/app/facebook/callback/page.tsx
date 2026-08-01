"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type FacebookOAuthPayload =
  | { source: "facebook-oauth"; error: string }
  | { source: "facebook-oauth"; code: string; state: string };

export default function FacebookCallbackPage() {
  const searchParams = useSearchParams();
  const [result, setResult] = useState<"connecting" | "success" | "error">("connecting");
  const [message, setMessage] = useState("Connecting your Facebook Pages...");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error_description") || searchParams.get("error");
    const payload: FacebookOAuthPayload = error
      ? { source: "facebook-oauth", error }
      : code && state
        ? { source: "facebook-oauth", code, state }
        : { source: "facebook-oauth", error: "Missing OAuth code or state" };

    if (!window.opener) {
      setResult("error");
      setMessage(
        error ||
          "The Facebook login window is no longer connected to the application. Return to the main tab and try again.",
      );
      return;
    }

    window.opener.postMessage(payload, window.location.origin);
    if ("error" in payload) {
      setResult("error");
      setMessage(payload.error);
    } else {
      setResult("success");
      setMessage("Facebook authentication completed. You can close this window.");
    }

    const closeTimer = window.setTimeout(() => window.close(), 150);
    return () => window.clearTimeout(closeTimer);
  }, [searchParams]);

  return (
    <main className="grid min-h-screen place-items-center bg-[#080d16] text-white">
      <div className="max-w-md px-6 text-center">
        {result === "connecting" ? (
          <div className="mx-auto h-10 w-10 animate-spin rounded-full border-2 border-[#1877f2] border-t-transparent" />
        ) : (
          <div
            className={`mx-auto grid h-10 w-10 place-items-center rounded-full text-lg font-semibold ${
              result === "success"
                ? "bg-emerald-500/15 text-emerald-300"
                : "bg-red-500/15 text-red-300"
            }`}
          >
            {result === "success" ? "✓" : "!"}
          </div>
        )}
        <p
          className={`mt-4 text-sm leading-6 ${
            result === "error" ? "text-red-200" : "text-slate-400"
          }`}
        >
          {message}
        </p>
        {result !== "connecting" && (
          <button
            onClick={() => window.close()}
            className="mt-5 rounded-lg bg-[#1877f2] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#2f86f6]"
          >
            Close window
          </button>
        )}
      </div>
    </main>
  );
}
