/* 生成 PWA PNG 图标（渲染 public/icon.svg → icon-512.png / 192；maskable 版铺满背景）
   用法：node scripts/generate-pwa-icons.mjs */
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const pub = path.resolve(here, '..', 'public')
const svg = readFileSync(path.join(pub, 'icon.svg'), 'utf8')

const browser = await chromium.launch()
for (const [size, out] of [
  [512, 'icon-512.png'],
  [192, 'icon-192.png'],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`, { waitUntil: 'load' })
  const el = page.locator('svg')
  await el.screenshot({ path: path.join(pub, out) })
  await page.close()
}
/* maskable 版：方形满铺（无圆角内缩）——复制 512 并替换背景 */
for (const [size, out] of [
  [512, 'icon-512-maskable.png'],
]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  const flat = svg.replace(/<rect x="0" y="0" width="512" height="512" fill="#0f766e"\/>\s*<rect x="72" y="72" width="368" height="368" rx="80" fill="#0f766e"\/>/,
                          '<rect width="512" height="512" fill="#0f766e"/>')
  await page.setContent(`<html><body style="margin:0">${flat}</body></html>`, { waitUntil: 'load' })
  await page.locator('svg').screenshot({ path: path.join(pub, out) })
  await page.close()
}
await browser.close()
console.log('icons generated in', pub)