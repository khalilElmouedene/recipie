"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { setToken } from "@/lib/auth";

function Spinner() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="text-gray-400 text-sm">Signing you in...</p>
      </div>
    </div>
  );
}

function CallbackHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");

    if (!code || !state) {
      setError("Missing authorization code from Google. Please try again.");
      return;
    }

    api.googleCallback(code, state)
      .then((res) => {
        setToken(res.access_token);
        router.push("/");
      })
      .catch((err) => {
        setError(err.message || "Google sign-in failed. Please try again.");
      });
  }, []);

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="w-full max-w-md card text-center">
          <p className="text-red-400 mb-4">{error}</p>
          <a href="/login" className="text-brand-400 hover:underline text-sm">Back to login</a>
        </div>
      </div>
    );
  }

  return <Spinner />;
}

export default function GoogleCallbackPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <CallbackHandler />
    </Suspense>
  );
}
