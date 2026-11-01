import { NextResponse } from "next/server";
import { getSavedClaims, runExpenses } from "@/agents/expenses";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

// GET  /api/finance/expenses -> { receipts: ExpenseResult[] } from the last run (may be empty)
// POST /api/finance/expenses -> runs receipts now:
//   - via multipart/form-data: uploads receipt files from a chosen folder into data/receipts, then scans them
//   - via JSON: { dir?: string } to scan a specific folder path on disk
//   - with no body: scans the default receipts directory
// Errors come back as { status: "error", message }.
export async function GET() {
  try {
    return NextResponse.json({ receipts: getSavedClaims() });
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const contentType = req.headers.get("content-type") || "";

    // 1. Files uploaded from a folder selection in browser
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const files = formData.getAll("files");
      const validFiles = files.filter(
        (f): f is File => f instanceof File && /\.(png|jpe?g|webp)$/i.test(f.name),
      );

      // If user passed a dir in formData without files
      const formDir = formData.get("dir");
      if (typeof formDir === "string" && formDir.trim() && validFiles.length === 0) {
        const report = await runExpenses({ dir: formDir.trim() });
        return NextResponse.json(report);
      }

      if (validFiles.length === 0) {
        return NextResponse.json(
          {
            status: "error",
            message: "No receipt images (.png, .jpg, .webp) found in the selected folder.",
          },
          { status: 400 },
        );
      }

      const uploadDir = path.resolve(process.cwd(), "data", "receipts");
      await mkdir(uploadDir, { recursive: true });

      for (const file of validFiles) {
        const buffer = Buffer.from(await file.arrayBuffer());
        // Use path.basename to prevent ENOENT if browser sends relative paths like "receipts/image.png"
        const baseName = path.basename(file.name);
        const filePath = path.join(uploadDir, baseName);
        await mkdir(path.dirname(filePath), { recursive: true });
        await writeFile(filePath, buffer);
      }

      const report = await runExpenses({ dir: uploadDir });
      return NextResponse.json(report);
    }

    // 2. Custom folder directory path via JSON { dir: string }
    let dir: string | undefined;
    try {
      const body = (await req.json()) as { dir?: string };
      if (body && typeof body.dir === "string" && body.dir.trim()) {
        dir = body.dir.trim();
      }
    } catch {
      // not JSON or empty body; use default
    }

    const report = await runExpenses({ dir });
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
