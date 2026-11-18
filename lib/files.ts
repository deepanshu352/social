import type { Ctx } from "./auth";
import { sha256 } from "./security";

const MAX = 5 * 1024 * 1024;
const MAGIC: [string, (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"],
  ["application/pdf", (b) => b.subarray(0, 5).toString() === "%PDF-"],
];

/** Validates an upload by size and *content* (magic bytes), not by the client-declared type, then stores it. */
export async function storeUpload(ctx: Ctx, file: File) {
  if (!file || !file.size) throw new Error("No file selected");
  if (file.size > MAX) throw new Error("File is larger than 5 MB");
  const data = Buffer.from(await file.arrayBuffer());
  const mime = MAGIC.find(([, test]) => test(data))?.[0];
  if (!mime) throw new Error("Only JPG, PNG, WEBP or PDF files are allowed");
  const name = file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "upload";
  return ctx.db.fileBlob.create({ data: { tenantId: ctx.tenant.id, name, mime, size: data.length, data, sha256: sha256(data), uploadedById: ctx.membership.id } });
}
