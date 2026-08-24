import { parseDocument } from 'yaml'

const doc3 = parseDocument(`# mymarker
- id: x
  disabled: true
`)
const item = doc3.contents.items[0]
console.log('item keys:', Object.keys(item))
console.log('item.commentBefore:', JSON.stringify(item.commentBefore))
const js = doc3.toJS()
console.log('toJS:', JSON.stringify(js))

// append via createNode + comment
const doc4 = parseDocument(`- id: a
`)
const node = doc4.createNode({ id: 'b', disabled: true })
node.commentBefore = ' dsh-plus-feature-toggle:managed'
doc4.contents.items.push(node)
console.log('---serialized---')
console.log(doc4.toString())

// comment round-trip through file
const doc5 = parseDocument(doc4.toString())
const js5 = doc5.toJS()
console.log('roundtrip js5:', JSON.stringify(js5))
const item5 = doc5.contents.items[1]
console.log('item5.commentBefore:', JSON.stringify(item5.commentBefore))
