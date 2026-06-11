from storyforge_workflow.provider_client import generate_text

result = generate_text("请用一句中文回复：StoryForge 连通性测试。")
print("响应长度:", len(result))
print("响应预览:", result[:120].replace("\n", " "))
