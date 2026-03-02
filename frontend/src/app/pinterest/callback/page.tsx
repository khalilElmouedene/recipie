"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { Loader2, CheckCircle, XCircle } from "lucide-react";

export default function PinterestCallbackPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

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
        const token = localStorage.getItem("token");
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/pinterest/callback`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
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
              onClick={() => router.back()}
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
