"use client";

import { useActionState, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FormStatus, type FormState } from "@/components/ui/form-status";
import { Input } from "@/components/ui/input";
import { SaveText } from "@/components/ui/save-text";
import { importBoqItemsAction, saveBoqItemsAction } from "./actions";

export type BoqItemRow = { groupLabel: string; name: string; specification: string; categoryLabel: string; uom: string; quantity: string; note: string };

const BLANK: BoqItemRow = { groupLabel: "", name: "", specification: "", categoryLabel: "", uom: "Unit", quantity: "", note: "" };

/**
 * The items of a BOQ: what SOA offers (unit name, specification, category, unit, quantity, in groups), without prices. SOA types them or
 * uploads the BOQ workbook; Sales' new calculation for the project starts from them.
 */
export function BoqItems({ requestId, items, editable }: { requestId: string; items: BoqItemRow[]; editable: boolean }) {
  const [rows, setRows] = useState<BoqItemRow[]>(items.length || !editable ? items : [{ ...BLANK }]);
  const [saved, save, saving] = useActionState<FormState, FormData>(saveBoqItemsAction, null);
  const [imported, importSheet, importing] = useActionState<FormState, FormData>(importBoqItemsAction, null);
  const set = (index: number, patch: Partial<BoqItemRow>) => setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  if (!editable) {
    if (items.length === 0) return null;
    return (
      <div className="mt-4 border-t pt-4">
        <h3 className="mb-2 text-sm font-semibold">Item BOQ ({items.length})</h3>
        <ol className="flex flex-col gap-1 text-sm">
          {items.map((item, index) => (
            <li key={index}>
              {item.groupLabel && item.groupLabel !== items[index - 1]?.groupLabel ? <p className="mt-2 text-xs font-semibold uppercase text-muted-foreground">{item.groupLabel}</p> : null}
              <span className="font-medium">{item.name}</span> · {item.quantity} {item.uom}
              {item.specification ? <span className="block text-xs whitespace-pre-line text-muted-foreground">{item.specification}</span> : null}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t pt-4">
      <div>
        <h3 className="text-sm font-semibold">Item BOQ</h3>
        <p className="text-xs text-muted-foreground">Nama unit, spesifikasi, satuan dan qty ini otomatis mengisi draft calculation Sales dan masuk ke quotation (dan Jurnal). Harga diisi Sales.</p>
      </div>
      <form action={importSheet} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <Input type="file" name="file" accept=".xlsx" required aria-label="Berkas Excel BOQ" className="w-auto" />
        <Button type="submit" variant="outline" size="sm" disabled={importing}>
          {importing ? "Mengimpor…" : "Impor dari Excel (ganti semua item)"}
        </Button>
        <span className="text-xs text-muted-foreground">Kolom dikenali dari judulnya: Nama Barang, Spesifikasi, Kategori, Uom, Qty (Add = FALSE dilewati).</span>
      </form>
      <FormStatus state={imported} />
      <form action={save} className="flex flex-col gap-2">
        <input type="hidden" name="requestId" value={requestId} />
        <input type="hidden" name="items" value={JSON.stringify(rows)} />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="text-xs text-muted-foreground">
              <tr>
                <th className="px-1 text-left">Grup</th>
                <th className="px-1 text-left">Nama unit *</th>
                <th className="px-1 text-left">Spesifikasi</th>
                <th className="px-1 text-left">Kategori</th>
                <th className="px-1 text-left">UoM</th>
                <th className="px-1 text-left">Qty *</th>
                <th className="px-1 text-left">Catatan</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} className="align-top">
                  <td className="p-1"><Input value={row.groupLabel} onChange={(event) => set(index, { groupLabel: event.target.value })} maxLength={120} aria-label={`Grup item ${index + 1}`} className="w-28" /></td>
                  <td className="p-1"><Input value={row.name} onChange={(event) => set(index, { name: event.target.value })} maxLength={500} aria-label={`Nama unit item ${index + 1}`} /></td>
                  <td className="p-1"><textarea value={row.specification} onChange={(event) => set(index, { specification: event.target.value })} maxLength={4000} rows={2} aria-label={`Spesifikasi item ${index + 1}`} className="w-full min-w-48 rounded-md border bg-transparent px-2 py-1 text-xs" /></td>
                  <td className="p-1"><Input value={row.categoryLabel} onChange={(event) => set(index, { categoryLabel: event.target.value })} maxLength={60} aria-label={`Kategori item ${index + 1}`} className="w-32" placeholder="Storage, Jasa…" /></td>
                  <td className="p-1"><Input value={row.uom} onChange={(event) => set(index, { uom: event.target.value })} maxLength={30} aria-label={`UoM item ${index + 1}`} className="w-20" /></td>
                  <td className="p-1"><Input value={row.quantity} onChange={(event) => set(index, { quantity: event.target.value })} inputMode="decimal" aria-label={`Qty item ${index + 1}`} className="w-20 text-right" /></td>
                  <td className="p-1"><Input value={row.note} onChange={(event) => set(index, { note: event.target.value })} maxLength={300} aria-label={`Catatan item ${index + 1}`} /></td>
                  <td className="p-1">
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => setRows((current) => current.filter((_, i) => i !== index))} aria-label={`Hapus item ${index + 1}`}>
                      <Trash2 aria-hidden />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setRows((current) => [...current, { ...BLANK, groupLabel: current.at(-1)?.groupLabel ?? "", categoryLabel: current.at(-1)?.categoryLabel ?? "" }])}>
            <Plus aria-hidden /> Tambah item
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            <SaveText what="item BOQ" pending={saving} />
          </Button>
        </div>
        <FormStatus state={saved} />
      </form>
    </div>
  );
}
