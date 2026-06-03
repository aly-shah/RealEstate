import { requireCapability } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { ImportForm } from "./ImportForm";

export default async function ImportLeadsPage() {
  // Capability check matches the assign workflow — only office roles can
  // bulk-import (agents create leads one at a time from the field).
  await requireCapability("assignLeadsCalendars");

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Import"
        title="Import leads from a portal"
        subtitle="Paste a CSV exported from Zameen / Graana / OLX / Facebook, or attach a .csv file."
      />

      <Section title="CSV format">
        <p className="mb-2 text-sm text-slate">
          The importer accepts a header row plus one lead per line. Recognised columns
          (case-insensitive, all optional except <code className="kbd">name</code>):
        </p>
        <ul className="mb-3 list-inside list-disc space-y-0.5 text-xs text-slate">
          <li><code className="kbd">name</code> — client name (required)</li>
          <li><code className="kbd">phone</code>, <code className="kbd">email</code> — at least one is strongly recommended for de-dup</li>
          <li><code className="kbd">source</code> — one of REFERRAL / WALK_IN / SOCIAL_MEDIA / PORTAL / CALL / REPEAT_CLIENT / OTHER</li>
          <li><code className="kbd">budgetMin</code>, <code className="kbd">budgetMax</code> — PKR, digits only</li>
          <li><code className="kbd">prefArea</code> — preferred locality</li>
          <li><code className="kbd">requirements</code> — free-text notes</li>
        </ul>
        <p className="text-xs text-muted">
          Imported leads land <strong>unassigned</strong> so the office can triage them. The
          portal name is captured per row so the lost-reason reports can attribute by channel.
        </p>
      </Section>

      <ImportForm />
    </div>
  );
}
