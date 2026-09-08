import { describe, expect, it, vi } from "vitest";
import { parseResumeText } from "./resume.js";
import { createSession } from "./sessions.js";

function makeTextPdf(text: string): Buffer {
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${text}) Tj\nET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

describe("parseResumeText", () => {
  it("extracts non-empty text from a selectable-text PDF and stores it in a session", async () => {
    const resumeText = await parseResumeText(makeTextPdf("Cedar Lantern Resume Marker"));
    const session = createSession({ interviewType: "General", customPrompt: "", resumeText });

    expect(resumeText).toContain("Cedar Lantern Resume Marker");
    expect(resumeText.trim()).not.toBe("");
    expect(session.resumeText).toBe(resumeText);
  });

  it("handles parser failures without throwing to the session creation path", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(parseResumeText(Buffer.from("not a pdf"))).resolves.toBe("");
    expect(errorSpy).toHaveBeenCalledWith("PDF parse error:", expect.anything());
    errorSpy.mockRestore();
  });
});