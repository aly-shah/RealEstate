"use client";

import { useRef, useState } from "react";
import { setDocumentOverride } from "@/app/(app)/deals/actions";

/**
 * Inline document editor. The body renders the standard template (as children)
 * or the operator's saved HTML override. Clicking "Edit document" snapshots the
 * current rendered HTML (client-side) and makes the body contentEditable so the
 * operator tweaks the text directly on the page (formatting preserved); Save
 * stores the edited innerHTML as a replace override. "Reset to standard" reverts
 * to the auto-generated version.
 *
 * Once editing, the body renders via dangerouslySetInnerHTML (a stable string),
 * so React never re-reconciles — and doesn't clobber — the contentEditable DOM.
 */
export function EditableDocument({
  dealId,
  kind,
  overrideHtml,
  children,
}: {
  dealId: string;
  kind: string;
  overrideHtml: string | null;
  children: React.ReactNode;
}) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [editing, setEditing] = useState(false);
  // Non-null once we're rendering from an HTML string (override, or a snapshot
  // taken when the operator starts editing).
  const [html, setHtml] = useState<string | null>(overrideHtml);

  function startEdit() {
    setHtml(bodyRef.current?.innerHTML ?? "");
    setEditing(true);
  }
  function save() {
    if (bodyRef.current && hiddenRef.current && formRef.current) {
      hiddenRef.current.value = bodyRef.current.innerHTML;
      formRef.current.requestSubmit();
    }
  }

  return (
    <>
      <div className="my-3 flex flex-wrap items-center gap-2 print:hidden">
        {!editing ? (
          <>
            <button type="button" onClick={startEdit} className="btn-primary">✎ Edit document</button>
            {overrideHtml && (
              <>
                <span className="chip border-accent/25 bg-accent-wash text-accent">Edited</span>
                <form action={setDocumentOverride}>
                  <input type="hidden" name="dealId" value={dealId} />
                  <input type="hidden" name="kind" value={kind} />
                  <input type="hidden" name="mode" value="replace" />
                  <input type="hidden" name="text" value="" />
                  <button type="submit" className="btn-ghost text-xs text-danger">Reset to standard</button>
                </form>
              </>
            )}
          </>
        ) : (
          <>
            <button type="button" onClick={save} className="btn-primary">Save</button>
            <button type="button" onClick={() => window.location.reload()} className="btn-ghost">Cancel</button>
            <span className="text-xs text-muted">Click anywhere in the document and edit the text directly, then Save.</span>
          </>
        )}
      </div>

      <div
        ref={bodyRef}
        contentEditable={editing}
        suppressContentEditableWarning
        className={editing ? "rounded-lg p-2 outline-dashed outline-2 outline-accent/50" : ""}
        {...(html != null ? { dangerouslySetInnerHTML: { __html: html } } : {})}
      >
        {html != null ? null : children}
      </div>

      <form ref={formRef} action={setDocumentOverride} className="hidden">
        <input type="hidden" name="dealId" value={dealId} />
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="mode" value="replace" />
        <input ref={hiddenRef} type="hidden" name="text" />
      </form>
    </>
  );
}
