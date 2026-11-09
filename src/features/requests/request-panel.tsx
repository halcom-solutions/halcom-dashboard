import Link from "next/link";
import { can } from "@/domain/access/permissions";
import { salesActsOn } from "@/domain/projects/source";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { canContinueFlow, canSeeEmail, canWorkOn } from "@/domain/requests/access";
import { formatSlaRange, slaOf } from "@/domain/requests/sla";
import { allowedTransitions, canHandOver, nextRequestType, REQUEST_STATUS_LABELS } from "@/domain/requests/status";
import { OWNING_TEAM_LABELS, SUBJECT_TAGS } from "@/domain/requests/types";
import type { Role } from "@/domain/access/roles";
import { formatDay } from "@/features/dashboards/format";
import { PROJECTS_PATH } from "@/features/navigation/links";
import { getDb } from "@/lib/db";
import { buildRequestEmail } from "@/server/requests/email";
import { type RequestDetail } from "@/server/requests/queries";
import { getTeamSetting } from "@/server/settings/team-settings";
import { listAssignablePics, listPicAssignments } from "@/server/pics/service";
import { picTeamOf, PIC_TEAM_LABELS } from "@/domain/pics/teams";
import { distributorLabel, paymentTermsLabel, sameTerms } from "@/domain/distributors/payment";
import { listAssignableDistributors } from "@/server/distributors/service";
import { DeleteRequest } from "./delete-request";
import { EmailDialog } from "./email-dialog";
import { Fact } from "./fact";
import { jakartaDay } from "@/domain/requests/metrics";
import { AssignPicForm, type DistributorChoice, NextStepForm, RequestDatesForm, RevisionForm } from "./forms";
import { formatDateOnly } from "./format";
import { SlaBadge } from "./sla-badge";
import { StatusBadge, TypeBadge } from "./status-badges";

/**
 * Everything about one request: its facts, the actions the viewer may take, the email (in a modal) and the status history
 * (collapsed, at the end). It is the body of the request page and, for each request, of the project page, so a request is
 * handled in the context of its project. `inProject` leaves out the link back to the project.
 */
export async function RequestPanel({ request, viewer, inProject = false, openEmail = false }: { request: RequestDetail; viewer: { id: string; role: Role }; inProject?: boolean; openEmail?: boolean }) {
  const mayWork = canWorkOn(viewer.role, request.type);
  const next = nextRequestType(request.type);
  const ownsProject = salesActsOn(request.project, viewer.id);
  const decided = request.handovers.length > 0;
  const mayDecide = next !== null && !decided && canHandOver(request.type, request.status) && canContinueFlow(viewer.role, request.type, ownsProject);
  // The latest time this BOQ was sent back (by Sales from the request page, or by SOA on the board), with the reason that was given.
  const revisionEntry = [...request.statusHistory].reverse().find((row) => row.toStatus === "REVISION") ?? null;
  // Sales (on a project they act on) and admins can send a completed request back to its team (SOA for a BOQ, Purchasing for an RFQ or PO); it goes straight to the Revision stage.
  const mayRevise = can(viewer.role, "requests.revise") && request.status === "COMPLETED" && (viewer.role !== "SALES" || ownsProject);
  // The SLA and the email template belong to the team that receives this type of request (SOA for a BOQ, else Purchasing).
  const setting = await getTeamSetting(getDb(), request.type === "BOQ" ? "SOA" : "PURCHASING");
  // The PO is written by Sales to Purchasing (HITPO), so it has a template of its own; the other types use their receiving team's.
  const emailSetting = request.type === "PO" ? await getTeamSetting(getDb(), "SALES") : setting;
  // PICs are the people tickets are handed to; the shared SOA / Purchasing account only records who clicked.
  const [pics, assignments] = await Promise.all([mayWork ? listAssignablePics(getDb(), viewer, request.type) : [], listPicAssignments(getDb(), viewer, request.id)]);
  // Only an RFQ names a distributor; Purchasing picks it from the active ones.
  const distributors = mayWork && request.type === "RFQ" ? await listAssignableDistributors(getDb(), viewer) : [];
  // Only a superadmin or an admin corrects the requester, from the active accounts (the one now on the request is kept in the list even if it was deactivated).
  const people = can(viewer.role, "requests.edit-dates") ? await requesterChoices(request) : [];
  // The distributors Purchasing can pick, each with its terms; and where this RFQ stands now. A distributor turned off after it was chosen stays in the
  // list (without terms to switch to), so saving does not silently clear it; terms the distributor no longer lists are kept until another is chosen.
  const choices: DistributorChoice[] = distributors.map((d) => ({ id: d.id, name: distributorLabel(d), terms: d.terms.map((term) => ({ id: term.id, label: paymentTermsLabel(term) })) }));
  if (request.distributorId && request.distributor && !choices.some((choice) => choice.id === request.distributorId)) {
    choices.push({ id: request.distributorId, name: `${distributorLabel(request.distributor)} (nonaktif)`, terms: [] });
  }
  const ownTerms = request.paymentType ? { paymentType: request.paymentType, topDays: request.topDays } : null;
  const distributorChoice = {
    current: request.distributorId ?? "",
    currentTermId: (ownTerms && distributors.find((d) => d.id === request.distributorId)?.terms.find((term) => sameTerms(term, ownTerms))?.id) || "",
    currentTermLabel: ownTerms ? paymentTermsLabel(ownTerms) : "",
    options: choices,
  };
  const sla = slaOf({ createdAt: request.createdAt, status: request.status, completedAt: request.completedAt, history: request.statusHistory, range: setting.sla, now: new Date() });
  const email = canSeeEmail(viewer.role, request.type, request.source !== null)
    ? buildRequestEmail(request, { subject: emailSetting.emailSubject, body: emailSetting.emailBody, sla: setting.sla, dueAt: sla.dueAt, to: emailSetting.emailTo, cc: emailSetting.emailCc })
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Fact label="Type">
              <TypeBadge type={request.type} />
            </Fact>
            <Fact label="Status">
              <StatusBadge status={request.status} />
            </Fact>
            <Fact label="Owning team">{OWNING_TEAM_LABELS[request.type]}</Fact>
            <Fact label={`SLA (${formatSlaRange(setting.sla)} working days)`}>
              <SlaBadge sla={sla} />
            </Fact>
            {sla.revision && request.status !== "REVISION" ? (
              <Fact label="SLA revisi terakhir">
                <SlaBadge sla={{ ...sla.revision, revision: null }} />
              </Fact>
            ) : null}
            <Fact label="PIC">
              {request.pic ? (
                <>
                  {request.pic.name}
                  {request.pic.isActive ? null : <span className="text-muted-foreground"> (inactive)</span>}
                </>
              ) : (
                <span className="text-muted-foreground">Unassigned</span>
              )}
            </Fact>
            {request.type === "RFQ" ? (
              <Fact label="Distributor">
                {request.distributor ? (
                  <>
                    {distributorLabel(request.distributor)}
                    {request.paymentType ? ` · ${paymentTermsLabel({ paymentType: request.paymentType, topDays: request.topDays })}` : ""}
                    {request.distributor.isActive ? null : <span className="text-muted-foreground"> (nonaktif)</span>}
                  </>
                ) : (
                  <span className="text-muted-foreground">Belum dipilih</span>
                )}
              </Fact>
            ) : null}
            {inProject ? null : (
              <Fact label="Project">
                <Link href={`${PROJECTS_PATH}/${request.project.code}`} className="text-primary underline-offset-4 hover:underline">
                  {request.project.code}
                </Link>
              </Fact>
            )}
            <Fact label="Requested by">{request.raisedByPic ? `${request.raisedByPic.name} (SOA PIC, through the shared SOA login)` : request.requester.name}</Fact>
            <Fact label="Needed by">{formatDateOnly(request.requiredBy)}</Fact>
            <Fact label="Created">{formatDay(request.createdAt)}</Fact>
            {request.completedAt ? <Fact label="Completed">{formatDay(request.completedAt)}</Fact> : null}
            {request.overdueNote ? <Fact label="Catatan overdue">{request.overdueNote}</Fact> : null}
            {request.source ? (
              <Fact label="Handed over from">
                <Link href={`/request/${request.source.code}`} className="font-mono text-primary underline-offset-4 hover:underline">
                  {request.source.code}
                </Link>
              </Fact>
            ) : null}
            {request.handovers.length > 0 ? (
              <Fact label="Handed over to">
                <span className="flex flex-wrap gap-x-3">
                  {request.handovers.map((h) => (
                    <Link key={h.code} href={`/request/${h.code}`} className="font-mono text-primary underline-offset-4 hover:underline">
                      {h.code}
                    </Link>
                  ))}
                </span>
              </Fact>
            ) : null}
          </dl>
          <div className="mt-4 border-t pt-4">
            <h3 className="text-sm font-semibold">{request.title}</h3>
            <p className="mt-1 text-sm whitespace-pre-wrap">{request.description || <span className="text-muted-foreground">Tidak ada detail.</span>}</p>
          </div>
          {email ? (
            <div className="mt-4 flex flex-wrap items-center gap-3 border-t pt-4">
              <EmailDialog
                tag={SUBJECT_TAGS[request.type]}
                autoOpen={openEmail}
                to={email.recipients.ok ? email.recipients.to : null}
                cc={email.recipients.ok ? email.recipients.cc : []}
                recipientsError={email.recipients.ok ? null : email.recipients.error}
                subject={email.subject}
                body={email.body}
                linkConfigured={email.linkConfigured}
                hint={
                  request.source
                    ? `Balas di dalam thread email ${SUBJECT_TAGS.BOQ} asli untuk ${request.source.code} agar percakapan tetap satu alur, dan gunakan subject serta teks ini.`
                    : undefined
                }
              />
              <span className="text-xs text-muted-foreground">Membuka subject, penerima, dan teks untuk dikirim.</span>
            </div>
          ) : null}
        </CardContent>
      </Card>

      {mayWork && allowedTransitions(request.status, request.type).length > 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
          Status saat ini {REQUEST_STATUS_LABELS[request.status]}. Diubah dengan menyeret kartu request ini di{" "}
          <Link href={`/requests/${request.type.toLowerCase()}?view=board`} className="underline underline-offset-4">
            {request.type} board
          </Link>
          . Pertanyaan ke Sales dan detail revisi disampaikan lewat email, agar riwayatnya tetap tercatat.
        </p>
      ) : null}

      {mayWork ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>{request.type === "RFQ" ? "PIC dan distributor" : "PIC"}</h3>
            </CardTitle>
            <CardDescription>
              PIC {PIC_TEAM_LABELS[picTeamOf(request.type)]} yang mengerjakan request ini. Perubahan tercatat di riwayat penugasan.
              {request.type === "RFQ" ? " Distributor yang dituju RFQ ini ikut dipilih di sini; jenis pembayarannya mengikuti data distributor." : null}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AssignPicForm
              requestId={request.id}
              current={request.picId ?? ""}
              pics={pics}
              teamLabel={PIC_TEAM_LABELS[picTeamOf(request.type)]}
              distributor={request.type === "RFQ" ? distributorChoice : undefined}
            />
          </CardContent>
        </Card>
      ) : null}

      {request.status === "REVISION" ? (
        <div role="status" data-testid="revision-banner" className="rounded-xl border border-destructive bg-destructive/10 px-4 py-3 text-sm">
          <p className="font-semibold text-destructive">In revision</p>
          <p>
            {revisionEntry
              ? `Sent back on ${formatDay(revisionEntry.changedAt)} by ${revisionEntry.changedBy.name}${revisionEntry.reason ? `: ${revisionEntry.reason}` : "."}`
              : `This ${request.type} was sent back for changes.`}
            {" "}Jam SLA revisi berjalan sejak itu; hasil SLA penyelesaian pertama tidak berubah.
          </p>
        </div>
      ) : null}

      {mayRevise ? (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Request a revision</h3>
            </CardTitle>
            <CardDescription>
              Tulis perubahan yang diminta (wajib). Tiket langsung masuk Revision, {OWNING_TEAM_LABELS[request.type]} diberi tahu, dan jam SLA revisi dimulai dari sekarang.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RevisionForm requestId={request.id} />
          </CardContent>
        </Card>
      ) : null}

      {can(viewer.role, "requests.edit-dates") ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>Correct the dates</h3>
            </CardTitle>
            <CardDescription>Atur tanggal dibuat dan selesai (tanpa jam) serta pemohon, untuk tiket yang terlambat diinput atau salah catat. Riwayat status tidak berubah; perubahan masuk audit log.</CardDescription>
          </CardHeader>
          <CardContent>
            <RequestDatesForm
              requestId={request.id}
              createdAt={jakartaDay(request.createdAt)}
              completedAt={request.completedAt ? jakartaDay(request.completedAt) : null}
              canComplete={request.status === "COMPLETED" || request.status === "REVISION"}
              requesterId={request.raisedByPicId ? `pic:${request.raisedByPicId}` : request.requesterId}
              code={request.code}
              people={people}
            />
          </CardContent>
        </Card>
      ) : null}


      {mayDecide && next ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              <h3>What happens next?</h3>
            </CardTitle>
            <CardDescription>
              Putuskan apakah {request.type} ini dilanjutkan ke {next === "RFQ" ? "RFQ (quotation/harga)" : "PO (pembelian)"}. Request baru memakai project yang sama dan menautkan ke request ini.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {request.flowStoppedAt ? (
              <p className="mb-3 text-sm">
                <span className="font-medium">Tidak dilanjutkan</span>: diputuskan oleh {request.flowStoppedBy?.name ?? "seseorang"} pada {formatDay(request.flowStoppedAt)}
                {request.flowStoppedNote ? `. Catatan: ${request.flowStoppedNote}` : "."}
              </p>
            ) : null}
            <NextStepForm sourceId={request.id} nextType={next} hasDecision={request.flowStoppedAt !== null} />
          </CardContent>
        </Card>
      ) : request.flowStoppedAt ? (
        <p className="text-sm text-muted-foreground">
          Tidak dilanjutkan ke {next ?? "langkah berikutnya"}: diputuskan oleh {request.flowStoppedBy?.name ?? "seseorang"} pada {formatDay(request.flowStoppedAt)}
          {request.flowStoppedNote ? `. Catatan: ${request.flowStoppedNote}` : "."}
        </p>
      ) : null}

      {assignments.length > 0 ? (
        <details className="group rounded-xl ring-1 ring-foreground/10">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold select-none marker:content-none">
            PIC history <span className="font-normal text-muted-foreground">({assignments.length}), hanya bertambah</span>
          </summary>
          <div className="px-4 pb-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="whitespace-nowrap">{formatDay(row.changedAt)}</TableCell>
                    <TableCell>
                      {row.fromName ?? "Unassigned"} → {row.toName ?? "Unassigned"}
                    </TableCell>
                    <TableCell>{row.changedByName}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      ) : null}

      <details className="group rounded-xl ring-1 ring-foreground/10">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold select-none marker:content-none">
          Status history <span className="font-normal text-muted-foreground">({request.statusHistory.length}), hanya bertambah</span>
        </summary>
        <div className="px-4 pb-4">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Change</TableHead>
                <TableHead>By</TableHead>
                <TableHead>Reason</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {request.statusHistory.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="whitespace-nowrap">{formatDay(row.changedAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {row.fromStatus ? `${REQUEST_STATUS_LABELS[row.fromStatus]} → ` : "Created as "}
                    {REQUEST_STATUS_LABELS[row.toStatus]}
                  </TableCell>
                  <TableCell>{row.changedBy.name}</TableCell>
                  <TableCell>{row.reason ?? "–"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>

      {can(viewer.role, "requests.delete") ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 p-4">
          <p className="text-sm text-muted-foreground">Hapus request ini (Superadmin dan Admin). Riwayatnya tetap ada di audit log.</p>
          <DeleteRequest requestId={request.id} requestCode={request.code} />
        </div>
      ) : null}
    </div>
  );
}

/**
 * Who may be named as the requester: the active accounts, and the SOA PICs who raise requests through the shared SOA login.
 * The one now on the request stays in the list even if it was deactivated.
 */
async function requesterChoices(request: RequestDetail): Promise<{ value: string; name: string; codePrefix: string | null }[]> {
  const [users, pics] = await Promise.all([
    getDb().user.findMany({ where: { OR: [{ isActive: true }, { id: request.requesterId }] }, select: { id: true, name: true, codePrefix: true }, orderBy: { name: "asc" } }),
    getDb().pic.findMany({ where: { team: "SOA", OR: [{ isActive: true }, ...(request.raisedByPicId ? [{ id: request.raisedByPicId }] : [])] }, select: { id: true, name: true, codePrefix: true }, orderBy: { name: "asc" } }),
  ]);
  return [
    ...users.map((user) => ({ value: user.id, name: user.name, codePrefix: user.codePrefix })),
    ...pics.map((pic) => ({ value: `pic:${pic.id}`, name: `${pic.name} (PIC SOA)`, codePrefix: pic.codePrefix })),
  ];
}
