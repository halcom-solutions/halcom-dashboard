import { Suspense } from "react";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { notFound } from "next/navigation";
import { can } from "@/domain/access/permissions";
import { canCreateProjectWithSource, canRaiseWithNewProject, mustChooseSalesOwner, PROJECT_SOURCE_TYPES } from "@/domain/projects/source";
import { requireUser } from "@/server/auth/current-user";
import { getDb } from "@/lib/db";
import { listCustomerOptions, listSalesPeopleOptions } from "@/server/requests/queries";
import { isRequestType, type RequestType } from "@/domain/requests/types";
import { ProjectForm, type ProjectFormScope } from "@/features/requests/forms";

export default function NewProjectPage({ searchParams }: PageProps<"/projects/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewProject searchParams={searchParams} />
    </Suspense>
  );
}

async function NewProject({ searchParams }: Pick<PageProps<"/projects/new">, "searchParams">) {
  const viewer = await requireUser();
  const customers = can(viewer.role, "projects.view") ? await listCustomerOptions(getDb(), viewer) : [];
  // Sales register their own Internal Sales projects; SOA and Purchasing register a project for a salesperson they pick (Internal Sales) or from
  // another source (Other); admins both.
  const sources = PROJECT_SOURCE_TYPES.filter((source) => canCreateProjectWithSource(viewer.role, source));
  if (sources.length === 0) notFound();
  const raisable = (source: (typeof PROJECT_SOURCE_TYPES)[number]) => (["BOQ", "RFQ"] as const).filter((type) => canRaiseWithNewProject(viewer.role, type, source));
  const picksOwner = mustChooseSalesOwner(viewer.role);
  const scope: ProjectFormScope = {
    sources,
    commercial: can(viewer.role, "projects.edit.commercial"),
    requestTypes: { INTERNAL_SALES: raisable("INTERNAL_SALES"), OTHER: raisable("OTHER") },
    salesPicName: viewer.name,
    salesPeople: can(viewer.role, "projects.assign-sales") ? await listSalesPeopleOptions(getDb(), viewer) : undefined,
    salesPicRequired: picksOwner,
  };
  // Purchasing creates a project to raise its RFQ: the page says so and the RFQ is already chosen.
  const offered = new Set([...raisable("INTERNAL_SALES"), ...raisable("OTHER")]);
  const rfqOnly = offered.size === 1 && offered.has("RFQ");
  const wanted = (await searchParams).type;
  const defaultType = typeof wanted === "string" && isRequestType(wanted.toUpperCase()) ? (wanted.toUpperCase() as RequestType) : rfqOnly ? "RFQ" : "";
  return (
    <>
      <DashboardHeader
        title="New project"
        summary={rfqOnly ? "Daftarkan proyek yang belum ada, lalu ajukan RFQ-nya sekaligus. Sales PIC proyek diberi tahu." : "Isi data proyek, lalu pilih request BOQ, RFQ, atau PO yang perlu diajukan."}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Project details</h2>
          </CardTitle>
          <CardDescription>
            Project ID (HIT-PROJ-001 dan seterusnya) diberikan saat Anda menyimpan.{" "}
            {sources.includes("INTERNAL_SALES") ? (picksOwner ? "Project Internal Sales menjadi milik salesperson yang Anda pilih. " : "Project Internal Sales menjadikan Anda Sales owner. ") : ""}
            {sources.includes("OTHER") ? "Project dari sumber lain (Other) tidak punya Sales PIC internal." : ""}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm submissionKey={crypto.randomUUID()} defaultType={defaultType} scope={scope} customers={customers} />
        </CardContent>
      </Card>
    </>
  );
}
