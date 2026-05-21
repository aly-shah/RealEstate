interface TableProps {
  head: React.ReactNode[];
  children: React.ReactNode;
}

/** Lightweight, consistently-styled data table wrapper. */
export function Table({ head, children }: TableProps) {
  return (
    <div className="surface overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-subtle text-left text-xs uppercase tracking-wide text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
