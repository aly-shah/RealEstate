import { signOut } from "@/auth";

export async function POST() {
  // signOut performs the redirect to /login.
  await signOut({ redirectTo: "/login" });
}
