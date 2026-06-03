import { getDict } from "@/lib/i18n/server";
import { LoginForm } from "./LoginForm";

const REASON_MESSAGES: Record<string, string> = {
  suspended: "Your account has been suspended. Contact your administrator to restore access.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { dict } = await getDict();
  const sp = await searchParams;
  const notice = sp.reason ? REASON_MESSAGES[sp.reason] ?? null : null;
  return <LoginForm dict={dict} notice={notice} />;
}
