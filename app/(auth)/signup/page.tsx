import Link from "next/link";
import { AuthShell } from "../AuthShell";
import { SignupForm } from "./SignupForm";
import { BUSINESS_TYPES } from "@/lib/plans";
import { STATES } from "@/lib/india";

export const metadata = { title: "Start free trial" };

export default function SignupPage() {
  return (
    <AuthShell title="Create your workspace" subtitle={<>Already have an account? <Link href="/login" className="link">Sign in</Link></>}>
      <SignupForm types={BUSINESS_TYPES} states={Object.entries(STATES)} />
    </AuthShell>
  );
}
