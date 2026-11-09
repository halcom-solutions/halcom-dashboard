"use client";

import { useActionState, useState } from "react";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { SaveText } from "@/components/ui/save-text";
import { Textarea } from "@/components/ui/textarea";
import { ROLE_LABELS, ROLES, type Role } from "@/domain/access/roles";
import type { ApprovalStepConfig, CategoryConfig, DocumentConfig, QuotationConfig, StepCondition, TaxSchemeConfig } from "@/domain/quotations/config";
import { saveQuotationConfigAction, setNextNumberAction } from "./actions";

/** Percent text ("1,5") from basis points and back. */
const toPercent = (bp: number) => String(bp / 100).replace(".", ",");
const fromPercent = (text: string) => Math.round(Number(text.replace(",", ".")) * 100);
/** Rupiah text from cents and back (whole rupiah). */
const toRupiah = (cents: string) => String(BigInt(cents || "0") / 100n);
const fromRupiah = (text: string) => `${text.replace(/\D/g, "") || "0"}00`;

function Box({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div>
        <h3 className="font-semibold">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {children}
    </section>
  );
}
function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className ?? ""}`}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
function Check({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled: boolean }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} disabled={disabled} className="size-4" />
      {label}
    </label>
  );
}

/**
 * The rules of calculations and quotations, as Admin and Superadmin keep them (D-088): item categories, tax schemes (WAPU, Non-WAPU or
 * new ones), the approval steps and when each is needed, and what the quotation shows. Saved as one document; the server checks every
 * reference before it stores anything.
 */
export function QuotationConfigEditor({ config, users, editable, nextNumber }: { config: QuotationConfig; users: readonly { id: string; name: string; role: Role }[]; editable: boolean; nextNumber: number }) {
  const [value, setValue] = useState<QuotationConfig>(config);
  const [state, action, pending] = useActionState<FormState, FormData>(saveQuotationConfigAction, null);
  const [numberState, numberAction, numberPending] = useActionState<FormState, FormData>(setNextNumberAction, null);
  const off = !editable;

  const setCategory = (index: number, patch: Partial<CategoryConfig>) => setValue((v) => ({ ...v, categories: v.categories.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));
  const setScheme = (index: number, patch: Partial<TaxSchemeConfig>) => setValue((v) => ({ ...v, taxSchemes: v.taxSchemes.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  const setStep = (index: number, patch: Partial<ApprovalStepConfig>) => setValue((v) => ({ ...v, steps: v.steps.map((s, i) => (i === index ? { ...s, ...patch } : s)) }));
  const moveStep = (index: number, by: number) =>
    setValue((v) => {
      const steps = [...v.steps];
      const [step] = steps.splice(index, 1);
      steps.splice(index + by, 0, step!);
      return { ...v, steps };
    });
  const setDocument = (patch: Partial<DocumentConfig>) => setValue((v) => ({ ...v, document: { ...v.document, ...patch } }));

  return (
    <div className="flex flex-col gap-6">
      <form action={action} className="flex flex-col gap-6">
        <input type="hidden" name="payload" value={JSON.stringify(value)} />

        <Box title="Langkah persetujuan" description="Dijalankan berurutan. Setiap langkah: siapa yang menyetujui (sebuah peran, atau orang tertentu seperti Direktur atau Komisaris), kapan wajib, dan apa yang terjadi bila tidak wajib. Paling sedikit satu langkah harus selalu wajib.">
          {value.steps.map((step, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Kode">
                  <Input value={step.key} onChange={(e) => setStep(index, { key: e.target.value.toUpperCase() })} disabled={off} className="w-36 font-mono" />
                </Field>
                <Field label="Label bila wajib (di form approval)">
                  <Input value={step.label} onChange={(e) => setStep(index, { label: e.target.value })} disabled={off} className="w-60" />
                </Field>
                <Field label="Label bila hanya diberi tahu">
                  <Input value={step.acknowledgeLabel} onChange={(e) => setStep(index, { acknowledgeLabel: e.target.value })} disabled={off} className="w-60" />
                </Field>
                {editable ? (
                  <div className="flex gap-1">
                    <Button type="button" variant="ghost" size="icon-sm" disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label={`Naikkan langkah ${step.label}`}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={index === value.steps.length - 1} onClick={() => moveStep(index, 1)} aria-label={`Turunkan langkah ${step.label}`}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setValue((v) => ({ ...v, steps: v.steps.filter((_, i) => i !== index) }))} aria-label={`Hapus langkah ${step.label}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-start gap-3">
                <Field label="Penyetuju">
                  <NativeSelect value={step.approver.kind} onChange={(e) => setStep(index, { approver: e.target.value === "ROLE" ? { kind: "ROLE", role: "PURCHASING" } : { kind: "USERS", userIds: [] } })} disabled={off}>
                    <option value="ROLE">Peran</option>
                    <option value="USERS">Orang tertentu</option>
                  </NativeSelect>
                </Field>
                {step.approver.kind === "ROLE" ? (
                  <Field label="Peran">
                    <NativeSelect value={step.approver.role} onChange={(e) => setStep(index, { approver: { kind: "ROLE", role: e.target.value as Role } })} disabled={off}>
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : (
                  <Field label="Orang (pilih satu atau lebih)">
                    <select
                      multiple
                      value={step.approver.userIds}
                      onChange={(e) => setStep(index, { approver: { kind: "USERS", userIds: [...e.target.selectedOptions].map((option) => option.value) } })}
                      disabled={off}
                      className="h-28 min-w-60 rounded-md border bg-transparent px-2 py-1 text-sm"
                    >
                      {users.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} ({ROLE_LABELS[user.role]})
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <Field label="Wajib bila">
                  <NativeSelect
                    value={step.condition.kind}
                    onChange={(e) => {
                      const kind = e.target.value as StepCondition["kind"];
                      setStep(index, { condition: kind === "ALWAYS" ? { kind } : kind === "GM_BELOW" ? { kind, thresholdBp: 1500 } : { kind, amountCents: "500000000000" } });
                    }}
                    disabled={off}
                  >
                    <option value="ALWAYS">Selalu</option>
                    <option value="GM_BELOW">Gross margin di bawah</option>
                    <option value="REVENUE_AT_LEAST">Revenue (excl PPN) minimal</option>
                  </NativeSelect>
                </Field>
                {step.condition.kind === "GM_BELOW" ? (
                  <Field label="Batas GM (%)">
                    <Input value={toPercent(step.condition.thresholdBp)} onChange={(e) => setStep(index, { condition: { kind: "GM_BELOW", thresholdBp: fromPercent(e.target.value) } })} inputMode="decimal" disabled={off} className="w-24" />
                  </Field>
                ) : null}
                {step.condition.kind === "REVENUE_AT_LEAST" ? (
                  <Field label="Revenue minimal (Rp)">
                    <Input value={toRupiah(step.condition.amountCents)} onChange={(e) => setStep(index, { condition: { kind: "REVENUE_AT_LEAST", amountCents: fromRupiah(e.target.value) } })} inputMode="numeric" disabled={off} className="w-44" />
                  </Field>
                ) : null}
                {step.condition.kind !== "ALWAYS" ? (
                  <Field label="Bila tidak wajib">
                    <NativeSelect value={step.whenNotRequired} onChange={(e) => setStep(index, { whenNotRequired: e.target.value as "ACKNOWLEDGE" | "SKIP" })} disabled={off}>
                      <option value="ACKNOWLEDGE">Diberi tahu (boleh tandai &ldquo;Diketahui&rdquo;)</option>
                      <option value="SKIP">Dilewati</option>
                    </NativeSelect>
                  </Field>
                ) : null}
                <div className="self-end pb-2">
                  <Check label="Boleh mengoreksi COGS saat gilirannya" checked={step.mayEditCosts} onChange={(mayEditCosts) => setStep(index, { mayEditCosts })} disabled={off} />
                </div>
              </div>
            </div>
          ))}
          {editable ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => setValue((v) => ({ ...v, steps: [...v.steps, { key: `STEP${v.steps.length + 1}`, label: "Disetujui", acknowledgeLabel: "Diketahui", approver: { kind: "USERS", userIds: [] }, condition: { kind: "REVENUE_AT_LEAST", amountCents: "500000000000" }, whenNotRequired: "SKIP", mayEditCosts: false }] }))}
            >
              <Plus aria-hidden /> Tambah langkah
            </Button>
          ) : null}
        </Box>

        <Box title="Skema pajak customer" description="Dipilih per quotation. PPN dihitung dari tarif × faktor DPP; potongan PPh (dipungut atau dipotong customer) menjadi biaya proyek atas revenue kategori yang dipilih.">
          {value.taxSchemes.map((scheme, index) => (
            <div key={index} className="flex flex-col gap-3 rounded-md border p-3">
              <div className="flex flex-wrap items-end gap-3">
                <Field label="Kode">
                  <Input value={scheme.key} onChange={(e) => setScheme(index, { key: e.target.value.toUpperCase() })} disabled={off} className="w-32 font-mono" />
                </Field>
                <Field label="Nama">
                  <Input value={scheme.label} onChange={(e) => setScheme(index, { label: e.target.value })} disabled={off} className="w-40" />
                </Field>
                <Field label="Keterangan" className="min-w-64 flex-1">
                  <Input value={scheme.description} onChange={(e) => setScheme(index, { description: e.target.value })} disabled={off} />
                </Field>
                <Field label="PPN (%)">
                  <Input value={toPercent(scheme.ppnRateBp)} onChange={(e) => setScheme(index, { ppnRateBp: fromPercent(e.target.value) })} inputMode="decimal" disabled={off} className="w-20" />
                </Field>
                <Field label="Faktor DPP">
                  <span className="flex items-center gap-1">
                    <Input value={scheme.dppNumerator} onChange={(e) => setScheme(index, { dppNumerator: Number(e.target.value) || 0 })} inputMode="numeric" disabled={off} className="w-14" />/
                    <Input value={scheme.dppDenominator} onChange={(e) => setScheme(index, { dppDenominator: Number(e.target.value) || 0 })} inputMode="numeric" disabled={off} className="w-14" />
                  </span>
                </Field>
                <Check label="Bawaan" checked={value.defaultTaxScheme === scheme.key} onChange={() => setValue((v) => ({ ...v, defaultTaxScheme: scheme.key }))} disabled={off} />
                {editable ? (
                  <Button type="button" variant="ghost" size="icon-sm" onClick={() => setValue((v) => ({ ...v, taxSchemes: v.taxSchemes.filter((_, i) => i !== index) }))} aria-label={`Hapus skema ${scheme.label}`}>
                    <Trash2 aria-hidden />
                  </Button>
                ) : null}
              </div>
              {scheme.withholdings.map((withholding, w) => (
                <div key={w} className="ml-4 flex flex-wrap items-end gap-3">
                  <Field label="Potongan">
                    <Input value={withholding.label} onChange={(e) => setScheme(index, { withholdings: scheme.withholdings.map((x, i) => (i === w ? { ...x, label: e.target.value } : x)) })} disabled={off} className="w-60" />
                  </Field>
                  <Field label="Tarif (%)">
                    <Input value={toPercent(withholding.rateBp)} onChange={(e) => setScheme(index, { withholdings: scheme.withholdings.map((x, i) => (i === w ? { ...x, rateBp: fromPercent(e.target.value) } : x)) })} inputMode="decimal" disabled={off} className="w-20" />
                  </Field>
                  <div className="flex flex-wrap gap-3 pb-2">
                    {value.categories.map((category) => (
                      <Check
                        key={category.key}
                        label={category.label}
                        checked={withholding.categories.includes(category.key)}
                        onChange={(on) => setScheme(index, { withholdings: scheme.withholdings.map((x, i) => (i === w ? { ...x, categories: on ? [...x.categories, category.key] : x.categories.filter((c) => c !== category.key) } : x)) })}
                        disabled={off}
                      />
                    ))}
                  </div>
                  {editable ? (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setScheme(index, { withholdings: scheme.withholdings.filter((_, i) => i !== w) })} aria-label={`Hapus potongan ${withholding.label}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
              {editable ? (
                <Button type="button" variant="ghost" size="sm" className="ml-4 w-fit" onClick={() => setScheme(index, { withholdings: [...scheme.withholdings, { key: `W${scheme.withholdings.length + 1}`, label: "PPh", rateBp: 200, categories: [value.categories[0]?.key ?? "GOODS"] }] })}>
                  <Plus aria-hidden /> Tambah potongan
                </Button>
              ) : null}
            </div>
          ))}
          {editable ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setValue((v) => ({ ...v, taxSchemes: [...v.taxSchemes, { key: `SCHEME${v.taxSchemes.length + 1}`, label: "Skema baru", description: "", ppnRateBp: 1200, dppNumerator: 11, dppDenominator: 12, withholdings: [] }] }))}>
              <Plus aria-hidden /> Tambah skema pajak
            </Button>
          ) : null}
        </Box>

        <Box title="Kategori item" description="Kategori tiap baris calculation. Produk Jurnal: produk yang dipakai saat quotation dikirim ke Jurnal. Kata kunci: item BOQ yang kategorinya atau namanya memuat kata ini masuk ke kategori ini (dipisah koma).">
          {value.categories.map((category, index) => (
            <div key={index} className="flex flex-wrap items-end gap-3">
              <Field label="Kode">
                <Input value={category.key} onChange={(e) => setCategory(index, { key: e.target.value.toUpperCase() })} disabled={off} className="w-32 font-mono" />
              </Field>
              <Field label="Nama">
                <Input value={category.label} onChange={(e) => setCategory(index, { label: e.target.value })} disabled={off} className="w-40" />
              </Field>
              <Field label="Produk Jurnal">
                <Input value={category.jurnalProduct} onChange={(e) => setCategory(index, { jurnalProduct: e.target.value })} disabled={off} className="w-44" />
              </Field>
              <Field label="Kata kunci" className="min-w-64 flex-1">
                <Input value={category.keywords.join(", ")} onChange={(e) => setCategory(index, { keywords: e.target.value.split(",").map((word) => word.trim()) })} disabled={off} />
              </Field>
              {editable ? (
                <Button type="button" variant="ghost" size="icon-sm" onClick={() => setValue((v) => ({ ...v, categories: v.categories.filter((_, i) => i !== index) }))} aria-label={`Hapus kategori ${category.label}`}>
                  <Trash2 aria-hidden />
                </Button>
              ) : null}
            </div>
          ))}
          {editable ? (
            <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => setValue((v) => ({ ...v, categories: [...v.categories, { key: `CAT${v.categories.length + 1}`, label: "Kategori baru", jurnalProduct: "", keywords: [] }] }))}>
              <Plus aria-hidden /> Tambah kategori
            </Button>
          ) : null}
        </Box>

        <Box title="Tampilan quotation (PDF)" description="Kop, catatan dan kolom yang tampil di PDF quotation untuk customer.">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Judul dokumen">
              <Input value={value.document.title} onChange={(e) => setDocument({ title: e.target.value })} disabled={off} />
            </Field>
            <Field label="Nama perusahaan">
              <Input value={value.document.companyName} onChange={(e) => setDocument({ companyName: e.target.value })} disabled={off} />
            </Field>
            <Field label="Alamat perusahaan">
              <Textarea value={value.document.companyAddress} onChange={(e) => setDocument({ companyAddress: e.target.value })} rows={2} disabled={off} />
            </Field>
            <Field label="Kontak (telepon, email, situs)">
              <Textarea value={value.document.companyContact} onChange={(e) => setDocument({ companyContact: e.target.value })} rows={2} disabled={off} />
            </Field>
            <Field label="NPWP">
              <Input value={value.document.companyTaxId} onChange={(e) => setDocument({ companyTaxId: e.target.value })} disabled={off} />
            </Field>
            <Field label="Jabatan penandatangan">
              <Input value={value.document.signatoryTitle} onChange={(e) => setDocument({ signatoryTitle: e.target.value })} disabled={off} />
            </Field>
            <Field label="Masa berlaku bawaan (hari)">
              <Input value={value.document.validityDays} onChange={(e) => setDocument({ validityDays: Number(e.target.value) || 0 })} inputMode="numeric" disabled={off} className="w-24" />
            </Field>
            <Field label="Catatan / syarat (tampil di bawah tabel)" className="md:col-span-2">
              <Textarea value={value.document.notes} onChange={(e) => setDocument({ notes: e.target.value })} rows={4} disabled={off} />
            </Field>
          </div>
          <div className="flex flex-wrap gap-4">
            <Check label="Spesifikasi di bawah nama item" checked={value.document.showSpecification} onChange={(showSpecification) => setDocument({ showSpecification })} disabled={off} />
            <Check label="Judul grup (STORAGE, JASA…)" checked={value.document.showGroups} onChange={(showGroups) => setDocument({ showGroups })} disabled={off} />
            <Check label="Kolom harga satuan" checked={value.document.showUnitPrice} onChange={(showUnitPrice) => setDocument({ showUnitPrice })} disabled={off} />
            <Check label="Kolom kategori" checked={value.document.showCategory} onChange={(showCategory) => setDocument({ showCategory })} disabled={off} />
            <Check label="Termin pembayaran" checked={value.document.showTerms} onChange={(showTerms) => setDocument({ showTerms })} disabled={off} />
            <Check label="Kolom tanda tangan" checked={value.document.showSignature} onChange={(showSignature) => setDocument({ showSignature })} disabled={off} />
          </div>
        </Box>

        {editable ? (
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={pending}>
              <SaveText what="konfigurasi quotation" pending={pending} />
            </Button>
            <span className="text-xs text-muted-foreground">Quotation yang sudah diajukan tetap memakai aturan saat diajukan; draft memakai aturan baru.</span>
          </div>
        ) : null}
        <FormStatus state={state} />
      </form>

      <form action={numberAction} className="flex flex-col gap-2 rounded-lg border p-4">
        <h3 className="font-semibold">Nomor quotation berikutnya</h3>
        <p className="text-sm text-muted-foreground">Format mengikuti Jurnal: QUO-&lt;tahun&gt;-&lt;bulan&gt;-&lt;nomor urut&gt;. Samakan dengan nomor terakhir di Jurnal supaya tidak bentrok. Nomor hanya bisa dimajukan.</p>
        <div className="flex items-end gap-2">
          <Field label="Nomor urut berikutnya">
            <Input name="next" defaultValue={nextNumber} inputMode="numeric" disabled={off} className="w-36" />
          </Field>
          {editable ? (
            <Button type="submit" variant="outline" disabled={numberPending}>
              <SaveText what="nomor berikutnya" pending={numberPending} />
            </Button>
          ) : null}
        </div>
        <FormStatus state={numberState} />
      </form>
    </div>
  );
}
