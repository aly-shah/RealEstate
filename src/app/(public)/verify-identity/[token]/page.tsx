"use client";

import { useState } from "react";
import { useParams } from "next/navigation";

/**
 * Public, mobile-first CNIC scanner. Landlords/renters reach this by tapping the
 * WhatsApp link Proptimizr sends them (/verify-identity/<token>). It opens the
 * phone's back camera, captures the CNIC, and posts it to the verify endpoint.
 *
 * This route is allow-listed in src/proxy.ts so anonymous visitors aren't
 * bounced to /login.
 */
export default function PublicCnicScanner() {
  const { token } = useParams<{ token: string }>();
  const [image, setImage] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ name: string; cnic: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (f) {
      setImage(f);
      setError(null);
    }
  }

  async function executeUpload() {
    if (!image) {
      setError("Please take a clear picture of your CNIC first.");
      return;
    }
    setLoading(true);
    setError(null);

    const formData = new FormData();
    formData.append("token", token as string);
    formData.append("cnicImage", image);

    try {
      const res = await fetch("/api/contracts/verify-cnic", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification step failed.");
      setResult({ name: data.extractedName, cnic: data.extractedCnic });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-canvas px-4 py-8">
      <div className="surface w-full max-w-md p-6">
        <h1 className="text-lg font-semibold text-ink">Identity verification</h1>
        <p className="mt-1 text-sm text-muted">
          Please take a photo of the <strong>front</strong> of your CNIC. Make sure the name and number are clearly readable.
        </p>

        {error && (
          <p className="mt-4 rounded-xl border border-danger/30 bg-danger-bg px-3 py-2 text-sm text-danger">{error}</p>
        )}

        {!result ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-2xl border-2 border-dashed border-line bg-paper p-4 text-center">
              <input
                type="file"
                accept="image/*"
                // Opens the native back camera on iOS/Android.
                capture="environment"
                onChange={handleFileChange}
                className="hidden"
                id="cnic-capture"
              />
              <label htmlFor="cnic-capture" className="block cursor-pointer py-4">
                <span className="btn-accent inline-block">
                  {image ? "Change picture" : "📷 Snap CNIC photo"}
                </span>
                {image && (
                  <span className="mt-3 block text-xs font-medium text-ok">✓ Image selected ({image.name})</span>
                )}
              </label>
            </div>

            <button
              type="button"
              onClick={executeUpload}
              disabled={loading || !image}
              className="btn-accent w-full justify-center"
            >
              {loading ? "Processing document…" : "Verify identity"}
            </button>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-ok/30 bg-ok-bg p-4 text-center">
            <span className="text-2xl" aria-hidden>🎉</span>
            <h2 className="mt-2 font-semibold text-ok">Verification successful</h2>
            <div className="mt-3 space-y-1 rounded-xl bg-paper p-3 text-left text-xs text-ink">
              <p><strong>Extracted name:</strong> {result.name}</p>
              <p><strong>Extracted CNIC:</strong> {result.cnic}</p>
            </div>
            <p className="mt-4 text-xs text-muted">
              Your details have been recorded against the rental agreement. You can close this page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
