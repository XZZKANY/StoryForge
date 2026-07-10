#!/usr/bin/env python3
"""测试配置了真实 LLM 后的 file.revise 功能"""

import asyncio
import base64
import json
import sys
from datetime import datetime

try:
    import websockets
except ImportError:
    print("❌ 缺少 websockets 库，请安装: pip install websockets")
    sys.exit(1)


def api_key_subprotocol(api_key: str) -> str:
    encoded = base64.urlsafe_b64encode(api_key.encode()).decode().rstrip("=")
    return f"storyforge-api-key.{encoded}"


async def test_file_revise_with_llm():
    """测试 file.revise intent with 真实 LLM (DeepSeek)"""

    api_url = "ws://127.0.0.1:8000"
    api_key = "local-dev-key"
    session_id = "test-revise-" + datetime.now().strftime("%Y%m%d-%H%M%S")

    ws_url = f"{api_url}/api/ide/agent/sessions/{session_id}"

    print(f"🔗 连接到: {ws_url}")
    print(f"📝 Session ID: {session_id}")
    print(f"🤖 LLM: DeepSeek (via OpenAI compatible API)\n")

    try:
        async with websockets.connect(
            ws_url, subprotocols=[api_key_subprotocol(api_key)]
        ) as websocket:
            print("✅ WebSocket 连接成功！\n")

            # 测试: file.revise intent (需要真实 LLM)
            print("=" * 80)
            print("测试: file.revise with DeepSeek LLM")
            print("=" * 80)

            message = {
                "type": "user_message",
                "user_message": "请优化这段文字的节奏和张力，增加悬疑氛围",
                "intent": "file.revise",
                "args": {
                    "file_path": "/test/chapter-001.md",
                    "content": "他走进房间，看到了一个陌生人。陌生人转过身来，露出了诡异的笑容。房间里很安静，只有时钟的滴答声。",
                    "project_name": "测试悬疑小说",
                }
            }

            print(f"📤 发送消息:")
            print(f"  Intent: {message['intent']}")
            print(f"  指令: {message['user_message']}")
            print(f"  原文: {message['args']['content']}")
            print()

            await websocket.send(json.dumps(message))

            print("⏳ 等待 LLM 响应（可能需要 10-30 秒）...\n")

            response = await websocket.recv()
            data = json.loads(response)

            print(f"📥 收到响应:")
            print(f"  类型: {data.get('type')}")

            if data.get('type') == 'agent_result':
                print(f"  ✅ Agent 执行成功！")
                print(f"  Intent: {data.get('intent')}")
                print(f"  Assistant Session ID: {data.get('assistant_session_id')}")
                print(f"  Plan 步骤数: {len(data.get('plan', []))}")
                print(f"  Tool Trace 数: {len(data.get('tool_trace', []))}")

                # 打印执行计划
                if data.get('plan'):
                    print("\n  📋 执行计划:")
                    for idx, step in enumerate(data['plan'], 1):
                        status_icon = {
                            'completed': '✅',
                            'running': '🔄',
                            'failed': '❌',
                            'pending': '⏳'
                        }.get(step.get('status'), '❓')
                        print(f"    {status_icon} {idx}. {step.get('step')}: {step.get('status')}")
                        if step.get('detail'):
                            print(f"       └─ {step.get('detail')}")

                # 打印工具调用轨迹
                if data.get('tool_trace'):
                    print("\n  🔧 工具调用轨迹:")
                    for idx, trace in enumerate(data['tool_trace'], 1):
                        status_icon = {
                            'completed': '✅',
                            'running': '🔄',
                            'failed': '❌'
                        }.get(trace.get('status'), '❓')
                        print(f"    {status_icon} {idx}. {trace.get('tool_name')}: {trace.get('status')}")
                        if trace.get('error_message'):
                            print(f"       ❌ 错误: {trace.get('error_message')}")

                # 打印提议的修改
                if data.get('proposed_patch'):
                    patch = data['proposed_patch']
                    print(f"\n  📝 提议的修改:")
                    print(f"    类型: {patch.get('kind')}")

                    if patch.get('kind') == 'file_revision':
                        before = patch.get('before', '')
                        after = patch.get('after', '')
                        summary = patch.get('summary', '')

                        print(f"    需要确认: {patch.get('requires_confirmation')}")
                        print(f"\n    修改前 ({len(before)} 字符):")
                        print(f"    {'-' * 60}")
                        print(f"    {before[:200]}{'...' if len(before) > 200 else ''}")
                        print(f"    {'-' * 60}")

                        print(f"\n    修改后 ({len(after)} 字符):")
                        print(f"    {'-' * 60}")
                        print(f"    {after[:200]}{'...' if len(after) > 200 else ''}")
                        print(f"    {'-' * 60}")

                        if summary:
                            print(f"\n    📋 修改摘要:")
                            print(f"    {summary}")

                # 打印 Agent 结果摘要
                if data.get('agent_result'):
                    result = data['agent_result']
                    if result.get('summary'):
                        print(f"\n  💬 摘要: {result['summary']}")

                print("\n✅ file.revise 测试通过！LLM 配置正常工作。\n")

            elif data.get('type') == 'error':
                print(f"  ❌ 错误: {data.get('detail')}")
                print("\n❌ 测试失败！\n")

            print("=" * 80)
            print("🎉 测试完成！")
            print("=" * 80)

    except websockets.exceptions.InvalidStatusCode as e:
        print(f"❌ WebSocket 连接失败: HTTP {e.status_code}")
        print(f"   原因: {e}")
        sys.exit(1)
    except websockets.exceptions.WebSocketException as e:
        print(f"❌ WebSocket 错误: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"❌ 未知错误: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    print("\n🚀 开始测试 file.revise with DeepSeek LLM\n")
    asyncio.run(test_file_revise_with_llm())
