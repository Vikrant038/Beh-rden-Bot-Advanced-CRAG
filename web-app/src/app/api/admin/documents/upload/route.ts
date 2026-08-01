import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { ingestPdf } from "@/server/ingest/pipeline";
import { ACCEPTED_MIME, MAX_PDF_BYTES } from "@/server/ingest/pdf-parser";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * ADMIN-only PDF upload endpoint (§2.2.4). Validates auth, file size and MIME
 * server-side, then routes the buffer through the parent-child ingest pipeline.
 * The 4 MiB cap is Vercel-safe (4.5 MB platform request-body limit) and is
 * enforced before any buffering happens.
 */
export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user || session.user.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Malformed multipart body" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== ACCEPTED_MIME) {
    return NextResponse.json({ error: "Only .pdf files are accepted" }, { status: 415 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: `File exceeds ${Math.round(MAX_PDF_BYTES / (1024 * 1024))} MB limit` },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  try {
    const result = await ingestPdf(buffer, file.name);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
