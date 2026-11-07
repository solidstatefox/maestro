"use client";

import { useMemo, useState, type ReactNode, type CSSProperties } from "react";
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from "@tanstack/react-table";
import { MoreHorizontal } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export type MaestroDataColumn = { id: string; heading: ReactNode; label: string; width?: number; headerStyle?: CSSProperties };
export type MaestroDataRow = { key: string; cells: ReactNode[]; sortValues?: string[]; rowStyle?: CSSProperties };

/** The shadcn Base Data Table pattern: TanStack owns columns, row model, sorting and resizing.
 * Maestro owns RDF presentation and server-driven pagination outside this component. */
export function MaestroAnalysisDataTable({ columns, rows, selectedKeys, onToggle, onToggleAll, headerStyle, cellStyle, tableStyle, label }: {
  columns: MaestroDataColumn[]; rows: MaestroDataRow[]; selectedKeys: string[];
  onToggle: (key: string, checked: boolean) => void; onToggleAll: (checked: boolean) => void;
  headerStyle?: CSSProperties; cellStyle?: CSSProperties; tableStyle?: CSSProperties; label: string;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const defs = useMemo<ColumnDef<MaestroDataRow>[]>(() => columns.map((col, index) => ({
    id: col.id,
    accessorFn: (row) => row.sortValues?.[index] ?? "",
    header: () => col.heading,
    cell: ({ row }) => row.original.cells[index],
    size: col.width ?? (index === 0 ? 240 : 190),
    minSize: 88, maxSize: 900,
    enableSorting: true,
  })), [columns]);
  const table = useReactTable({ data: rows, columns: defs, state: { sorting }, onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(), getSortedRowModel: getSortedRowModel(),
    columnResizeMode: "onChange", getRowId: (row) => row.key });
  const allSelected = rows.length > 0 && rows.every((row) => selectedKeys.includes(row.key));
  return <Table aria-label={label} className="border-collapse text-xs" style={{ ...tableStyle, width: table.getTotalSize() + 68, tableLayout: "fixed" }}>
    <TableHeader className="sticky top-0 z-20 bg-background"><TableRow>
      <TableHead className="w-9 border px-1 py-0.5 text-center" style={headerStyle}>
        <input type="checkbox" className="size-4 accent-primary" aria-label="Select all results on this page" checked={allSelected} disabled={!rows.length} onChange={(event) => onToggleAll(event.currentTarget.checked)}/>
      </TableHead>
      {table.getHeaderGroups()[0]?.headers.map((header, index) => <TableHead key={header.id} className="relative border px-1.5 py-0.5 text-left font-medium" style={{ ...headerStyle, ...columns[index]?.headerStyle, width: header.getSize() }}>
        <div className="pr-1">{flexRender(header.column.columnDef.header, header.getContext())}</div>
        <span role="separator" tabIndex={0} aria-label={`Resize ${columns[index]?.label ?? "column"}`} aria-orientation="vertical" title="Drag to resize" onMouseDown={header.getResizeHandler()} onTouchStart={header.getResizeHandler()} className="absolute right-0 top-0 z-30 h-full w-1.5 cursor-col-resize touch-none hover:bg-sky-300/40"/>
      </TableHead>)}
      <TableHead className="w-8 border px-1 py-0.5" style={headerStyle}><span className="sr-only">Actions</span></TableHead>
    </TableRow></TableHeader>
    <TableBody>{table.getRowModel().rows.map((row) => <TableRow key={row.id} className="hover:bg-accent/40" style={row.original.rowStyle}>
      <TableCell className="w-9 border px-1 py-0.5 text-center" style={cellStyle}>
        <input type="checkbox" className="size-4 accent-primary" aria-label={`Select ${row.original.sortValues?.[0] ?? row.id}`} checked={selectedKeys.includes(row.id)} onChange={(event) => onToggle(row.id, event.currentTarget.checked)}/>
      </TableCell>
      {row.getVisibleCells().map((cell) => <TableCell key={cell.id} className="border px-1.5 py-0.5 align-top" style={{ ...cellStyle, width: cell.column.getSize() }}>
        {flexRender(cell.column.columnDef.cell, cell.getContext())}
      </TableCell>)}
      <TableCell className="w-8 border px-0.5 py-0.5 text-center" style={cellStyle}>
        <DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="inline-flex size-6 items-center justify-center rounded hover:bg-accent" aria-label="Row actions"><MoreHorizontal className="size-4"/></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end"><DropdownMenuItem disabled title="Export is coming soon">Export</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>)}</TableBody>
  </Table>;
}
