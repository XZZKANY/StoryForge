import { describe, expect, it } from 'vitest';
import golden from '../../golden/p2-assistant-pure.json';
import { AuthorEditPolicyError, buildAuthorEditPolicy } from '../kernel/authorEditPolicy';
import {
  applyDeterministicPolish,
  DEFAULT_POLISH_GATE_CONFIG,
  entitySpellingChanges,
  evaluatePolishCandidate,
  rebuildPolishableMarkdown,
  selectPolishCandidate,
  splitPolishableMarkdown,
} from '../kernel/polishing';
import { validateAssistantContextBundle } from '../kernel/writingContext';
import {
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
} from './continuation';
import {
  buildChatPrompt,
  buildDraftPrompt,
  CHAT_SYSTEM_PROMPT,
  DRAFT_SYSTEM_PROMPT,
} from './prompts';
import {
  buildRevisionPrompt,
  instructionAuthorizesExpansion,
  REVISION_SYSTEM_PROMPT,
  reviseText,
  RevisionQualityRejected,
} from './revision';

type Row = {
  fn: string;
  args_json: string;
  output_json?: string;
  error?: { type: string; message: string; gate?: unknown };
};
type Json = Record<string, unknown>;

const bundleOf = (value: unknown) =>
  value === undefined || value === null ? null : validateAssistantContextBundle(value as never);

async function run(row: Row): Promise<unknown> {
  const args = JSON.parse(row.args_json) as Json;
  switch (row.fn) {
    case 'constants':
      return {
        continue_system: CONTINUE_SYSTEM_PROMPT,
        revision_system: REVISION_SYSTEM_PROMPT,
        draft_system: DRAFT_SYSTEM_PROMPT,
        chat_system: CHAT_SYSTEM_PROMPT,
        limits: [TAIL_MAX_CHARS, SUFFIX_MAX_CHARS, DEFAULT_TARGET_CHARS],
      };
    case 'chat_prompt':
      return buildChatPrompt(args.message as string, args.block as string);
    case 'draft_prompt': {
      const payload = args.payload as Json;
      return buildDraftPrompt(
        {
          file_path: payload.file_path as string,
          instruction: payload.instruction as string,
          project_name: (payload.project_name as string | undefined) ?? null,
          context_bundle: bundleOf(payload.context_bundle),
        },
        (args.constraints as string | null) ?? null,
        (args.previous as [string, string] | null) ?? null,
      );
    }
    case 'windows': {
      const content = args.content as string;
      const cursor = args.cursor as number;
      return {
        tail: manuscriptTail(content, cursor),
        tail_small: manuscriptTail(content, cursor, 20),
        suffix: manuscriptSuffix(content, cursor),
        anchor: resolveAnchorLine(content, cursor),
        insert: insertAtAnchor(content, cursor, '\n新的一段。\n'),
      };
    }
    case 'continue_prompt':
      return buildContinuePrompt({
        tail: args.tail as string,
        filePath: args.file_path as string,
        suffix: args.suffix as string | undefined,
        contextBundle: bundleOf(args.context_bundle),
        instruction: args.instruction as string | undefined,
        sceneConstraints: args.scene_constraints as string | undefined,
        previousChapter: (args.previous_chapter as [string, string] | undefined) ?? null,
        targetChars: args.target_chars as number | undefined,
      });
    case 'post_process': {
      const tail = args.tail as string;
      const generated = args.generated as string;
      return {
        strip: stripRepeatedPrefix(tail, generated),
        trim: trimToSentenceEnd(generated),
        finalize: finalizeContinuation(tail, generated),
      };
    }
    case 'expansion':
      return instructionAuthorizesExpansion(args.instruction as string);
    case 'revision_prompt':
      return buildRevisionPrompt({
        filePath: args.file_path as string,
        content: args.content as string,
        instruction: args.instruction as string,
        systemPrompt: '系统',
        projectName: (args.project_name as string | undefined) ?? null,
        contextFiles: args.context
          ? [
              { relative_path: '人物/林舟.md', kind: 'character', excerpt: '林舟会游泳。' },
              { relative_path: '设定/钟楼.md', kind: 'setting', excerpt: '钟楼在城北。' },
            ]
          : [],
        sceneConstraints: (args.scene_constraints as string | undefined) ?? null,
      });
    case 'revise_text': {
      const calls: { system: string; user: string }[] = [];
      const result = await reviseText(
        {
          filePath: '正文/a.md',
          content: args.content as string,
          instruction: args.instruction as string,
          systemPrompt: '系统提示',
          qualityGate: (args.gate as 'polish' | null) ?? null,
          editPolicy:
            'policy_from' in (args.reply as Json)
              ? buildAuthorEditPolicy((args.reply as Json).policy_from as string)
              : null,
        },
        async ({ systemPrompt, userPrompt }) => {
          calls.push({ system: systemPrompt, user: userPrompt });
          return args.reply as Json;
        },
      ).catch((error: unknown) => {
        if (!(error instanceof RevisionQualityRejected)) throw error;
        return { error, calls };
      });
      if ('error' in result)
        return {
          error: {
            type: 'RevisionQualityRejected',
            message: result.error.message,
            gate: result.error.gate,
          },
          calls,
        };
      return {
        after: result.after,
        telemetry: result.telemetry,
        quality_gate: result.qualityGate,
        calls,
      };
    }
    case 'split':
      return splitPolishableMarkdown(args.text as string);
    case 'split_spans': {
      const text = args.text as string;
      const policy = buildAuthorEditPolicy(text, { instruction: args.instruction as string });
      return splitPolishableMarkdown(text, policy.protected_spans);
    }
    case 'deterministic': {
      const text = args.text as string;
      return applyDeterministicPolish(
        text,
        args.instruction
          ? buildAuthorEditPolicy(text, { instruction: args.instruction as string })
          : null,
      );
    }
    case 'rebuild_mismatch':
      return rebuildPolishableMarkdown(splitPolishableMarkdown('# 标题\n正文'), ['a', 'b']);
    case 'evaluate': {
      const original = args.original as string;
      const options = args.options as Json;
      return evaluatePolishCandidate(original, args.candidate as string, {
        protectedEntities: (options.entities as unknown[]) ?? [],
        characterConstraints: (options.constraints as never) ?? [],
        continuityFacts: (options.facts as unknown[]) ?? [],
        requiredFacts: (options.required as string[]) ?? [],
        responseTruncated: Boolean(options.response_truncated),
        config: options.max_ratio
          ? { ...DEFAULT_POLISH_GATE_CONFIG, max_char_ratio: Number.POSITIVE_INFINITY }
          : null,
        editPolicy: buildAuthorEditPolicy(original, {
          instruction: (options.instruction as string) ?? '',
        }),
      });
    }
    case 'select': {
      const local = args.local as Json | null;
      const online = args.online as Json | null;
      const decision = selectPolishCandidate('他推开门。', {
        localCandidate: local ? { source: 'local', text: local.text as string } : null,
        onlineCandidate: online
          ? {
              source: 'online',
              text: online.text as string,
              responseTruncated: Boolean(online.response_truncated),
            }
          : null,
      });
      return decision;
    }
    case 'spelling':
      return entitySpellingChanges(
        args.original as string,
        args.candidate as string,
        args.entities as string[],
      );
  }
  throw new Error(`unknown fn ${row.fn}`);
}

describe('real Python assistant pure layer', () => {
  for (const [index, row] of (golden.pure as Row[]).entries()) {
    it(`${index} ${row.fn} ${row.args_json.slice(0, 50)}`, async () => {
      if (!row.error) {
        expect(await run(row)).toEqual(JSON.parse(row.output_json!));
        return;
      }
      const thrown = await run(row).then(
        () => null,
        (error: unknown) => error,
      );
      expect(thrown, 'TS 应当报错').toBeInstanceOf(Error);
      expect((thrown as Error).message).toBe(row.error.message);
      if (row.error.type === 'RevisionQualityRejected') {
        expect(thrown).toBeInstanceOf(RevisionQualityRejected);
        expect((thrown as RevisionQualityRejected).gate).toEqual(row.error.gate);
      } else if (row.error.type === 'AuthorEditPolicyError')
        expect(thrown).toBeInstanceOf(AuthorEditPolicyError);
      else expect(thrown).toBeInstanceOf(RangeError);
    });
  }
});
