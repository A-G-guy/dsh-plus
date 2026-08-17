import assert from 'node:assert/strict'
import { test } from 'node:test'

import type {
  SkillCandidate,
  SkillDefinition,
  SkillProvider,
} from '@deepseek-ai/dsh-skill'

import { createManualProvider, toManualSkill } from '../src/manual-provider.ts'

function candidate(name: string, modelInvocable: boolean, userInvocable: boolean): SkillCandidate {
  return {
    name,
    description: `${name} 描述`,
    invocation: { modelInvocable, userInvocable },
    source: 'custom',
    provider: 'fake',
    rank: 300,
    locator: { path: `/skills-manual/${name}/SKILL.md` },
    path: `/skills-manual/${name}/SKILL.md`,
  }
}

function definition(name: string, modelInvocable: boolean, userInvocable: boolean): SkillDefinition {
  const { locator: _locator, rank: _rank, ...summary } = candidate(name, modelInvocable, userInvocable)
  return { ...summary, content: `# ${name} 正文` }
}

function fakeProvider(overrides: Partial<SkillProvider>): SkillProvider {
  return { name: 'fake', list: async () => [], get: async () => undefined, ...overrides }
}

test('given candidates with all invocation combos, when listed, then model invocation is always off and user policy preserved', async () => {
  const combos: Array<[boolean, boolean]> = [[true, true], [true, false], [false, true], [false, false]]
  const provider = createManualProvider(fakeProvider({
    list: async () => combos.map(([m, u], i) => candidate(`skill-${i}`, m, u)),
  }))
  const result = await provider.list({})
  assert.ok(Array.isArray(result))
  assert.deepEqual(
    (result as SkillCandidate[]).map((c) => c.invocation),
    combos.map(([, u]) => ({ modelInvocable: false, userInvocable: u })),
  )
})

test('given a candidate, when mapped to manual, then locator and other fields survive unchanged', async () => {
  const original = candidate('demo', true, true)
  const provider = createManualProvider(fakeProvider({ list: async () => [original] }))
  const [mapped] = (await provider.list({})) as SkillCandidate[]
  assert.equal(mapped!.name, original.name)
  assert.equal(mapped!.description, original.description)
  assert.equal(mapped!.rank, original.rank)
  assert.deepEqual(mapped!.locator, original.locator)
  assert.equal(mapped!.path, original.path)
  assert.equal(mapped!.source, original.source)
})

test('given an incomplete observation, when listed, then the observation shape and complete flag are preserved', async () => {
  const provider = createManualProvider(fakeProvider({
    list: async () => ({ candidates: [candidate('demo', true, true)], complete: false }),
  }))
  const result = await provider.list({})
  assert.ok(!Array.isArray(result))
  const observation = result as { candidates: SkillCandidate[]; complete: boolean }
  assert.equal(observation.complete, false)
  assert.equal(observation.candidates[0]!.invocation.modelInvocable, false)
})

test('given inner get returns a definition, when wrapped get loads, then the body is kept and policy forced manual', async () => {
  const provider = createManualProvider(fakeProvider({
    get: async () => definition('demo', true, true),
  }))
  const loaded = await provider.get(candidate('demo', false, true), {})
  assert.equal(loaded?.content, '# demo 正文')
  assert.deepEqual(loaded?.invocation, { modelInvocable: false, userInvocable: true })
})

test('given inner get returns undefined, when wrapped get loads, then undefined passes through', async () => {
  const provider = createManualProvider(fakeProvider({}))
  assert.equal(await provider.get(candidate('gone', true, true), {}), undefined)
})

test('given an inner provider, when wrapped, then the provider name is preserved for registry keying', () => {
  const provider = createManualProvider(fakeProvider({ name: 'skill-manual' }))
  assert.equal(provider.name, 'skill-manual')
})

test('given a fully hidden skill, when mapped, then user-invocable false is respected', () => {
  const mapped = toManualSkill(candidate('hidden', true, false))
  assert.deepEqual(mapped.invocation, { modelInvocable: false, userInvocable: false })
})
