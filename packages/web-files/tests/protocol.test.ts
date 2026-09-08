import assert from 'node:assert/strict'
import { test } from 'node:test'

import { detectImageType, IMAGE_MIME } from '../src/protocol.ts'

test('given a common image extension, when detecting, then the matching mime is returned', () => {
  assert.equal(detectImageType('photo.png'), 'image/png')
  assert.equal(detectImageType('photo.jpg'), 'image/jpeg')
  assert.equal(detectImageType('photo.gif'), 'image/gif')
  assert.equal(detectImageType('photo.webp'), 'image/webp')
  assert.equal(detectImageType('photo.svg'), 'image/svg+xml')
})

test('given an uppercase image extension, when detecting, then the match is case-insensitive', () => {
  assert.equal(detectImageType('PHOTO.JPG'), 'image/jpeg')
  assert.equal(detectImageType('photo.PNG'), 'image/png')
})

test('given a non-image or extensionless name, when detecting, then null is returned', () => {
  assert.equal(detectImageType('notes.txt'), null)
  assert.equal(detectImageType('README'), null)
  assert.equal(detectImageType('.bashrc'), null)
})

test('given the image mime table, when checking extensions, then every key maps to an image/* type', () => {
  for (const [extension, mime] of Object.entries(IMAGE_MIME)) {
    assert.ok(extension.startsWith('.'), `extension ${extension} must start with a dot`)
    assert.ok(mime.startsWith('image/'), `mime ${mime} must be an image type`)
  }
})
