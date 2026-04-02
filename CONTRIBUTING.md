# Contributing to Claude Code Telemetry

Thanks for your interest in contributing! This guide will help you get started.

## Development Setup

```bash
git clone https://github.com/nnaveenraju/claude-code-telemetry.git
cd claude-code-telemetry
npm install
npm run build
npm test
```

**Requirements:** Node.js >= 20.0.0

## Project Structure

```
src/
  types.ts                    # Shared type definitions
  telemetry-client.ts         # Singleton client with buffered writes
  index.ts                    # Public API re-exports
  utils/                      # Trace context, token estimation
  collectors/                 # Skill, orchestration, context collectors
  exporters/                  # JSONL and console exporters
  hooks/                      # Claude Code hook scripts
  analysis/                   # Model analyzer and CLI dashboard
dashboard/
  api/server.ts               # Fastify API (Grafana SimpleJSON + trace viewer)
  grafana/                    # Provisioned dashboards and datasources
  docker-compose.yml          # Grafana + API stack
tests/                        # Vitest test files
```

## Workflow

1. **Fork** the repo and create a feature branch from `main`
2. **Write tests first** — this project follows TDD. Add tests to `tests/`
3. **Build** with `npm run build` — must compile cleanly with zero errors
4. **Run tests** with `npm test` — all 54+ tests must pass
5. **Submit a PR** against `main` with a clear description

## Code Style

- TypeScript ESM (`"type": "module"`)
- Strict mode enabled in `tsconfig.json`
- No external linter configured — follow existing patterns in the codebase
- Prefer explicit types over `any`
- Keep hooks fast — they run on every tool call and must not block Claude Code

## Testing

Tests use **Vitest** and follow the naming convention `tests/<module>.test.ts`.

```bash
npm test              # Run all tests once
npm run test:watch    # Watch mode
```

Each test file creates temporary directories for JSONL output and cleans up after itself.

## Areas for Contribution

- Additional Grafana dashboard panels
- New analysis reports in the CLI dashboard
- OpenTelemetry export support
- Support for additional AI coding agents beyond Claude Code
- Performance optimizations for high-volume JSONL parsing

## Reporting Issues

Use [GitHub Issues](https://github.com/nnaveenraju/claude-code-telemetry/issues). Include:
- Steps to reproduce
- Expected vs actual behavior
- Node.js version and OS
- Relevant log output

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
