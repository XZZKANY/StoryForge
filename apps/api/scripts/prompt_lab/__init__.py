"""prompt 对比实验台（scripts/prompt_lab）：固定输入 × 变体配置 → 真 LLM 输出 → 人工并排判定。

用法见 runner.py 的 --help。真实 LLM 调用只走 app.common.llm_client 唯一出网通道；
本包在 app/ 之外，不会被 PyInstaller 打进 sidecar exe。
"""
