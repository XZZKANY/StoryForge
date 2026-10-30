import { describe, expect, it } from 'vitest';

import {
  parsePluginsFile,
  pluginNameProblem,
  PLUGINS_FILE,
  serializePluginsFile,
  STARTER_PLUGIN_NAME,
} from './plugins';

describe('插件名规则', () => {
  it('合规的名字返回 null', () => {
    for (const name of [
      '雾港回声写法',
      'my-plugin',
      'a',
      'a.b',
      'v1.2 tools',
      'CONSOLE',
      'COM10',
      'COM0',
      'con-tools',
      'nul_x',
      '长'.repeat(40),
      '😀'.repeat(40),
    ])
      expect(pluginNameProblem(name), name).toBeNull();
  });

  it('长度按码点数，空名与超长都不行', () => {
    expect(pluginNameProblem('')).toBe('插件名不能为空。');
    expect(pluginNameProblem('长'.repeat(41))).toBe('插件名最多 40 个字，现在是 41 个。');
    expect(pluginNameProblem('😀'.repeat(41))).toBe('插件名最多 40 个字，现在是 41 个。');
  });

  it('首尾空白（含全角空格、换行）不行', () => {
    for (const name of [' a', 'a ', '\u3000插件', '插件\u3000', '\u00a0a', 'a\n', '\u2028a'])
      expect(pluginNameProblem(name), JSON.stringify(name)).toBe('插件名开头和结尾不能有空白。');
    expect(pluginNameProblem('a b')).toBeNull();
  });

  it('控制字符与 Windows 不许的字符不行', () => {
    for (const name of ['a\u0000b', 'a\tb', 'a\u001fb', 'a\u007fb'])
      expect(pluginNameProblem(name), JSON.stringify(name)).toBe('插件名不能含控制字符。');
    for (const char of ['<', '>', ':', '"', '/', '\\', '|', '?', '*'])
      expect(pluginNameProblem(`a${char}b`), char).toBe('插件名不能含这些字符：< > : " / \\ | ? *');
  });

  it('点开头、点结尾不行', () => {
    expect(pluginNameProblem('.staging')).toBe('插件名不能以「.」开头。');
    expect(pluginNameProblem('plugin.')).toBe('插件名不能以「.」或空格结尾。');
  });

  it('Windows 保留名不分大小写，取第一个点之前比较', () => {
    for (const name of ['CON', 'con', 'Prn', 'aux', 'NUL', 'com1', 'COM9', 'lpt1', 'LPT9'])
      expect(pluginNameProblem(name), name).toBe(`「${name}」是 Windows 保留名，不能当插件名。`);
    expect(pluginNameProblem('con.txt')).toBe('「con」是 Windows 保留名，不能当插件名。');
    expect(pluginNameProblem('NUL.tar.gz')).toBe('「NUL」是 Windows 保留名，不能当插件名。');
  });
});

describe('插件启用文件', () => {
  it('路径固定在作品的 .storyforge 下', () => {
    expect(PLUGINS_FILE).toBe('.storyforge/plugins.json');
  });

  it('读出启用的名字，去重保序；带 BOM 也认', () => {
    expect(
      parsePluginsFile('{ "version": 1, "enabled": ["写法包", "审稿口径", "写法包"] }'),
    ).toEqual({ enabled: ['写法包', '审稿口径'], problem: null });
    expect(parsePluginsFile('\uFEFF{"version":1,"enabled":[]}')).toEqual({
      enabled: [],
      problem: null,
    });
    expect(parsePluginsFile('{"version":1,"enabled":["a"],"note":"多余字段不管"}')).toEqual({
      enabled: ['a'],
      problem: null,
    });
  });

  it('去重不分大小写，留先出现的写法', () => {
    expect(
      parsePluginsFile(
        '{"version":1,"enabled":["Novel-Kit","写法包","novel-kit","NOVEL-KIT","b"]}',
      ),
    ).toEqual({ enabled: ['Novel-Kit', '写法包', 'b'], problem: null });
  });

  it('坏 JSON、版本不对、字段不对时一个都不启用并说明', () => {
    const bad: [string, string][] = [
      ['', '插件启用文件不是合法的 JSON，当作一个插件都没启用。'],
      ['{"version":1,', '插件启用文件不是合法的 JSON，当作一个插件都没启用。'],
      ['["a"]', '插件启用文件应是一个 JSON 对象，当作一个插件都没启用。'],
      ['null', '插件启用文件应是一个 JSON 对象，当作一个插件都没启用。'],
      ['"a"', '插件启用文件应是一个 JSON 对象，当作一个插件都没启用。'],
      ['{"enabled":["a"]}', '插件启用文件的 version 应是 1，当作一个插件都没启用。'],
      ['{"version":2,"enabled":["a"]}', '插件启用文件的 version 应是 1，当作一个插件都没启用。'],
      ['{"version":"1","enabled":["a"]}', '插件启用文件的 version 应是 1，当作一个插件都没启用。'],
      ['{"version":1}', '插件启用文件的 enabled 应是插件名列表，当作一个插件都没启用。'],
      [
        '{"version":1,"enabled":"a"}',
        '插件启用文件的 enabled 应是插件名列表，当作一个插件都没启用。',
      ],
    ];
    for (const [text, problem] of bad)
      expect(parsePluginsFile(text), text).toEqual({ enabled: [], problem });
  });

  it('不合规的名字和不是文字的项丢掉，其余照用', () => {
    expect(
      parsePluginsFile('{"version":1,"enabled":["好的", ".staging", 3, "a/b", "好的", "CON"]}'),
    ).toEqual({
      enabled: ['好的'],
      problem:
        '插件启用文件里有不合规的名字，已忽略：「.staging」（插件名不能以「.」开头）；第 3 项不是文字；' +
        '「a/b」（插件名不能含这些字符：< > : " / \\ | ? *）；「CON」（「CON」是 Windows 保留名，不能当插件名）。',
    });
  });

  it('写出两空格缩进、末尾换行，读回来一样', () => {
    const text = serializePluginsFile(['写法包', 'b']);
    expect(text).toBe('{\n  "version": 1,\n  "enabled": [\n    "写法包",\n    "b"\n  ]\n}\n');
    expect(parsePluginsFile(text)).toEqual({ enabled: ['写法包', 'b'], problem: null });
    expect(serializePluginsFile([])).toBe('{\n  "version": 1,\n  "enabled": []\n}\n');
  });

  it('自带插件的名字合规，写进启用文件读得回来', () => {
    expect(STARTER_PLUGIN_NAME).toBe('起书基础包');
    expect(pluginNameProblem(STARTER_PLUGIN_NAME)).toBeNull();
    expect(parsePluginsFile(serializePluginsFile([STARTER_PLUGIN_NAME]))).toEqual({
      enabled: [STARTER_PLUGIN_NAME],
      problem: null,
    });
  });
});
