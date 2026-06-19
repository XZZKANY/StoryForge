#!/usr/bin/env python3
"""测试桌面端 Agent WebSocket 连接"""

import asyncio
import json
import sys
from datetime import datetime

try:
    import websockets
except ImportError:
    print("❌ 缺少 websockets 库，请安装: pip install websockets")
    sys.exit(1)


async def test_agent_websocket():
    """测试 Agent WebSocket 端到端流程"""

    api_url = "ws://127.0.0.1:8000"
    api_key = "local-dev-key"
    session_id = "test-session-" + datetime.now().strftime("%Y%m%d-%H%M%S")

    ws_url = f"{api_url}/api/ide/agent/sessions/{session_id}?api_key={api_key}"

    print(f"🔗 连接到: {ws_url}")
    print(f"📝 Session ID: {session_id}\n")

    try:
        async with websockets.connect(ws_url) as websocket:
            print("✅ WebSocket 连接成功！\n")

            # 测试 1: chat.explain intent
            print("=" * 60)
            print("测试 1: chat.explain (解释性对话)")
            print("=" * 60)

            message1 = {
                "type": "user_message",
                "user_message": "请解释一下 StoryForge 项目的核心架构",
                "intent": "chat.explain",
                "args": {
                    "context": "StoryForge 是一个长篇小说生产流水线"
                }
            }

            print(f"📤 发送消息: {json.dumps(message1, ensure_ascii=False, indent=2)}\n")
            await websocket.send(json.dumps(message1))

            print("⏳ 等待响应...\n")
            response1 = await websocket.recv()
            data1 = json.loads(response1)

            print(f"📥 收到响应:")
            print(f"  类型: {data1.get('type')}")

            if data1.get('type') == 'agent_result':
                print(f"  Intent: {data1.get('intent')}")
                print(f"  Assistant Session ID: {data1.get('assistant_session_id')}")
                print(f"  Plan 步骤数: {len(data1.get('plan', []))}")
                print(f"  Tool Trace 数: {len(data1.get('tool_trace', []))}")

                if data1.get('plan'):
                    print("\n  📋 执行计划:")
                    for idx, step in enumerate(data1['plan'], 1):
                        print(f"    {idx}. {step.get('step')}: {step.get('status')} - {step.get('detail')}")

                if data1.get('agent_result', {}).get('summary'):
                    print(f"\n  💬 摘要: {data1['agent_result']['summary']}")

                print("\n✅ 测试 1 通过！\n")
            elif data1.get('type') == 'error':
                print(f"  ❌ 错误: {data1.get('detail')}")
                print("\n❌ 测试 1 失败！\n")

            # 测试 2: file.revise intent (需要文件参数)
            print("=" * 60)
            print("测试 2: file.revise (文件修订)")
            print("=" * 60)

            message2 = {
                "type": "user_message",
                "user_message": "优化这段文字的节奏和张力",
                "intent": "file.revise",
                "args": {
                    "file_path": "/test/chapter-001.md",
                    "content": "他走进房间，看到了一个陌生人。陌生人转过身来，露出了诡异的笑容。",
                    "context": "这是一个悬疑小说的开场"
                }
            }

            print(f"📤 发送消息: {json.dumps(message2, ensure_ascii=False, indent=2)}\n")
            await websocket.send(json.dumps(message2))

            print("⏳ 等待响应...\n")
            response2 = await websocket.recv()
            data2 = json.loads(response2)

            print(f"📥 收到响应:")
            print(f"  类型: {data2.get('type')}")

            if data2.get('type') == 'agent_result':
                print(f"  Intent: {data2.get('intent')}")
                print(f"  Plan 步骤数: {len(data2.get('plan', []))}")

                if data2.get('proposed_patch'):
                    patch = data2['proposed_patch']
                    print(f"\n  📝 提议的修改:")
                    print(f"    类型: {patch.get('kind')}")
                    if patch.get('kind') == 'file_revision':
                        print(f"    文件: {patch.get('file_path')}")
                        print(f"    需要确认: {patch.get('requires_confirmation')}")
                        before_len = len(patch.get('before', ''))
                        after_len = len(patch.get('after', ''))
                        print(f"    修改前: {before_len} 字符")
                        print(f"    修改后: {after_len} 字符")

                print("\n✅ 测试 2 通过！\n")
            elif data2.get('type') == 'error':
                print(f"  ⚠️  错误: {data2.get('detail')}")
                print("  (file.revise 可能需要真实文件路径，这是预期行为)\n")

            print("=" * 60)
            print("🎉 所有测试完成！")
            print("=" * 60)

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
    print("\n🚀 开始测试 StoryForge Desktop Agent WebSocket\n")
    asyncio.run(test_agent_websocket())
