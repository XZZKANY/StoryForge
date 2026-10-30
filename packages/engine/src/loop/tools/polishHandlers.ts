import { AuthorEditPolicyError } from '../../kernel/authorEditPolicy';
import {
  buildGenerationSystemPrompt,
  editPolicyFromGenerationPrompt,
} from '../../kernel/authorVoice';
import {
  FsToolError,
  nativeProjectPath,
  resolveProjectFile,
  resolveProjectRoot,
} from '../../kernel/fsTools';
import { pythonStrip } from '../../kernel/pythonText';
import { ProjectReadError } from '../../readPort';
import { PatchProposal } from '../chatLoopTypes';
import { patchRequiresConfirmation } from '../permission';
import { AgentOrchestrationError, optionalString } from '../runPayloads';
import type { ToolHandler } from './execution';
import type { ToolDeps } from './handlerDeps';
import { prepareRuntimeWritingContext } from './patchContext';
import {
  polishAuthorRequirementsFromContextSnapshot,
  polishConstraintsFromContextSnapshot,
} from './polishContext';
import {
  polishSummary,
  polishTraceSummary,
  runControlledPolish,
  validatePolishablePath,
} from './polishService';
import {
  llmContextInputSummary,
  requiredString,
  requiredText,
  stringList,
} from './runtimeArguments';

type Obj = { [key: string]: unknown };
const isObj = (value: unknown): value is Obj =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const cpLen = (text: string) => Array.from(text).length;
const unique = (values: readonly string[]) => [...new Set(values)];
const TARGET_REFUSED = '润色目标必须是作品内现有的 Markdown 或 TXT 正文，不能是结构化或派生文件。';

/** chapter.polish：保守润色一章正文，通过相对原文质量门禁才产补丁（patches/runtime_tools）。 */
export function polishToolHandlers(deps: ToolDeps): Record<string, ToolHandler> {
  const { reader, platform, secrets } = deps;
  const contextDeps = { reader, platform, secrets };

  /** 桌面给的路径换成项目内目标；追溯用的别名不能借此获得访问权。 */
  async function resolvePolishableTarget(
    root: string | null,
    filePath: string,
    traceFilePath: string,
  ): Promise<[string, string]> {
    if (!root) return [filePath, validatePolishablePath(traceFilePath || filePath)];
    try {
      await resolveProjectRoot(reader, root);
      const raw = pythonStrip(filePath.replace(/\\/g, '/'));
      const prefix = root.replace(/\\/g, '/').replace(/\/+$/, '');
      const absolute = raw.startsWith('/') || /^[A-Za-z]:/.test(raw);
      let lexical = raw;
      if (absolute) {
        const same = platform === 'windows' ? (a: string) => a.toLowerCase() : (a: string) => a;
        if (!same(raw).startsWith(same(prefix) + '/')) throw new RangeError('outside project');
        lexical = raw.slice(prefix.length + 1);
      }
      validatePolishablePath(lexical);
      const target = await resolveProjectFile(reader, root, raw);
      return [nativeProjectPath(root, target, platform), validatePolishablePath(target)];
    } catch (error) {
      if (
        error instanceof FsToolError ||
        error instanceof ProjectReadError ||
        error instanceof RangeError
      )
        throw new AgentOrchestrationError(TARGET_REFUSED);
      throw error;
    }
  }

  const chapterPolish: ToolHandler = async (context, payload) => {
    const requested = requiredString(payload, 'file_path');
    const root = optionalString(payload.project_root) ?? optionalString(context.args.project_path);
    const [filePath, traceFilePath] = await resolvePolishableTarget(
      root,
      requested,
      optionalString(payload._trace_file_path) ?? requested,
    );
    payload.file_path = filePath;
    payload._trace_file_path = traceFilePath;
    const content = requiredText(payload, 'content');
    if (!pythonStrip(content)) throw new AgentOrchestrationError('正文为空，无法润色。');
    await prepareRuntimeWritingContext(contextDeps, context, payload, 'chapter.polish');
    const styleInstruction = optionalString(payload.style_instruction) ?? context.userMessage;
    const trusted = polishConstraintsFromContextSnapshot(payload.llm_context_snapshot, secrets);
    const protectedEntities = unique([
      ...trusted.protected_entities,
      ...stringList(payload.protected_entities),
    ]);
    const characterConstraints = [
      ...trusted.character_constraints,
      ...(Array.isArray(payload.character_constraints)
        ? payload.character_constraints.filter(isObj)
        : []),
    ];
    const continuityFacts = [
      ...trusted.continuity_facts,
      ...(Array.isArray(payload.continuity_facts) ? payload.continuity_facts : []),
    ];
    const requiredFacts = unique([
      ...trusted.required_facts,
      ...stringList(payload.required_facts),
    ]);
    const constraintCounts = {
      protected_entities: protectedEntities.length,
      character_constraints: characterConstraints.length,
      continuity_facts: continuityFacts.length,
      required_facts: requiredFacts.length,
    };
    const preparedVoice = await buildGenerationSystemPrompt(reader, '', root, {
      platform,
      pluginLibraryRoot: deps.pluginLibraryRoot ?? null,
      secrets,
    });
    let editPolicy;
    try {
      editPolicy = editPolicyFromGenerationPrompt(content, {
        instruction: context.userMessage,
        systemPrompt: preparedVoice,
        admittedAuthorRequirements: root
          ? []
          : polishAuthorRequirementsFromContextSnapshot(payload.llm_context_snapshot),
      });
    } catch (error) {
      if (error instanceof AuthorEditPolicyError) throw new AgentOrchestrationError(error.message);
      throw error;
    }
    const result = await runControlledPolish(content, {
      styleInstruction,
      protectedEntities,
      characterConstraints: characterConstraints as never,
      continuityFacts,
      requiredFacts,
      useMainModel: payload.use_main_model === true,
      onlineEnabled: payload.online_enabled !== false,
      editPolicy,
      models: context.services.polish,
    });
    const { decision } = result;
    const summary = polishSummary(result);
    const traceSummary = polishTraceSummary(result);
    const output: Obj = {
      file_path: filePath,
      before: content,
      after: decision.text,
      summary,
      constraint_counts: constraintCounts,
      ...traceSummary,
    };
    const outputSummary: Obj = {
      file_path: traceFilePath,
      before_chars: cpLen(content),
      after_chars: cpLen(decision.text),
      constraint_counts: constraintCounts,
      ...traceSummary,
    };
    const inputSummary = {
      file_path: traceFilePath,
      content_chars: cpLen(content),
      style_instruction_present: Boolean(pythonStrip(styleInstruction)),
      ...llmContextInputSummary(payload.llm_context_snapshot),
    };
    if (decision.selected_source === 'original')
      return {
        status: 'completed',
        output,
        summary,
        artifacts: [],
        metrics: { before_chars: cpLen(content), after_chars: cpLen(content) },
        trace: {
          tool_name: 'chapter.polish',
          status: decision.status,
          input_summary: inputSummary,
          output_summary: outputSummary,
        },
      };
    const confirm = decision.degraded || patchRequiresConfirmation(context.run.permission_profile);
    const proposedPatch: Obj = {
      id: `chapter-polish-${deps.newHex()}`,
      kind: 'file_revision',
      created_by_tool: 'chapter.polish',
      file_path: filePath,
      before: content,
      after: decision.text,
      requires_confirmation: confirm,
      approval_action: 'desktop.confirm_file_writeback',
      polish_status: decision.status,
      candidate_source: decision.selected_source,
      degraded: decision.degraded,
    };
    output.proposed_patch = proposedPatch;
    outputSummary.patch_id = proposedPatch.id;
    outputSummary.requires_confirmation = confirm;
    const usage = result.usage.total_tokens;
    return {
      status: 'completed',
      output,
      summary,
      payload: { proposed_patch: proposedPatch },
      artifacts: [
        { kind: 'proposed_patch', payload: proposedPatch, requires_confirmation: confirm },
      ],
      metrics: {
        before_chars: cpLen(content),
        after_chars: cpLen(decision.text),
        total_tokens: typeof usage === 'number' ? usage : 0,
      },
      patch_proposal: PatchProposal.fromPayload(proposedPatch),
      trace: {
        tool_name: 'chapter.polish',
        status: decision.status,
        input_summary: inputSummary,
        output_summary: outputSummary,
      },
    };
  };

  return { 'chapter.polish': chapterPolish };
}
