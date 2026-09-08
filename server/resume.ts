import { PDFParse } from "pdf-parse";

export async function parseResumeText(buffer: Buffer): Promise<string> {
  let parser: PDFParse | undefined;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    return result.text;
  } catch (error) {
    console.error("PDF parse error:", error);
    return "";
  } finally {
    if (parser) await parser.destroy();
  }
}