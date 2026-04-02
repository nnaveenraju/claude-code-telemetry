# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-03-11

### Added
- Core telemetry client with buffered writes, sampling, and metadata redaction
- Trace context management with UUID-based trace/span hierarchies
- Token estimation and context hash computation
- JSONL exporter with date-based log rotation
- Console exporter with color-coded output and verbosity levels
- Skill collector with `wrap()` for programmatic use and `recordFromHook()` for hook integration
- Orchestration collector for routing decisions, fallbacks, and cascade steps
- Context collector for budget snapshots with low-budget warnings
- Claude Code hook system (UserPromptSubmit, PreToolUse, PostToolUse, Stop)
- Pending span management for cross-process hook coordination
- Subagent delegation tracking with parent-child span relationships
- Rule-based model analyzer recommending Opus/Sonnet/Haiku/Gemini per skill
- CLI dashboard with reports: skills, routing, context, model-recs, traces
- Jaeger-style HTML trace waterfall viewer at `/trace/:traceId`
- Grafana dashboards: Skill Performance, Token Analysis, Model Comparison
- Fastify API server implementing Grafana SimpleJSON protocol
- Docker Compose setup with Grafana + API server
- 54 tests across 11 test files, 100% passing
