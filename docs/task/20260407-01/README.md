# XPF-001: Mission Control 架构探索与 Agent SDK 改造方案

**日期**: 2026-04-07
**分支**: feature/XPF-001
**状态**: 改造方案已完成

## 目标

分析 Mission Control 与 OpenClaw Gateway 的集成架构，设计基于 `@anthropic-ai/claude-agent-sdk` + 百炼大模型的替代方案。

## 文档

| 文档 | 说明 |
|------|------|
| [06-migration-plan.md](./06-migration-plan.md) | **完整改造方案**：Agent SDK + 百炼接入，含代码示例、文件清单、实施阶段 |

## 关键结论

1. **不包装 CLI** — 直接包装 `claude` CLI 违反 Anthropic 使用条款，有封号风险
2. **使用 Agent SDK** — `@anthropic-ai/claude-agent-sdk` 是官方推荐的编程接口，工具集与 Claude Code 完全相同
3. **百炼兼容** — 通过 `ANTHROPIC_BASE_URL` 环境变量接入百炼大模型平台
4. **26 个文件需改造** — 7 个高优先级 API route，核心改动量约 1500 行
5. **原生流式** — SDK 的 async iterator 替代当前 125s 同步阻塞，支持 SSE 实时推送
