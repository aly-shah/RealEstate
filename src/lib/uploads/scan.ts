/**
 * Pluggable virus-scan adapter. Today it's a no-op that always returns "clean"
 * so the rest of the upload pipeline can be written and tested as if scanning
 * were already in place. Swap the implementation when integrating a real
 * scanner — every call site stays the same.
 *
 * Suggested integrations:
 *   - ClamAV via the `clamdjs` package, talking to a local clamd sidecar
 *   - VirusTotal /files endpoint (slow + rate-limited; good for spot checks)
 *   - Cloudflare R2 / S3 with bucket-side scanning if you move uploads off-disk
 *
 * Whatever you pick: keep the interface (`Promise<ScanResult>`), and prefer
 * fail-closed (`{ clean: false, reason: "scanner unavailable" }`) over
 * fail-open if the scanner times out — uploads are not a hot path.
 */

export interface ScanResult {
  clean: boolean;
  /** Short identifier of the engine + verdict, for the audit log. */
  reason?: string;
}

export async function scanForViruses(_buf: Buffer): Promise<ScanResult> {
  // Placeholder. Real implementations should be I/O-bound (HTTP or socket
  // to a sidecar) and respect a 5-10s timeout.
  return { clean: true, reason: "stub-noop" };
}
