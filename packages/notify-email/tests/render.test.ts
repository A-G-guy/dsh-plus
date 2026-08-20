import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config } from '../src/config.ts'
import { createDecisionTrigger, createTurnEndTrigger } from '../src/triggers/builtin.ts'
import {
  renderCompletionNotice,
  renderErrorNotice,
  renderPlanNotice,
  renderQuestionNotice,
} from '../src/triggers/render.ts'
import type { DecisionCall, TurnEndInfo } from '../src/triggers/types.ts'

function decisionCall(name: string, args: Record<string, unknown>): DecisionCall {
  return { callId: 'c1', sessionId: 'session-1234567', name, args }
}

function turnEnd(kind: string, extra?: Partial<TurnEndInfo>): TurnEndInfo {
  return { sessionId: 'session-1234567', turn: 3, kind, ...extra }
}

test('given ask_user_question args, when rendered, then question text and options are listed', () => {
  const notice = renderQuestionNotice(
    decisionCall('ask_user_question', {
      questions: [
        {
          id: 'q1',
          header: '选择方式',
          question: '用哪种方案部署？',
          options: [{ label: '方案 A（推荐）', description: '改动最小' }, { label: '方案 B' }],
        },
      ],
    }),
    4000,
  )
  assert.match(notice.subject, /等待你的回答/)
  assert.match(notice.text, /等待用户回答/)
  assert.match(notice.text, /用哪种方案部署？/)
  assert.match(notice.text, /1\. 方案 A（推荐） — 改动最小/)
  assert.match(notice.text, /2\. 方案 B/)
})

test('given exit_plan_mode args, when rendered, then plan content is included', () => {
  const notice = renderPlanNotice(
    decisionCall('exit_plan_mode', { plan: '# 计划\n1. 第一步' }),
    4000,
  )
  assert.match(notice.subject, /Plan 待审批/)
  assert.match(notice.text, /等待审批/)
  assert.match(notice.text, /# 计划\n1\. 第一步/)
})

test('given completed turn, when rendered, then last delivery message is the body', () => {
  const notice = renderCompletionNotice(
    turnEnd('completed', { lastDelivery: '已完成部署。' }),
    4000,
  )
  assert.match(notice.subject, /任务执行完毕/)
  assert.match(notice.text, /已完成部署。/)
})

test('given overlong delivery, when rendered, then body is truncated at maxBodyChars', () => {
  const long = 'x'.repeat(5000)
  const notice = renderCompletionNotice(turnEnd('completed', { lastDelivery: long }), 400)
  assert.ok(notice.text.length < 1000)
  assert.match(notice.text, /已截断/)
})

test('given errored turn, when rendered, then error message is the body', () => {
  const notice = renderErrorNotice(turnEnd('error', { errorMessage: 'LLM request failed' }), 4000)
  assert.match(notice.subject, /任务出错停止/)
  assert.match(notice.text, /LLM request failed/)
})

test('given toggles off, when built-in decision trigger fires, then skipped', () => {
  const cfg = Config({ triggers: { onQuestion: false } })
  const trigger = createDecisionTrigger(() => cfg)
  assert.equal(
    trigger.onDecision?.(decisionCall('ask_user_question', { questions: [] })),
    undefined,
  )
})

test('given unrelated tool, when built-in decision trigger fires, then skipped', () => {
  const cfg = Config({})
  const trigger = createDecisionTrigger(() => cfg)
  assert.equal(trigger.onDecision?.(decisionCall('bash', { command: 'ls' })), undefined)
})

test('given toggles, when built-in turn-end trigger fires, then kinds map to toggles', () => {
  const all = Config({})
  const trigger = createTurnEndTrigger(() => all)
  assert.notEqual(trigger.onTurnEnd?.(turnEnd('completed')), undefined)
  assert.notEqual(trigger.onTurnEnd?.(turnEnd('error')), undefined)
  assert.equal(trigger.onTurnEnd?.(turnEnd('aborted')), undefined)
  assert.equal(trigger.onTurnEnd?.(turnEnd('blocked')), undefined)

  const noError = Config({ triggers: { onError: false } })
  const offTrigger = createTurnEndTrigger(() => noError)
  assert.equal(offTrigger.onTurnEnd?.(turnEnd('error')), undefined)
})
