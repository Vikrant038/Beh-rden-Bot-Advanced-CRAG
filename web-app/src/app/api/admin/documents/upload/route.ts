import { NextResponse } from "next/server";
import { auth } from "@/server/auth";
import { enqueuePdfJob } from "@/server/ingest/jobs";
import { ACCEPTED_MIME, MAX_PDF_BYTES } from "@/config/app";
import { toErrorMessage } from "@/server/lib/errors";

export const runtime = "nodejs";
// Enqueue-only: parse/chunk/embed now runs in the background cron worker, so
// this route returns in milliseconds instead of risking the serverless cap.
export const maxDuration = 30;

/**
 * ADMIN-only PDF upload endpoint (§2.2.4). Validates auth, file size and MIME
 * server-side, then **enqueues** the buffer for background ingestion (see
 * src/server/ingest/jobs.ts). Returns 202 with a jobId the client polls.
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
  // Optional display-name override (defaults to the filename).
  const titleField = formData.get("title");
  const title =
    typeof titleField === "string" && titleField.trim()
      ? titleField.trim().slice(0, 200)
      : undefined;
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
    const { jobId } = await enqueuePdfJob(buffer, file.name, title);
    return NextResponse.json({ jobId, status: "QUEUED" }, { status: 202 });
  } catch (error) {
    return NextResponse.json({ error: toErrorMessage(error) }, { status: 422 });
  }
}
