//CSV 생성 + 파일 다운로드 유틸 (의존성 없음)
//
//사용처: 대시보드 Export CSV 버튼
//
//RFC 4180 규칙: 쉼표/따옴표/줄바꿈이 있으면 따옴표로 감싸고, 내부 따옴표는 ""로 이스케이프.
//BOM(U+FEFF)을 앞에 붙인다 — 없으면 Excel이 UTF-8을 못 알아채고 한글 전사가 깨진다.

export type CsvColumn<T> = { header: string; value: (row: T) => string | number | null | undefined };

function escapeCell(raw: string | number | null | undefined): string {
  const s = raw == null ? "" : String(raw);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(","));
  }
  //CRLF — Excel 호환
  return "\uFEFF" + lines.join("\r\n");
}

//Blob 다운로드
export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename: string, content: string) {
  downloadFile(filename, content, "text/csv;charset=utf-8");
}

//파일명용 타임스탬프 (2026-07-26T14-03-11 형태, 로컬 시각)
export function fileStamp(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`
  );
}
