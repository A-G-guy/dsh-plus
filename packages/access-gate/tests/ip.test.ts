/**
 * ip.ts 单元测试：v4/v6 解析、CIDR 边界、白名单条目、loopback 判定。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ipEquals,
  ipInCidr,
  isLoopbackAddress,
  parseAllowEntry,
  parseCidr,
  parseIp,
} from '../src/ip.ts'

test('IPv4：解析与等值', () => {
  const a = parseIp('100.86.108.55')
  const b = parseIp('100.86.108.55')
  const c = parseIp('100.86.108.56')
  assert.ok(a !== null && b !== null && c !== null)
  assert.ok(ipEquals(a, b))
  assert.ok(!ipEquals(a, c))
  assert.equal(a.bits, 32)
})

test('IPv4：非法输入返回 null', () => {
  for (const bad of ['256.1.1.1', '1.2.3', '1.2.3.4.5', 'a.b.c.d', '1.2.3.', '']) {
    assert.equal(parseIp(bad), null, bad)
  }
})

test('IPv6：完整/压缩形式解析等值', () => {
  const full = parseIp('fd7a:115c:a1e0::e201:6c8e')
  assert.ok(full !== null)
  assert.equal(full.bits, 128)
  // ::1 与全零展开形式等值
  const loopback = parseIp('::1')
  const loopbackLong = parseIp('0:0:0:0:0:0:0:1')
  assert.ok(loopback !== null && loopbackLong !== null)
  assert.ok(ipEquals(loopback, loopbackLong))
})

test('IPv6：双压缩 / 组数错误 / 映射前缀拒绝', () => {
  assert.equal(parseIp('::1::'), null)
  assert.equal(parseIp('1:2:3:4:5:6:7:8:9'), null)
  assert.equal(parseIp('1:2:3:4:5:6:7'), null)
  assert.equal(parseIp('::ffff:1.2.3.4'), null)
})

test('CIDR：同族包含与跨族拒绝', () => {
  const cidr = parseCidr('100.64.0.0/10')
  assert.ok(cidr !== null)
  const inside = parseIp('100.86.108.55')
  const outside = parseIp('100.128.0.1')
  assert.ok(inside !== null && outside !== null)
  assert.ok(ipInCidr(inside, cidr))
  assert.ok(!ipInCidr(outside, cidr))
  const v6 = parseIp('fd7a:115c:a1e0::ac01:3a9e')
  assert.ok(v6 !== null)
  assert.ok(!ipInCidr(v6, cidr), '跨族 CIDR 不匹配')
})

test('CIDR：v6 前缀边界', () => {
  const cidr = parseCidr('fd7a:115c:a1e0::/48')
  assert.ok(cidr !== null)
  const inside = parseIp('fd7a:115c:a1e0:ac01:3a9e::1')
  const outside = parseIp('fd7a:115c:a1e1::1')
  assert.ok(inside !== null && outside !== null)
  assert.ok(ipInCidr(inside, cidr))
  assert.ok(!ipInCidr(outside, cidr))
})

test('CIDR：前缀越界拒绝', () => {
  assert.equal(parseCidr('1.2.3.4/33'), null)
  assert.equal(parseCidr('::1/129'), null)
  assert.equal(parseCidr('1.2.3.4/abc'), null)
})

test('白名单条目：精确与 CIDR 皆可判定，非法返回 null', () => {
  const ipOf = (text: string): { value: bigint; bits: 32 | 128 } => {
    const parsed = parseIp(text)
    assert.ok(parsed !== null, text)
    return parsed
  }
  const exact = parseAllowEntry('100.108.58.63')
  assert.ok(exact !== null)
  assert.ok(exact(ipOf('100.108.58.63')))
  assert.ok(!exact(ipOf('100.108.58.64')))
  const range = parseAllowEntry('fd7a:115c:a1e0::/48')
  assert.ok(range !== null)
  assert.ok(range(ipOf('fd7a:115c:a1e0::ad37:2b3c')))
  assert.equal(parseAllowEntry('not-an-ip'), null)
  assert.equal(parseAllowEntry('1.2.3.4/99'), null)
})

test('loopback 判定：127/8、::1、v4 映射形态', () => {
  assert.ok(isLoopbackAddress('127.0.0.1'))
  assert.ok(isLoopbackAddress('127.1.2.3'))
  assert.ok(isLoopbackAddress('::1'))
  assert.ok(isLoopbackAddress('::ffff:127.0.0.1'))
  assert.ok(!isLoopbackAddress('100.86.108.55'))
  assert.ok(!isLoopbackAddress('::ffff:100.86.108.55'))
  assert.ok(!isLoopbackAddress(undefined))
})
