"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, CheckCircle, XCircle } from "lucide-react";
import { api, getApiBaseUrl } from "@/lib/api";

function PinterestCallbackInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");
  const handled = useRef(false);
  const [returnUrl, setReturnUrl] = useState<string | null>(null);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");
    const publishingSiteId = state ? sessionStorage.getItem(`pinterest_publishing_oauth:${state}`) : null;
    if (publishingSiteId) setReturnUrl(`/pinterest-gallery/publishing?site_id=${publishingSiteId}`);
    // Remove the temporary authorization code from browser history immediately.
    window.history.replaceState(window.history.state, "", "/pinterest/callback");

    if (error) {
      setStatus("error");
      setMessage(`Pinterest authorization failed: ${error}`);
      return;
    }

    if (!code) {
      setStatus("error");
      setMessage("No authorization code received from Pinterest");
      return;
    }

    if (publishingSiteId && state) {
      void api.completePinterestPublishingOAuth(publishingSiteId, code, state).then(() => {
        sessionStorage.removeItem(`pinterest_publishing_oauth:${state}`);
        router.replace(`/pinterest-gallery/publishing?site_id=${publishingSiteId}`);
      }).catch((err) => {
        setStatus("error");
        setMessage(err instanceof Error ? err.message : "Failed to connect Pinterest");
      });
      return;
    }

    const projectId = localStorage.getItem("pinterest_oauth_project_id");
    const savedState = localStorage.getItem("pinterest_oauth_state");

    if (state !== savedState) {
      setStatus("error");
      setMessage("Invalid state parameter - possible CSRF attack");
      return;
    }

    if (!projectId) {
      setStatus("error");
      setMessage("No project ID found - please try connecting again");
      return;
    }

    const exchangeCode = async () => {
      try {
        const response = await fetch(`${getApiBaseUrl()}/pinterest/callback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          credentials: "include",
          body: JSON.stringify({
            code,
            state,
            project_id: projectId,
          }),
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.detail || "Failed to connect Pinterest");
        }

        const data = await response.json();
        setStatus("success");
        setMessage(data.username ? `Connected as @${data.username}` : "Pinterest connected successfully!");

        localStorage.removeItem("pinterest_oauth_project_id");
        localStorage.removeItem("pinterest_oauth_state");

        setTimeout(() => {
          router.push(`/projects/${projectId}`);
        }, 2000);
      } catch (err: any) {
        setStatus("error");
        setMessage(err.message || "Failed to connect Pinterest");
      }
    };

    exchangeCode();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950">
      <div className="bg-gray-900 rounded-xl p-8 max-w-md w-full text-center">
        {status === "loading" && (
          <>
            <Loader2 className="w-12 h-12 text-brand-500 animate-spin mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">Connecting to Pinterest...</h1>
            <p className="text-gray-400">Please wait while we complete the authorization.</p>
          </>
        )}

        {status === "success" && (
          <>
            <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">Connected!</h1>
            <p className="text-gray-400">{message}</p>
            <p className="text-gray-500 text-sm mt-4">Redirecting...</p>
          </>
        )}

        {status === "error" && (
          <>
            <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-semibold text-white mb-2">Connection Failed</h1>
            <p className="text-gray-400">{message}</p>
            <button
              onClick={() => returnUrl ? router.replace(returnUrl) : router.back()}
              className="mt-6 btn-primary"
            >
              Go Back
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function PinterestCallbackPage() {
  return <Suspense fallback={<div className="p-8"><Loader2 className="animate-spin" /></div>}><PinterestCallbackInner /></Suspense>;
}
