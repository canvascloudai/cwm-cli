export type OutputFormat = "text" | "json";

export function printJson(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

export function printTable(
  rows: Record<string, unknown>[],
  columns: string[],
): void {
  if (rows.length === 0) {
    console.log("(no results)");
    return;
  }
  const widths = columns.map((col) =>
    Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
  );
  const header = columns.map((c, i) => c.padEnd(widths[i]!)).join("  ");
  const sep = widths.map((w) => "-".repeat(w)).join("  ");
  console.log(header);
  console.log(sep);
  for (const row of rows) {
    console.log(columns.map((c, i) => String(row[c] ?? "").padEnd(widths[i]!)).join("  "));
  }
}

export function printKv(obj: Record<string, unknown>, indent = ""): void {
  for (const [k, v] of Object.entries(obj)) {
    if (v !== null && v !== undefined && typeof v === "object" && !Array.isArray(v)) {
      console.log(`${indent}${k}:`);
      printKv(v as Record<string, unknown>, indent + "  ");
    } else if (Array.isArray(v)) {
      console.log(`${indent}${k}: [${v.join(", ")}]`);
    } else {
      console.log(`${indent}${k}: ${v}`);
    }
  }
}
