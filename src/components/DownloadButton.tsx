"use client";

export function DownloadButton({
  content,
  filename,
}: {
  content: string;
  filename: string;
}) {
  function download() {
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={download}
      className="secondary-button"
      style={{ padding: "9px 13px" }}
    >
      Download .md
    </button>
  );
}
