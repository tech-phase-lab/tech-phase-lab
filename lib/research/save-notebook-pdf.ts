// Call directly from the button's click handler, without awaiting PDF creation.
// Never navigate the reading tab or invoke the browser's print dialog.
export async function saveNotebookPdf(file: File, url: string, title: string, browser = navigator, page = document): Promise<void> {
  if (browser.canShare?.({ files: [file] })) {
    await browser.share({ files: [file], title });
    return;
  }
  const link = page.createElement("a");
  link.href = url;
  link.download = file.name;
  link.target = "_blank";
  link.rel = "noopener";
  page.body.append(link);
  try { link.click(); } finally { link.remove(); }
}
