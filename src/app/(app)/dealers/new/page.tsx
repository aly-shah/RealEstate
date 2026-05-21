import { requireCapability } from "@/lib/session";
import { PageHeader } from "@/components/ui/PageHeader";
import { DealerForm } from "./DealerForm";

export default async function NewDealerPage() {
  await requireCapability("manageUsers");
  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader eyebrow="Network" title="Add a dealer" subtitle="Record a supplier and their default commission share." />
      <DealerForm />
    </div>
  );
}
