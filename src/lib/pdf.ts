import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'

/**
 * A4 @96dpi：794 × 1123 px。html2canvas 以 scale=2 截图后按页切片导出，
 * 保证 PDF 与预览（分页线即切割位置）完全一致。
 */
const A4_WIDTH_MM = 210
const A4_HEIGHT_MM = 297

/** 截取整张纸张（含多页）为一张画布：导出态 + 祖先 transform 临时还原，PDF/PNG 共用 */
async function capturePaper(paperEl: HTMLElement): Promise<HTMLCanvasElement> {
  // 导出态：隐藏分页线等仅预览元素
  paperEl.classList.add('exporting')
  // 预览纸张外层带 transform:scale() 缩放，html2canvas 对祖先变换处理不可靠：
  // 导出期间临时还原为 1:1（纸张由滚动容器裁切，仅短暂视觉变化），结束后恢复
  const restores: (() => void)[] = []
  for (let el: HTMLElement | null = paperEl; el && el !== document.body; el = el.parentElement) {
    const prev = el.style.transform
    if (prev && prev !== 'none') {
      el.style.transform = 'none'
      restores.push(() => {
        el.style.transform = prev
      })
    }
  }
  try {
    // 智能一页模式下内容层带 transform，scrollHeight 是未缩放的布局高度，
    // 导出尺寸必须取视觉盒（祖先 transform 已在上面临时还原）
    const rect = paperEl.getBoundingClientRect()
    return await html2canvas(paperEl, {
      scale: 2,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
      // 关闭滚动裁切：内容可能溢出容器
      windowWidth: Math.ceil(rect.width),
      windowHeight: Math.ceil(rect.height),
    })
  } finally {
    restores.forEach((restore) => restore())
    paperEl.classList.remove('exporting')
  }
}

export async function exportPaperToPdf(paperEl: HTMLElement, filename: string): Promise<void> {
  const canvas = await capturePaper(paperEl)

  const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })
  // 一页 A4 对应的 canvas 像素高度（向上取整，保证单页内容完整落在第一页）
  const pageHpx = Math.ceil((canvas.width * A4_HEIGHT_MM) / A4_WIDTH_MM)
  // 末页仅剩几像素的舍入残差时视为空白丢弃：
  // 否则"单页简历导出多一页空白页"——亚像素高度误差会触发一个几乎不可见的尾页
  const eps = Math.max(4, Math.floor(pageHpx * 0.004))

  let rendered = 0
  let page = 0
  while (canvas.height - rendered > eps) {
    const sliceH = Math.min(pageHpx, canvas.height - rendered)
    // 页画布固定 A4 比例，末页不足处补白
    const pageCanvas = document.createElement('canvas')
    pageCanvas.width = canvas.width
    pageCanvas.height = pageHpx
    const ctx = pageCanvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, pageCanvas.width, pageCanvas.height)
    ctx.drawImage(canvas, 0, rendered, canvas.width, sliceH, 0, 0, canvas.width, sliceH)

    if (page > 0) pdf.addPage()
    pdf.addImage(pageCanvas.toDataURL('image/jpeg', 0.94), 'JPEG', 0, 0, A4_WIDTH_MM, A4_HEIGHT_MM)
    rendered += sliceH
    page += 1
  }

  pdf.save(ensureExt(filename, '.pdf'))
}

/** 长图 PNG：整张纸张（多页纵向拼接）导出为一张图，适合社交/群聊分享 */
export async function exportPaperToPng(paperEl: HTMLElement, filename: string): Promise<void> {
  const canvas = await capturePaper(paperEl)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (!blob) throw new Error('生成图片失败')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = ensureExt(filename, '.png')
  a.click()
  URL.revokeObjectURL(url)
}

function ensureExt(name: string, ext: string): string {
  const lower = ext.toLowerCase()
  return name.toLowerCase().endsWith(lower) ? name : `${name}${ext}`
}