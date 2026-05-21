import Link from "next/link";
import { requireCompanyUser } from "@/lib/session";
import { searchAll, type SearchHit } from "@/lib/search";
import { humanize } from "@/lib/format";
import { PageHeader } from "@/components/ui/PageHeader";
import { Section } from "@/components/ui/Section";
import { EmptyState } from "@/components/ui/EmptyState";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireCompanyUser();
  const { q = "" } = await searchParams;
  const hits = await searchAll(user, q);

  const groups = hits.reduce<Record<string, SearchHit[]>>((acc, h) => {
    (acc[h.group] ??= []).push(h);
    return acc;
  }, {});

  return (
    <div>
      <PageHeader eyebrow="Search" title={q ? `Results for “${q}”` : "Search"} subtitle={`${hits.length} match${hits.length === 1 ? "" : "es"}`} />

      <form action="/search" className="mb-6">
        <input name="q" defaultValue={q} autoFocus placeholder="Search properties, leads, deals, clients, dealers…" className="field max-w-xl" />
      </form>

      {q.length < 2 ? (
        <EmptyState title="Type at least 2 characters" hint="Search across properties, leads, deals, clients and dealers." />
      ) : hits.length === 0 ? (
        <EmptyState title="No matches" hint="Try a different name, reference or area." />
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {Object.entries(groups).map(([group, items]) => (
            <Section key={group} title={group}>
              <ul className="divide-y divide-line">
                {items.map((h) => (
                  <li key={`${h.group}-${h.id}`} className="py-2">
                    <Link href={h.href} className="flex items-center justify-between gap-2 hover:text-accent">
                      <span className="truncate text-sm font-medium text-ink">{h.title}</span>
                      {h.subtitle && <span className="shrink-0 text-xs text-muted">{humanize(h.subtitle)}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </Section>
          ))}
        </div>
      )}
    </div>
  );
}
