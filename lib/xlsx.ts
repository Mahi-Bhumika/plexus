import ExcelJS from "exceljs";

export type FilledRow = {
  id: string;
  answer: string | null;
  confidence: number;
  status: "filled" | "flagged";
  sourceRef: string | null;
};

export async function readQuestions(
  filePath: string,
): Promise<{ id: string; number: number; question: string }[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // Find the worksheet with "RFP" in the name
  let ws: ExcelJS.Worksheet | undefined;
  wb.eachSheet((sheet) => {
    if (!ws && sheet.name.includes("RFP")) {
      ws = sheet;
    }
  });

  if (!ws) {
    throw new Error(`No worksheet with "RFP" in the name found in ${filePath}`);
  }

  const results: { id: string; number: number; question: string }[] = [];

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    // row.values is 1-indexed (index 0 is null in exceljs)
    const vals = row.values as ExcelJS.CellValue[];
    const idCell = vals[1];
    const questionCell = vals[2];

    const num = typeof idCell === "number" ? idCell : Number(idCell);
    const question =
      typeof questionCell === "string"
        ? questionCell
        : questionCell != null
          ? String(questionCell)
          : "";

    if (!isNaN(num) && question) {
      results.push({ id: String(num), number: num, question });
    }
  });

  return results;
}

export async function writeFilled(
  filePath: string,
  rows: FilledRow[],
): Promise<void> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(filePath);

  // Find the worksheet with "RFP" in the name
  let ws: ExcelJS.Worksheet | undefined;
  wb.eachSheet((sheet) => {
    if (!ws && sheet.name.includes("RFP")) {
      ws = sheet;
    }
  });

  if (!ws) {
    throw new Error(`No worksheet with "RFP" in the name found in ${filePath}`);
  }

  const rowMap = new Map<string, FilledRow>();
  for (const r of rows) {
    rowMap.set(r.id, r);
  }

  ws.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // skip header

    const vals = row.values as ExcelJS.CellValue[];
    const idCell = vals[1];
    const idStr = String(typeof idCell === "number" ? idCell : idCell ?? "");

    const filledRow = rowMap.get(idStr);
    if (!filledRow) return;

    const answerCell = row.getCell(3); // col 3 = Answer
    const confidenceCell = row.getCell(4); // col 4 = Confidence
    const sourceCell = row.getCell(5); // col 5 = Source

    answerCell.value = filledRow.answer ?? "";
    confidenceCell.value = filledRow.confidence;
    sourceCell.value = filledRow.sourceRef ?? "";

    if (filledRow.status === "flagged") {
      const redFill: ExcelJS.Fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFF4444" },
      };
      answerCell.fill = redFill;
      confidenceCell.fill = redFill;
      sourceCell.fill = redFill;
    }
  });

  await wb.xlsx.writeFile(filePath);
}
