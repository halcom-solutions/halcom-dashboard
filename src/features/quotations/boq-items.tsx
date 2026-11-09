"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { importBoqItemsAction } from "./actions";

export type BoqItemRow = { groupLabel: string; name: string; specification: string; uom: string; quantity: string };

/**
 * The BOQ Excel SOA send on a BOQ request, and what Sales get from it: unit name, specification, unit of measure and quantity, in their
 * groups. SOA only upload the workbook (a new upload replaces the items); everybody else sees the mapped list.
 */
export function BoqItems({ requestId, items, mayUpload }: { requestId: string; items: BoqItemRow[]; mayUpload: boolean }) {
  const [state, upload, uploading] = useActionState<FormState, FormData>(importBoqItemsAction, null);
  if (!mayUpload && items.length === 0) return null;
  return (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">Excel BOQ {items.length ? `(${items.length} item)` : ""}</h3>
        <p className="text-xs text-muted-foreground">
          Nama, spesifikasi, UoM dan Qty dari Excel ini otomatis mengisi draft calculation Sales dan masuk ke quotation (dan Jurnal). Kolom harga, margin dan vendor di Excel tidak dipakai.
        </p>
      </div>
      {mayUpload ? (
        <form action={upload} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="requestId" value={requestId} />
          <Input type="file" name="file" accept=".xlsx" required aria-label="Berkas Excel BOQ" className="w-auto" />
          <Button type="submit" size="sm" disabled={uploading}>
            {uploading ? "Mengirim…" : items.length ? "Kirim Excel baru (ganti)" : "Kirim Excel BOQ"}
          </Button>
          <span className="text-xs text-muted-foreground">Kolom dikenali dari judulnya: Nama Barang, Spesifikasi, Uom, Qty. Baris judul grup ikut; Add = FALSE dilewati.</span>
        </form>
      ) : null}
      <FormStatus state={state} />
      {items.length ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="bg-muted/60 text-xs">
              <tr>
                <th className="w-8 px-2 py-1.5 text-left">No</th>
                <th className="px-2 py-1.5 text-left">Nama</th>
                <th className="px-2 py-1.5 text-left">Spesifikasi</th>
                <th className="w-20 px-2 py-1.5 text-left">UoM</th>
                <th className="w-16 px-2 py-1.5 text-right">Qty</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => [
                item.groupLabel && item.groupLabel !== items[index - 1]?.groupLabel ? (
                  <tr key={`group-${index}`} className="border-t bg-muted/30">
                    <td colSpan={5} className="px-2 py-1 text-xs font-semibold uppercase">
                      {item.groupLabel}
                    </td>
                  </tr>
                ) : null,
                <tr key={index} className="border-t align-top">
                  <td className="px-2 py-1.5 text-xs text-muted-foreground">{index + 1}</td>
                  <td className="px-2 py-1.5 font-medium">{item.name}</td>
                  <td className="px-2 py-1.5 text-xs whitespace-pre-line text-muted-foreground">{item.specification}</td>
                  <td className="px-2 py-1.5">{item.uom}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{item.quantity}</td>
                </tr>,
              ])}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
