/**
 * IP 与 CIDR 解析/匹配纯函数（IPv4 + IPv6，BigInt 位运算实现）。
 * 零依赖、无副作用，node 半与测试共用；非法输入返回 null / false，绝不抛错。
 *
 * 表示约定：IP 一律归一化为「BigInt 数值 + 地址族位宽（32/128）」内部表示，
 * IPv4 不映射进 IPv6 空间（tailscale 环境只会出现原生 v4/v6 字面量，
 * 映射式 ::ffff:x.x.x.x 判等容易引入歧义，映射形式明确拒绝）。
 * @module access-gate/ip
 */

/** 归一化 IP：数值 + 地址族位宽。 */
export interface ParsedIp {
  readonly value: bigint
  readonly bits: 32 | 128
}

/** 解析 IPv4 十进制点分字面量；非法返回 null。 */
function parseIpv4(text: string): bigint | null {
  const parts = text.split('.')
  if (parts.length !== 4) return null
  let value = 0n
  for (const part of parts) {
    if (part.length === 0 || part.length > 3 || !/^\d+$/.test(part)) return null
    const octet = Number(part)
    if (octet > 255) return null
    value = (value << 8n) | BigInt(octet)
  }
  return value
}

/** 把一个组（4 位十六进制）压入累积值；越界（>0xffff）返回 null。 */
function pushGroup(value: bigint, group: string): bigint | null {
  if (group.length === 0 || group.length > 4 || !/^[0-9a-fA-F]+$/.test(group)) return null
  return (value << 16n) | BigInt(Number.parseInt(group, 16))
}

/**
 * 解析 IPv6（含 `::` 压缩与 `::1.2.3.4` 形态的 v4 尾巴；拒绝 zone / 映射前缀）。
 * 算法：按 `::` 切成左右两半 → 各自逐组展开（末组可为点分 v4，占 2 组）
 * → 数值拼接，右半在低位，中间空洞补零。
 */
function parseIpv6(text: string): bigint | null {
  if (text.includes('%') || text.startsWith('::ffff:')) return null
  const gap = text.indexOf('::')
  if (gap !== -1 && text.indexOf('::', gap + 1) !== -1) return null
  const headText = gap === -1 ? text : text.slice(0, gap)
  const tailText = gap === -1 ? '' : text.slice(gap + 2)

  const expandHalf = (half: string, atStart: boolean): { value: bigint; groups: number } | null => {
    if (half === '') return { value: 0n, groups: 0 }
    const rawGroups = half.split(':')
    if (rawGroups.some((group) => group === '')) return null
    // v4 尾巴只允许出现在整串的最末一组。
    const dotted = rawGroups.findIndex((group) => group.includes('.'))
    if (dotted !== -1 && !(dotted === rawGroups.length - 1 && !atStart)) return null
    let value = 0n
    let groups = 0
    for (const group of rawGroups) {
      if (group.includes('.')) {
        const v4 = parseIpv4(group)
        if (v4 === null) return null
        value = (value << 32n) | v4
        groups += 2
      } else {
        const next = pushGroup(value, group)
        if (next === null) return null
        value = next
        groups += 1
      }
    }
    return { value, groups }
  }

  const head = expandHalf(headText, true)
  const tail = expandHalf(tailText, false)
  if (head === null || tail === null) return null
  const total = head.groups + tail.groups
  if (total > 8) return null
  if (gap === -1 && total !== 8) return null
  if (gap !== -1 && total >= 8) return null
  // 右半在最低位，其后才是洞：head 左移「洞 + 右半」的组数。
  const holeAndTail = BigInt(8 - head.groups) * 16n
  return (head.value << holeAndTail) | tail.value
}

/** 解析任意 IP 字面量；非法返回 null。 */
export function parseIp(text: string): ParsedIp | null {
  const trimmed = text.trim()
  if (trimmed.includes(':')) {
    const value = parseIpv6(trimmed)
    return value === null ? null : { value, bits: 128 }
  }
  const value = parseIpv4(trimmed)
  return value === null ? null : { value, bits: 32 }
}

/** 归一化 CIDR；非法（IP 解析失败 / 前缀越界）返回 null。 */
export function parseCidr(text: string): { ip: ParsedIp; prefix: number } | null {
  const slash = text.indexOf('/')
  if (slash === -1) return null
  const ip = parseIp(text.slice(0, slash))
  const prefixText = text.slice(slash + 1)
  if (ip === null || !/^\d{1,3}$/.test(prefixText)) return null
  const prefix = Number(prefixText)
  if (prefix > ip.bits) return null
  return { ip, prefix }
}

/** 同族且数值相等。 */
export function ipEquals(a: ParsedIp, b: ParsedIp): boolean {
  return a.bits === b.bits && a.value === b.value
}

/** 判断 IP 是否落入 CIDR；跨族（v4 vs v6）恒 false。 */
export function ipInCidr(ip: ParsedIp, cidr: { ip: ParsedIp; prefix: number }): boolean {
  if (ip.bits !== cidr.ip.bits) return false
  const shift = BigInt(ip.bits - cidr.prefix)
  return ip.value >> shift === cidr.ip.value >> shift
}

/** 解析白名单条目（精确 IP 或 CIDR）；返回可判定函数，非法条目返回 null。 */
export function parseAllowEntry(text: string): ((ip: ParsedIp) => boolean) | null {
  const trimmed = text.trim()
  const cidr = parseCidr(trimmed)
  if (cidr !== null) {
    return (ip) => ipInCidr(ip, cidr)
  }
  const exact = parseIp(trimmed)
  if (exact !== null) {
    return (ip) => ipEquals(ip, exact)
  }
  return null
}

/** 判断 remoteAddress 是否 loopback（node 形态：`127.x.x.x` / `::1` / `::ffff:127.x.x.x`）。 */
export function isLoopbackAddress(remoteAddress: string | undefined): boolean {
  if (remoteAddress === undefined) return false
  const bare = remoteAddress.startsWith('::ffff:') ? remoteAddress.slice(7) : remoteAddress
  if (bare === '::1') return true
  const parsed = parseIp(bare)
  if (parsed === null || parsed.bits !== 32) return false
  return parsed.value >= 0x7f000000n && parsed.value <= 0x7ffffffen
}
