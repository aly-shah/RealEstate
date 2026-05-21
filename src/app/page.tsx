import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { homePathForRole } from "@/lib/rbac";

export default async function Home() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  redirect(homePathForRole(session.user.role));
}
