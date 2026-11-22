import type { Metadata } from "next";
import { Suspense } from "react";
import AuthLayout from "@/components/auth-layout";
import { supabaseReady } from "@/lib/supabase/config";
import LoginForm, { type LoginError } from "./form";

export const metadata: Metadata = {
  title: "Log in",
  description: "Sign in to your Kestrel account with your work email or Google.",
  robots: { index: false, follow: false },
};

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <AuthLayout
      title="Log in to Kestrel"
      sub="Enter your work email to receive a sign-in link, or continue with Google."
    >
      <Suspense fallback={<LoginForm ready={supabaseReady} linkError={null} />}>
        <LoginContent searchParams={searchParams} />
      </Suspense>
    </AuthLayout>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const error = (sp.error === "link" || sp.error === "google" ? sp.error : null) as LoginError;
  return <LoginForm ready={supabaseReady} linkError={error} />;
}
