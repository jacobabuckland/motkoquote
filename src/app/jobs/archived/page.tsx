import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AppHeader } from "@/components/ui/app-header";
import { EmptyState } from "@/components/ui/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatGBP, formatDate } from "@/lib/format";
import { requireContractor } from "@/lib/require-contractor";
import { RestoreJobButton } from "./restore-job-button";
import { signOut } from "@/app/actions";

type ArchivedJob = {
  id: string;
  created_at: string;
  archived_at: string | null;
  extracted_json: { job_type?: string } | null;
  customer: { name: string } | null;
  quote: {
    total: number;
    status: string;
  } | null;
};

export default async function ArchivedJobsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const contractor = await requireContractor<{ id: string; company_name: string }>(
    supabase,
    user.id,
    "id, company_name",
  );

  const { data: jobs } = await supabase
    .from("jobs")
    .select(
      "id, created_at, archived_at, extracted_json, customer:customers(name), quote:quotes(total, status)",
    )
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  const archivedJobs = (jobs ?? []) as unknown as ArchivedJob[];

  return (
    <div className="min-h-screen">
      <AppHeader companyName={contractor.company_name} onSignOut={signOut} />
      <main className="container mx-auto px-4 py-8 max-w-4xl">
        {archivedJobs.length === 0 ? (
          <EmptyState
            title="Nothing archived"
            description="Jobs you archive from the job page will be kept here. Archiving removes them from your working pipeline and stops automated chasing, but keeps the records available."
          />
        ) : (
          <div className="space-y-4">
            {archivedJobs.map((job) => {
              const customerName = job.customer?.name ?? "Untitled job";
              const jobType = job.extracted_json?.job_type;
              const total = job.quote?.total ?? 0;
              const archivedDate = job.archived_at
                ? formatDate(job.archived_at)
                : "Unknown date";

              return (
                <Card key={job.id} className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <Link
                          href={`/jobs/${job.id}`}
                          className="font-medium text-lg hover:underline truncate"
                        >
                          {customerName}
                        </Link>
                        <Badge tone="neutral">Archived</Badge>
                      </div>
                      {jobType && (
                        <p className="text-sm text-muted-foreground mb-1">{jobType}</p>
                      )}
                      <p className="text-sm text-muted-foreground">
                        Archived on {archivedDate}
                      </p>
                      {total > 0 && (
                        <p className="text-sm font-medium mt-2">{formatGBP(total)}</p>
                      )}
                    </div>
                    <RestoreJobButton jobId={job.id} customerName={customerName} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
