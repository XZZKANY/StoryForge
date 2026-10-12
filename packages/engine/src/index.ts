export { isManuscriptPath, orderManuscriptFiles } from './kernel/manuscript';
export { renderBookContextBlock, toBookContextPayload } from './kernel/bookContext';
export type { BookContext, ChapterEntry, RosterEntity, SkeletonFile } from './kernel/bookContext';
export { checkParagraphPatterns } from './kernel/paragraphPatterns';
export type { StaticProseIssue } from './kernel/paragraphPatterns';
export { ProjectReadError } from './readPort';
export type {
  ProjectReader,
  ProjectPathKind,
  ResolvedProjectPath,
  ProjectPathMetadata,
  RawProjectDirectory,
  RawProjectBytes,
} from './readPort';
export { scanProjectFiles, ProjectTreeError } from './kernel/projectTree';
export { buildBookContext } from './kernel/buildBookContext';
export { executeBookContextCommand, IdeCommandExecutionError } from './kernel/bookContextCommand';
export type { SecretContext, PlainJson } from './kernel/redaction';
export {
  InputDomainError,
  JsonFloat,
  MAX_JSON_DEPTH,
  parseJson,
  parseJsonBytes,
} from './kernel/json';
export type { JsonObject, JsonValue } from './kernel/json';
export {
  canonicalPunctuation,
  restoreIncidentalPunctuation,
  DIALOGUE_PATTERN,
} from './kernel/punctuation';
export { checkCanon } from './kernel/canonGate';
export type { CanonGateResult, CanonIssue } from './kernel/canonGate';
export { matchPythonPath } from './kernel/pathMatch';
export { compareCodePoints, dumpJson, pythonFloatRepr } from './kernel/json';
export type { DumpOptions } from './kernel/json';
export { platformTextBytes } from './writePort';
export type { ProjectWriter } from './writePort';
export {
  AUTHOR_INSTRUCTIONS_PATH,
  FsBinaryFileError,
  FsToolError,
  isSkippedProjectPath,
  iterProjectFiles,
  nativeProjectPath,
  readBoundedText,
  resolveProjectRoot,
  resolveScopedPath,
} from './kernel/fsTools';
export type { TextRead } from './kernel/fsTools';
export {
  GenerationSourceCapture,
  MAX_MANIFEST_BYTES,
  MAX_SOURCE_REFS,
  bytesSha256,
  selectionSha256,
  textSha256,
} from './kernel/generationSources';
export type { ProjectionRow, SourceRow } from './kernel/generationSources';
export { consistencyScan } from './kernel/consistencyScan';
export type { ConsistencyScanResult } from './kernel/consistencyScan';
export {
  ASSERTION_METADATA_PROPERTIES,
  assertionMetadata,
  formatChapterWindow,
  normalizeAssertionMetadata,
  renderAssertionMetadata,
} from './kernel/canonAssertions';
export {
  readCanon,
  readDerived,
  readHooks,
  scaffoldCanonIfMissing,
  writeDerived,
  writeDerivedText,
} from './kernel/canonFiles';
export { chapterOrdinals, entitySurfaceForms, rebuildPresence } from './kernel/canonRebuild';
export type { Presence, PresenceEntity, PresenceOccurrence } from './kernel/canonRebuild';
export { buildDossiers, renderDossiersMarkdown } from './kernel/canonDossier';
export type { Dossier } from './kernel/canonDossier';
export { buildCanonProjection, UNCACHED_SCAN_NOTE } from './kernel/canonService';
export type { CanonProjectionResult } from './kernel/canonService';
export { buildSceneConstraintBlock } from './kernel/canonContext';
export { checkProseStaticQuality, proseStaticScan } from './kernel/proseScan';
export type { ProseConstraints } from './kernel/proseScan';
export {
  buildPromiseLedger,
  checkPromises,
  DEFAULT_STALE_AFTER_CHAPTERS,
  promiseCheck,
} from './kernel/promiseScan';
export type { PromiseCheckResult } from './kernel/promiseScan';
export { collapseScan, entityBudgetScan } from './kernel/sceneChecks';
export type { EntityBudgetOptions } from './kernel/sceneChecks';
export { canonDelta, INVARIANT_KEYS, readPendingProposals } from './kernel/canonDelta';
export type { CanonDeltaInput } from './kernel/canonDelta';
export { evaluateHookAdmission, hooksDelta } from './kernel/canonHooksDelta';
export { dossierToJson } from './kernel/canonDossier';
export {
  ALLOWED_STATUSES,
  buildPlan,
  buildPlanBlock,
  cleanText,
  driftedChapters,
  nextChapter,
  PLAN_RELATIVE_PATH,
  planExists,
  positiveInt,
  readPlan,
  renderPlanBlock,
  toPlanPayload,
  writePlan,
  writtenOrdinals,
} from './kernel/serialPlan';
export type { PlannedChapter, SerialPlan } from './kernel/serialPlan';
export {
  applyPlanUpdate,
  markChapterWritten,
  mergePlanPayload,
  rejectPrematureDone,
  unmarkChapterWritten,
} from './kernel/serialPlanUpdate';
export type { PlanUpdates } from './kernel/serialPlanUpdate';
export { runObservatoryScan } from './kernel/observatory';
export { cloneJson, pythonEquals } from './kernel/json';
