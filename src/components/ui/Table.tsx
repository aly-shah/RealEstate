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
          <tr className="border-b border-line bg-canvas/60 text-left text-[10px] uppercase tracking-[0.14em] text-muted">
            {head.map((h, i) => (
              <th key={i} className="whitespace-nowrap px-4 py-3 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line-soft [&>tr]:transition [&>tr:hover]:bg-accent-wash/30">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-4 py-3 align-middle ${className}`}>{children}</td>;
}
