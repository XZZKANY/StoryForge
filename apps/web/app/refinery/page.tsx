import { JudgeIssueList } from "../../components/judge-panel/JudgeIssueList";
import { RepairDiffViewer } from "../../components/diff-viewer/RepairDiffViewer";

const sourceText = "林岚在灯塔港等待补给船，潮声盖过了旧无线电的杂音。";
const candidateText = "林岚站在灯塔港，等待补给船穿过晨雾靠岸。";

export default function RefineryPage() {
  return (
    <main aria-labelledby="refinery-title">
      <h1 id="refinery-title">Refinery 修订工坊</h1>
      <p>Refinery 用于对照原文、候选稿、评审问题和修订差异。</p>
      <section aria-labelledby="text-comparison-title">
        <h2 id="text-comparison-title">文本对照</h2>
        <article>
          <h3>原文</h3>
          <p>{sourceText}</p>
        </article>
        <article>
          <h3>候选稿</h3>
          <p>{candidateText}</p>
        </article>
      </section>
      <JudgeIssueList />
      <RepairDiffViewer originalText={candidateText} revisedText="林岚在灯塔港等待补给船，晨雾中仍能听见旧无线电的杂音。" />
      <section aria-labelledby="patch-title">
        <h2 id="patch-title">补丁</h2>
        <p>修订补丁会保留证据锚点，并标记需要人工确认的位置。</p>
      </section>
    </main>
  );
}
