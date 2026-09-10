/** 浏览器文件读写工具：.md / .json 导入导出 */

/** 触发浏览器下载：统一处理「插入 DOM → 点击 → 延迟回收」，跨浏览器更稳 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  // Safari 要求节点在文档中 click 才生效
  document.body.appendChild(a)
  a.click()
  a.remove()
  /* 立即 revoke 会让部分浏览器来不及取数据（下载被取消）：
     延迟回收，给下载留出启动时间 */
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadFile(content: string, filename: string, mime: string): void {
  downloadBlob(new Blob([content], { type: `${mime};charset=utf-8` }), filename)
}

/**
 * 字节 → 文本。
 * 先按 UTF-8 解；出现替换字符说明不是 UTF-8 —— Windows 上的中文 .md 常存成 GBK，
 * 直接按 UTF-8 读会整篇乱码。此时用 GBK 复解，取替换字符更少的一侧。
 */
function decodeBytes(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  const badCount = (s: string) => (s.match(/\uFFFD/g) ?? []).length
  if (badCount(utf8) === 0) return utf8
  try {
    const gbk = new TextDecoder('gbk').decode(bytes)
    return badCount(gbk) < badCount(utf8) ? gbk : utf8
  } catch {
    // 环境不支持 gbk 标签：保持 UTF-8 结果
    return utf8
  }
}

/** 打开文件选择框，读取为文本；用户取消时同样 resolve(null) */
export function pickTextFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    let settled = false
    const done = (v: { name: string; text: string } | null) => {
      if (settled) return
      settled = true
      resolve(v)
    }
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) {
        done(null)
        return
      }
      const reader = new FileReader()
      reader.onload = () => done({ name: file.name, text: decodeBytes(reader.result as ArrayBuffer) })
      reader.onerror = () => done(null)
      reader.readAsArrayBuffer(file)
    }
    /* 取消选择时不会触发 change：不处理会让 await 永久挂起、界面毫无反馈 */
    input.oncancel = () => done(null)
    input.click()
  })
}

/** 安全解析 JSON 文件 */
export function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T
  } catch {
    return null
  }
}

/** 从文件名推导简历标题（去扩展名） */
export function titleFromFilename(name: string): string {
  return name.replace(/\.(md|markdown|txt)$/i, '').trim() || '未命名简历'
}

/** 读取图片文件并压缩为 dataURL（最长边不超过 maxDim） */
export function compressImage(file: File, maxDim = 480): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const w = Math.max(1, Math.round(img.width * scale))
        const h = Math.max(1, Math.round(img.height * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          reject(new Error('canvas unavailable'))
          return
        }
        // JPEG 不支持透明 → 白底填充
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, w, h)
        ctx.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.85))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}
