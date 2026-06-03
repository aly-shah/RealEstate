/**
 * Tiny presence indicator. Reads `User.lastSeenAt` (stamped from requireUser
 * with a 1-min throttle) and shows one of three states:
 *
 *   - dot green + "Active just now"   when lastSeen < 2 min
 *   - dot amber + "Active 12m ago"     when lastSeen < 60 min
 *   - dot grey  + "Last seen 3d ago"   for older + never-seen
 *
 * Pure server component. Returns null when input is null AND the
 * "show as 'never seen' instead of hiding" prop isn't passed — keeps
 * legacy rows from awkwardly displaying a "Never" everywhere.
 */
interface LastSeenPillProps {
  lastSeenAt: Date | string | null | undefined;
  /** When true, render "Never" instead of hiding for never-seen users. */
  showNever?: boolean;
}

export function LastSeenPill({ lastSeenAt, showNever = false }: LastSeenPillProps) {
  if (!lastSeenAt) {
    if (!showNever) return null;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />
        Never signed in
      </span>
    );
  }

  const ms = Date.now() - new Date(lastSeenAt).getTime();
  if (ms < 2 * 60 * 1000) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-ok">
        <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden />
        Active just now
      </span>
    );
  }
  if (ms < 60 * 60 * 1000) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-warn">
        <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
        Active {Math.floor(ms / 60_000)}m ago
      </span>
    );
  }
  // Fall through to coarser units for older timestamps.
  const seconds = ms / 1000;
  let label: string;
  if (seconds < 86_400) label = `Last seen ${Math.floor(seconds / 3600)}h ago`;
  else if (seconds < 604_800) label = `Last seen ${Math.floor(seconds / 86_400)}d ago`;
  else label = `Last seen ${Math.floor(seconds / 604_800)}w ago`;

  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted">
      <span className="h-1.5 w-1.5 rounded-full bg-muted" aria-hidden />
      {label}
    </span>
  );
}
