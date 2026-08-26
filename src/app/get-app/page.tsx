import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { resolveAppStoreHref } from "@/lib/app-store-link";
import { NATIVE_SHELL_UA_TAG } from "@/lib/app-home";
import { buttonClass } from "@/components/ui/button";

export default async function GetAppPage() {
  // Check if App Store URL is configured
  const appStoreUrl = resolveAppStoreHref(process.env.NEXT_PUBLIC_APP_STORE_URL);

  if (!appStoreUrl) {
    redirect("/setup");
  }

  // Check if user is in the native shell
  const headersList = await headers();
  const userAgent = headersList.get("user-agent") ?? "";

  if (userAgent.includes(NATIVE_SHELL_UA_TAG)) {
    redirect("/setup");
  }

  // Render the get-app page
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold mb-3">Get the app</h1>
        <p className="text-sm text-text-secondary mb-6">
          Motko is designed as an iOS app. Get it from the App Store to use
          all features, including voice quote capture, push notifications, and
          offline access.
        </p>

        <div className="flex flex-col gap-3">
          <a
            href={appStoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonClass("primary", "w-full")}
          >
            Download on the App Store
          </a>

          <Link href="/setup" className={buttonClass("secondary", "w-full")}>
            Continue to setup
          </Link>
        </div>
      </div>
    </main>
  );
}
