import { Suspense } from "react";
import Link from "next/link";
import { PageFallback } from "@/components/app-shell/page-fallback";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { REQUEST_TYPES, isRequestType, type RequestType } from "@/domain/requests/types";
import { DashboardHeader } from "@/features/dashboards/dashboard-header";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { RequestForm } from "@/features/requests/forms";
import { getDb } from "@/lib/db";
import { notFound, redirect } from "next/navigation";
import { can } from "@/domain/access/permissions";
import { canCreateProjectWithSource } from "@/domain/projects/source";
import { requireUser } from "@/server/auth/current-user";
import { hasCompletedRfq, listActiveProjectOptions } from "@/server/requests/queries";

export default function NewRequestPage({ searchParams }: PageProps<"/requests/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewRequest searchParams={searchParams} />
    </Suspense>
  );
}

async function NewRequest({ searchParams }: Pick<PageProps<"/requests/new">, "searchParams">) {
  const viewer = await requireUser();
  // Sales and admins raise any request. SOA raises a BOQ, and only for a project from another source (Other). Purchasing raises an RFQ, and only an RFQ, for any project.
  const raisesAny = can(viewer.role, "requests.create");
  const raisesRfqOnly = !raisesAny && can(viewer.role, "requests.create.rfq");
  if (!raisesAny && !raisesRfqOnly && !can(viewer.role, "requests.create.external")) notFound();
  const query = await searchParams;
  // SOA's BOQ starts in the New project form; this form is for adding a request to a project that already exists.
  if (!raisesAny && !raisesRfqOnly && typeof query.project !== "string") redirect("/projects/new?type=BOQ");
  const projects = await listActiveProjectOptions(getDb(), viewer, raisesAny || raisesRfqOnly ? undefined : "OTHER");
  const wantedProject = typeof query.project === "string" ? projects.find((p) => p.code === query.project) : undefined;
  const wantedType = typeof query.type === "string" ? query.type.toUpperCase() : "";
  // A PO needs a completed RFQ on its project, so it is offered only for a project that has one.
  const poAllowed = wantedProject ? await hasCompletedRfq(getDb(), viewer, wantedProject.id) : false;
  // Purchasing may register the project first when it does not exist yet (the New project form, RFQ already chosen).
  const createsProject = raisesRfqOnly && canCreateProjectWithSource(viewer.role, "OTHER");
  const types: readonly RequestType[] =raisesRfqOnly ? ["RFQ"] : !raisesAny ? ["BOQ"] : poAllowed ? REQUEST_TYPES : REQUEST_TYPES.filter((type) => type !== "PO");

  return (
    <>
      <DashboardHeader
        title="New request"
        summary={
          raisesRfqOnly
            ? "Ajukan RFQ (quotation/harga) untuk project yang ada. RFQ masuk ke Purchasing dan diberitahukan ke Sales PIC dan SOA PIC project."
            : "Minta BOQ ke SOA atau RFQ ke Purchasing. Alurnya BOQ, RFQ, lalu PO; BOQ boleh dilewati, dan PO diajukan setelah RFQ project selesai."
        }
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            <h2>Request details</h2>
          </CardTitle>
          <CardDescription>
            {raisesRfqOnly ? (
              createsProject ? (
                <>
                  Pilih project yang sudah ada. Belum ada projectnya?{" "}
                  <Link href={`${PROJECTS_PATH}/new?type=RFQ`} className="underline underline-offset-4">
                    Buat project baru beserta RFQ-nya
                  </Link>
                  .{" "}
                </>
              ) : (
                "Project dibuat oleh Sales atau SOA; pilih yang sudah ada. "
              )
            ) : (
              "Setelah disimpan, teks email (To, Cc, subjek, isi) tersedia untuk disalin ke Outlook. "
            )}
            {projects.length === 0 ? (
              raisesRfqOnly ? (
                createsProject ? null : "There is no active project yet. Ask Sales or SOA to register it first."
              ) : (
                <>
                  There is no active project yet:{" "}
                  <Link href={`${PROJECTS_PATH}/new`} className="underline underline-offset-4">
                    create a project first
                  </Link>
                  .
                </>
              )
            ) : null}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RequestForm
            projects={projects}
            defaultProjectId={wantedProject?.id ?? ""}
            defaultType={isRequestType(wantedType) && types.includes(wantedType) ? wantedType : (types[0] ?? "BOQ")}
            types={types}
            submissionKey={crypto.randomUUID()}
            picFilters={raisesRfqOnly}
          />
        </CardContent>
      </Card>
    </>
  );
}
