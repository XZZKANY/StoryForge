export type RepairDiffViewerProps = {
  originalText: string;
  revisedText: string;
};

export function RepairDiffViewer({ originalText, revisedText }: RepairDiffViewerProps) {
  return (
    <section aria-labelledby="repair-diff-title">
      <h2 id="repair-diff-title">修订差异</h2>
      <div>
        <h3>原文</h3>
        <p>{originalText}</p>
      </div>
      <div>
        <h3>修订文本</h3>
        <p>{revisedText}</p>
      </div>
    </section>
  );
}
