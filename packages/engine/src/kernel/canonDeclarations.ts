import { JsonFields, type JsonObject } from './json';

/**
 * 作者声明 canon.json / hooks.json 的输入范围（迁移计划 §4.3.1）：被读到的字段类型必须与应用
 * 生成、文档描述的格式一致，否则直接报错并指出位置；缺省与 null 仍按 Python 的缺省语义处理。
 * 未知字段原样保留、不校验。
 */
function checkAssertionMetadata(fields: JsonFields, entry: JsonObject, path: string) {
  fields.optionalString(fields.member(entry, 'assertion_type'), `${path}.assertion_type`);
  fields
    .optionalArray(fields.member(entry, 'evidence'), `${path}.evidence`)
    .forEach((value, index) => {
      const at = `${path}.evidence[${index}]`;
      const source = fields.object(value, at);
      fields.optionalString(fields.member(source, 'quote'), `${at}.quote`);
      fields.optionalString(fields.member(source, 'path'), `${at}.path`);
      fields.optionalInteger(fields.member(source, 'start_line'), `${at}.start_line`);
      fields.optionalInteger(fields.member(source, 'end_line'), `${at}.end_line`);
    });
}

function entries(fields: JsonFields, parent: JsonObject, key: string, path: string) {
  return fields.optionalArray(fields.member(parent, key), path).map((value, index) => {
    const at = `${path}[${index}]`;
    return [fields.object(value, at), at] as const;
  });
}

export function checkCanonDeclaration(canon: JsonObject, source: string): void {
  const fields = new JsonFields(source);
  for (const [entity, at] of entries(fields, canon, 'entities', 'entities')) {
    fields.optionalString(fields.member(entity, 'id'), `${at}.id`);
    fields.optionalString(fields.member(entity, 'canonical_name'), `${at}.canonical_name`);
    fields.optionalString(fields.member(entity, 'kind'), `${at}.kind`);
    fields
      .optionalArray(fields.member(entity, 'aliases'), `${at}.aliases`)
      .forEach((alias, index) => fields.string(alias, `${at}.aliases[${index}]`));
    checkAssertionMetadata(fields, entity, at);
  }
  const invariants = fields.optionalObject(fields.member(canon, 'invariants'), 'invariants');
  for (const [entry, at] of entries(
    fields,
    invariants,
    'single_holder',
    'invariants.single_holder',
  )) {
    fields.string(fields.member(entry, 'item'), `${at}.item`);
    fields.string(fields.member(entry, 'holder'), `${at}.holder`);
    fields.optionalInteger(fields.member(entry, 'from_chapter'), `${at}.from_chapter`);
    fields.optionalInteger(fields.member(entry, 'to_chapter'), `${at}.to_chapter`);
    checkAssertionMetadata(fields, entry, at);
  }
  for (const [entry, at] of entries(
    fields,
    invariants,
    'timeline_order',
    'invariants.timeline_order',
  )) {
    fields.string(fields.member(entry, 'before'), `${at}.before`);
    fields.string(fields.member(entry, 'after'), `${at}.after`);
    checkAssertionMetadata(fields, entry, at);
  }
  for (const [entry, at] of entries(fields, invariants, 'promises', 'invariants.promises')) {
    for (const key of ['id', 'title', 'status', 'kind'])
      fields.optionalString(fields.member(entry, key), `${at}.${key}`);
    for (const key of ['planted_chapter', 'due_chapter', 'resolved_chapter', 'cadence_chapters'])
      fields.optionalInteger(fields.member(entry, key), `${at}.${key}`);
    fields
      .optionalArray(fields.member(entry, 'touches'), `${at}.touches`)
      .forEach((touch, index) => fields.integer(touch, `${at}.touches[${index}]`));
  }
  for (const [entry, at] of entries(fields, invariants, 'lifespan', 'invariants.lifespan')) {
    fields.string(fields.member(entry, 'entity'), `${at}.entity`);
    fields.integer(fields.member(entry, 'exits_after_chapter'), `${at}.exits_after_chapter`);
    fields.optionalString(fields.member(entry, 'reason'), `${at}.reason`);
    checkAssertionMetadata(fields, entry, at);
  }
}

export function checkHooksDeclaration(hooks: JsonObject, source: string): void {
  const fields = new JsonFields(source);
  for (const [hook, at] of entries(fields, hooks, 'hooks', 'hooks')) {
    for (const key of ['id', 'description', 'status', 'category', 'note', 'verification'])
      fields.optionalString(fields.member(hook, key), `${at}.${key}`);
    for (const key of ['planted_at', 'last_advanced_at']) {
      const anchor = fields.optionalObject(fields.member(hook, key), `${at}.${key}`);
      fields.optionalString(fields.member(anchor, 'path'), `${at}.${key}.path`);
      fields.optionalInteger(fields.member(anchor, 'chapter'), `${at}.${key}.chapter`);
    }
  }
  const agenda = fields.optionalObject(fields.member(hooks, 'agenda'), 'agenda');
  for (const chapter of Object.keys(agenda)) {
    const plan = fields.object(agenda[chapter], `agenda.${chapter}`);
    for (const key of ['advance', 'resolve'])
      fields
        .optionalArray(fields.member(plan, key), `agenda.${chapter}.${key}`)
        .forEach((id, index) => fields.string(id, `agenda.${chapter}.${key}[${index}]`));
  }
}
