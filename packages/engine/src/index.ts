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
export type { RegexCompiler, SearchPattern } from './kernel/fsProjectTools';
export { REGEX_MATCH_SECONDS, scanRegexLines, type RegexScan } from './kernel/regexScan';
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
export { pythonCasefold } from './kernel/casefold';
export { sha256Bytes, sha256Hex } from './kernel/sha256';
export { pythonSplitlines } from './kernel/pythonText';
export {
  fsRead,
  normalizeProjectRelativePath,
  resolveProjectFile,
  visibleTarget,
} from './kernel/fsTools';
export {
  hasKnowledgeBlockMarker,
  isKnowledgeSha256,
  knowledgeClaimFingerprint,
  KnowledgeEntryError,
  parseKnowledgeMarkdown,
  plainNotesOutsideKnowledgeBlocks,
  renderKnowledgeEntry,
  upsertKnowledgeEntry,
  validateKnowledgeEntry,
} from './kernel/knowledgeEntries';
export type {
  KnowledgeEntry,
  KnowledgeParseResult,
  KnowledgeSource,
} from './kernel/knowledgeEntries';
export {
  loadProjectKnowledgeDocument,
  projectKnowledgeEntryIndex,
  projectKnowledgeRead,
  projectKnowledgeSearch,
  readProjectContextFile,
  validateEligibleFile,
  validateProjectKnowledgeMarkdownTarget,
} from './kernel/projectKnowledgeFiles';
export type {
  IndexedProjectKnowledgeEntry,
  ProjectKnowledgeEntryIndex,
} from './kernel/projectKnowledgeFiles';
export {
  knowledgeEntryEvidenceState,
  materializeKnowledgeSelection,
  retrieveProjectKnowledge,
  selectKnowledgeEntries,
} from './kernel/knowledgeRetrieval';
export type {
  KnowledgeRetrievalResult,
  KnowledgeSelection,
  RetrievedKnowledgeEntry,
} from './kernel/knowledgeRetrieval';
export {
  buildKnowledgeProposalGroup,
  KNOWLEDGE_PROPOSAL_ARTIFACT_KIND,
  projectFileEvidenceHash,
  projectFingerprint,
} from './kernel/knowledgeProposals';
export type { ProposalEnvironment } from './kernel/knowledgeProposals';
export {
  collectOrdinaryContext,
  looksLikeHarnessPayload,
  ordinaryContextFileAsContext,
  sourceDeliveryManifest,
} from './kernel/ordinaryContext';
export type {
  CollectedOrdinaryContext,
  ContextFileRequest,
  OrdinaryContextFile,
} from './kernel/ordinaryContext';
export {
  collectProjectKnowledgeContext,
  mergeProjectKnowledgeEntries,
  projectKnowledgeRecoveryReceipt,
} from './kernel/knowledgeContext';
export type { CollectedProjectKnowledge } from './kernel/knowledgeContext';
export {
  compileKnowledgeOperation,
  materializedSource,
  replaceSamePathProjectSources,
} from './kernel/knowledgeMaterialization';
export {
  AUTHOR_CRAFT_PRIORITY,
  CLICHE_PHRASES,
  CRAFT_GUIDELINES,
  craftPromptClause,
  REVIEW_RUBRICS,
  reviewRubricClause,
  SCENE_COLLAPSE_TEST,
  SCENE_DISCIPLINE_ITEMS,
  sceneDisciplineClause,
  sceneDisciplineGuardClause,
} from './kernel/craft';
export {
  appendStyleBaselineToSystemPrompt,
  buildStyleBaseline,
  markerCount,
  splitSentences,
  styleBaselineClause,
  styleFingerprint,
} from './kernel/styleBaseline';
export type { StyleBaseline, StyleFingerprint, StyleTarget } from './kernel/styleBaseline';
export { pythonFloatSum } from './kernel/math';
export {
  appendAuthorInstructionsToSystemPrompt,
  buildGenerationSystemPrompt,
  CONVERSATION_PREFIX,
  editPolicyFromGenerationPrompt,
  GENERATION_PREFIX,
  readAuthorInstructions,
} from './kernel/authorVoice';
export {
  authorCommandText,
  AuthorEditPolicyError,
  authorEditPolicyFailures,
  authorEditPolicyPrompt,
  authorEditPolicySummary,
  buildAuthorEditPolicy,
  POLICY_VERSION,
} from './kernel/authorEditPolicy';
export type { AuthorEditPolicy, ProtectedSpan } from './kernel/authorEditPolicy';
export {
  GenerationDeliveryCapture,
  generationDeliveryReference,
} from './kernel/generationDelivery';
export {
  AgentRoleCatalogError,
  getAgentRole,
  isRoleAllowedTool,
  listAgentRoles,
  listSubagentRoles,
  normalizeAgentRoleInputs,
  resolveAgentRoleAlias,
} from './kernel/roleCatalog';
export type { AgentRole } from './kernel/roleCatalog';
export {
  agentPlanPayload,
  DEFAULT_PERMISSION_PROFILE,
  listAgentSkills,
  skillByName,
} from './kernel/skillCatalog';
export type { AgentSkill } from './kernel/skillCatalog';
export {
  CONFLICT_MARKERS,
  ENDING_HOOK_MARKERS,
  MOTIVATION_MARKERS,
  REVIEW_SKILLS,
  reviewContextSummary,
  suggestedActionsForReview,
} from './kernel/reviewSkills';
export type { ReviewIssue } from './kernel/reviewSkills';
export {
  heuristicReviewReasoner,
  llmReviewReasoner,
  MAX_REVIEW_PROMPT_CHARS,
  REVIEW_AGENT_KEYS,
} from './kernel/reviewReasoning';
export type { ReviewLlmPort, ReviewReasoner, ReviewSubagentResult } from './kernel/reviewReasoning';
export {
  buildMultiAgentReviewReport,
  continuitySubagentHandler,
  reviewReportSummary,
} from './kernel/reviewReport';
export type { AgentToolTrace, ReviewSubagentExecutor } from './kernel/reviewReport';
export {
  AgentOrchestrationError,
  composeScopedInstruction,
  INSTRUCTION_BUDGET,
  verifyReviewSource,
} from './kernel/reviseDelivery';
export {
  MINIMAL_EDIT_CONTRACT,
  publicReviseScope,
  resolveReviseScope,
  reviseSummaryWithScope,
  revisionReferencesReview,
  scopedReviseInstruction,
  scopeIssues,
  scopeWarning,
} from './kernel/reviseScope';
export type { ReviseScope } from './kernel/reviseScope';
export {
  CROSS_CHAPTER_SYSTEM_PROMPT,
  crossChapterReview,
  MAX_CHAPTERS,
  MIN_CHAPTERS,
  PER_CHAPTER_CHAR_BUDGET,
} from './kernel/crossChapter';
export type { CrossChapterLlmPort } from './kernel/crossChapter';
export {
  ANALYSIS_KEYS,
  ANALYSIS_SCHEMA_VERSION,
  BookBreakdownCancelled,
  BookBreakdownError,
  BREAKDOWN_SYSTEM_PROMPT,
  BreakdownCancellations,
  loadProjectChapters,
  MAX_SOURCE_BYTES,
  parseChapters,
  readBookBreakdownStatus,
  runBookBreakdown,
  selectedContext,
  selectRepresentativeChapters,
  SELECTION_STRATEGY_VERSION,
} from './kernel/bookBreakdown';
export type { BreakdownLlmPort, BreakdownModel } from './kernel/bookBreakdown';
export { DocxReadError, readDocxText } from './kernel/docx';
export { executeIdeCommand, IDE_COMMANDS } from './kernel/ideCommands';
export {
  buildLlmContextSnapshot,
  buildLlmContextSnapshotFromCollected,
  contextChannelRequests,
  llmContextSnapshotTraceSummary,
  reviewChannelSource,
} from './kernel/llmContext';
export type { RunState, SnapshotInput } from './kernel/llmContext';
export {
  llmContextSnapshotToPromptContextBundle,
  MAX_PROMPT_CONTEXT_FILES,
  syntheticContextDelivery,
  syntheticContextSelectedValues,
} from './kernel/llmPromptContext';
export {
  admitWritingRequest,
  ContextBundleValidationError,
  PreparedWritingContext,
  validateAssistantContextBundle,
  WritingContextConflictError,
  writingContextFromGuardedBundle,
  writingContextFromSnapshot,
} from './kernel/writingContext';
export type {
  AssistantContextBundle,
  AssistantContextBundleFile,
  WritingRequest,
} from './kernel/writingContext';
export {
  iterManuscriptFiles,
  PREVIOUS_TAIL_MAX_CHARS,
  previousChapterTail,
} from './kernel/previousChapter';
export {
  applyDeterministicPolish,
  DEFAULT_POLISH_GATE_CONFIG,
  entitySpellingChanges,
  evaluatePolishCandidate,
  groundedFactContradictions,
  POLISH_GATE_VERSION,
  POLISH_RULE_VERSION,
  rebuildPolishableMarkdown,
  selectPolishCandidate,
  splitPolishableMarkdown,
} from './kernel/polishing';
export type {
  PolishCandidate,
  PolishDecision,
  PolishDocument,
  PolishGateConfig,
  PolishGateResult,
} from './kernel/polishing';
export {
  buildContinuePrompt,
  CONTINUE_SYSTEM_PROMPT,
  DEFAULT_TARGET_CHARS,
  finalizeContinuation,
  insertAtAnchor,
  manuscriptSuffix,
  manuscriptTail,
  resolveAnchorLine,
  stripRepeatedPrefix,
  SUFFIX_MAX_CHARS,
  TAIL_MAX_CHARS,
  trimToSentenceEnd,
} from './assistant/continuation';
export {
  buildRevisionPrompt,
  EXPANSION_POLISH_GATE_CONFIG,
  instructionAuthorizesExpansion,
  REVISION_SYSTEM_PROMPT,
  reviseText,
  RevisionQualityRejected,
} from './assistant/revision';
export type {
  RevisionContextFile,
  RevisionGenerator,
  RevisionInput,
  RevisionResult,
} from './assistant/revision';
export {
  buildChatPrompt,
  buildDraftPrompt,
  CHAT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
} from './assistant/prompts';
export {
  AssistantLlmNotConfiguredError,
  AssistantReviseError,
  AssistantReviseQualityGateError,
  AssistantSessionConflictError,
  AssistantSessionNotFoundError,
  chatReply,
  draftFileContent,
  engineAssistantLlm,
  reviseFileContent,
  streamContinueProse,
} from './assistant/service';
export type {
  AssistantDeps,
  AssistantLlm,
  AssistantMessageInput,
  AssistantSessionRef,
  AssistantStore,
  ContinueFrame,
  ContinueRequest,
  DraftRequest,
  DraftResponse,
  ReviseRequest,
  ReviseResponse,
  StoredToolCall,
  ToolCallPatch,
} from './assistant/service';
export { PROBE_TIMEOUT_CAP_SECONDS, probeProviderHealth } from './assistant/providerHealth';
export type { ProviderHealthDeps, ProviderHealthResponse } from './assistant/providerHealth';
export type { IdeCommandDefinition, IdeCommandDeps } from './kernel/ideCommands';
export {
  credentialHeaderValues,
  envValue,
  LlmConfigError,
  LlmConfigFileError,
  llmRequestHeaders,
  missingLlmEnv,
  optionalFloat,
  optionalInt,
  providerFamily,
  providerHeaders,
  providerRequestHeaders,
  pythonFloat,
  pythonInt,
  REQUIRED_REAL_LLM_ENV,
  requiredEnv,
  userAgent,
} from './llm/config';
export type { LlmSource, ProviderFamily } from './llm/config';
export {
  assistantMessage,
  buildChatPayload,
  chatPayloadText,
  isRetryableStatus,
  LlmError,
  messageToolCalls,
  redactSecrets,
  RETRY_DELAY_CEILING_SECONDS,
  retryAfterSeconds,
  retryDelay,
  streamDeltaText,
  streamFinishReason,
  withSecrets,
} from './llm/payload';
export { decodeModelList, InvalidModelList, modelsUrl, pythonUnquote } from './llm/protocol';
export type { ProviderModelList } from './llm/protocol';
export { StreamingReasoningFilter, stripReasoningLeak, VisibleTextFilter } from './llm/text';
export { costBreakdown, providerCacheHitTokens, tokenUsage } from './llm/usage';
export type { CostBreakdown, LegacyUsage } from './llm/usage';
export {
  ChatMessage,
  chatResponse,
  MESSAGE_ROLES,
  messagesFromOpenai,
  ProviderError,
  retainErrorUsage,
  retainingStreamUsage,
  toAssistantMessage,
  TokenUsage,
  ToolCall,
  ToolSpec,
  toolsFromOpenai,
} from './llm/contracts';
export type {
  ChatRequest,
  ChatResponse,
  MessageRole,
  ProviderContinuation,
  ProviderErrorCategory,
  ProviderErrorDetails,
  StreamEvent,
  StreamEventKind,
} from './llm/contracts';
export { checkRunInterruption, RunControl, RunInterrupted } from './llm/control';
export type { RunProgress } from './llm/control';
export { OpenAIToolStream, ToolStreamError } from './llm/openaiStream';
export { OpenAICompatibleProvider } from './llm/openaiCompatible';
export type { LlmProvider } from './llm/openaiCompatible';
export {
  HttpTransportError,
  rawStreamChatCompletions,
  requestChatCompletions,
} from './llm/transport';
export type {
  HttpPort,
  HttpRequest,
  HttpResponse,
  LlmContext,
  StreamFrame,
  TransportOptions,
} from './llm/transport';
export {
  callLlm,
  callLlmMessages,
  callLlmStreamed,
  ConfiguredLlmProvider,
  errorUsageSummary,
  fetchProviderModels,
  legacyProviderError,
  ModelListHttpError,
  rejectIncompleteResponse,
  sdkChatRequest,
  sdkProvider,
  streamChatCompletions,
} from './llm/client';
export { AnthropicProvider } from './llm/anthropic';
export { GeminiProvider } from './llm/gemini';
export {
  postJsonWithRetry,
  providerCompleteJson,
  providerSseJson,
  providerUrl,
  pythonQuote,
} from './llm/providerTransport';
export { pythonStrRepr } from './llm/pythonRepr';

// ---- Agent 循环宿主（P3-7：agent-socket / agent-runs 的 ts 档） ----
export {
  AgentHostRejection,
  postAgentControl,
  streamAgentUserMessage,
  type AgentControlAck,
  type AgentHostDeps,
  type FrameScheduler,
} from './loop/agentHost';
export { agentRunSavePoints, listAgentRunEvents, type RunReadDeps } from './loop/savePoints';
export {
  AgentRuntimeError,
  type AgentRuntimeDeps,
  type SessionTitlePort,
} from './loop/agentRuntime';
export { LoopCheckpointStore } from './loop/chatLoopCheckpoints';
export type {
  ArtifactRow,
  ConversationSources,
  MessageRow,
  RunEventRow,
  ToolCallRow,
} from './loop/conversationHistory';
export { AgentRunNotFoundError } from './loop/runEvents';
export { createAgentToolRegistry } from './loop/tools/registry';
export { storeRunSources, storeToolArtifactQuery } from './loop/storeSources';
export type { ToolDeps } from './loop/tools/handlerDeps';
export {
  MemoryRunStore,
  type ArtifactRecord,
  type RunEventRecord,
  type RunRecord,
  type RunStore,
} from './store/runs';

// ---- 引擎库（P4：run 存储落 sqlite，起服收尸） ----
export { SerialQueue, type Db, type SqlRow, type SqlStep, type SqlValue } from './store/db';
export {
  AssistantStoreValidationError,
  AssistantToolCallNotFoundError,
  SqlAssistantStore,
} from './store/sqlAssistant';
export { EngineSchemaError, migrateEngineDb } from './store/schema';
export { RunStoreBrokenError, SqlRunStore } from './store/sqlRuns';
export { reapInterruptedRuns } from './loop/runControlChannel';
export {
  KnowledgeInboxConflictError,
  KnowledgeInboxRequestError,
  materializeKnowledgeProposal,
  queryKnowledgeInbox,
  refreshKnowledgeEvidence,
  resolveKnowledgeProposal,
  reviseKnowledgeProposalGroup,
  type KnowledgeInboxDeps,
} from './loop/knowledgeInbox';
export {
  ChapterCheckHistoryRequestError,
  queryChapterCheckHistory,
  type ChapterCheckHistoryDeps,
} from './loop/chapterCheckHistory';
