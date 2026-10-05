#!/usr/bin/env node
/**
 * 伴侣 CLI 可执行入口：`actual-reports <族> <动作> [选项]`。
 * @module @dsh-plus/actual-reports/bin/report
 */

import { createNodeRuntime, runCli } from '../cli.ts'

process.exitCode = await runCli(process.argv.slice(2), createNodeRuntime())
