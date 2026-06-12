/**
 * CNIC OCR engine — MOCK.
 *
 * In production this would call a localized provider: NADRA Verisys for true
 * identity verification, or an OCR wrapper (Google Cloud Vision / Mindee) tuned
 * for the NADRA CNIC card layout. Today it returns a deterministic stub after a
 * simulated latency so the contract-verification flow can be exercised
 * end-to-end without external credentials.
 *
 * Swap `processCnicOcr` for the real call when the provider is wired; the
 * OcrResult shape (and the confidence gate in the API route) stays the same.
 */

export interface OcrResult {
  cnicNumber: string;
  fullName: string;
  rawText: string;
  confidence: number;
}

/** Standard 13-digit Pakistani CNIC: 5 digits - 7 digits - 1 check digit. */
const CNIC_REGEX = /\d{5}-\d{7}-\d{1}/;

/**
 * Process a CNIC card image and extract the holder's number + name.
 * @param fileBuffer raw bytes of the uploaded image (front of the card).
 */
export async function processCnicOcr(fileBuffer: Buffer): Promise<OcrResult> {
  // Reference the buffer so the signature is honest and lints clean; a real
  // provider would POST these bytes to the OCR/verification API.
  void fileBuffer.byteLength;

  // Simulate provider round-trip latency.
  await new Promise((resolve) => setTimeout(resolve, 1800));

  // Deterministic stub — replace with the provider response.
  const mockText = "GOVERNMENT OF PAKISTAN - NAME: MUHAMMAD ALI - CNIC: 42101-1234567-1";
  const match = mockText.match(CNIC_REGEX);
  const extractedCnic = match ? match[0] : "42101-1234567-1";

  return {
    cnicNumber: extractedCnic,
    fullName: "Muhammad Ali",
    rawText: mockText,
    confidence: 0.94,
  };
}
