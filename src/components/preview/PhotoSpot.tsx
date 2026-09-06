import { useRef, useState } from 'react'
import { Camera, RefreshCw, Trash2 } from 'lucide-react'
import { compressImage } from '@/lib/fileIO'
import { toast } from 'sonner'

interface PhotoSpotProps {
  photo?: string
  /** 缩放倍数（相对基础尺寸） */
  scale?: number
  /** 相对默认位置的像素偏移 */
  pos?: { dx: number; dy: number }
  onChange: (photo: string | undefined) => void
  onChangeScale: (scale: number) => void
  onChangePos: (pos: { dx: number; dy: number }) => void
  /** float：简约/经典模板中浮动右上；sidebar：现代模板侧栏顶部 */
  variant: 'float' | 'sidebar'
}

const MIN_SCALE = 0.5
const MAX_SCALE = 3

/**
 * 证件照位：
 * - 无照片：虚线占位框（仅编辑预览显示，导出 PDF 时隐藏）
 * - 有照片：hover 显示 更换 / 移除；按住拖拽移动；右下角手柄拉伸缩放
 * - 位置与比例随简历存本机 IndexedDB；导出 PDF 包含移动/缩放结果
 */
export function PhotoSpot({
  photo,
  scale = 1,
  pos = { dx: 0, dy: 0 },
  onChange,
  onChangeScale,
  onChangePos,
  variant,
}: PhotoSpotProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [livePos, setLivePos] = useState<{ dx: number; dy: number } | null>(null)
  const [liveScale, setLiveScale] = useState<number | null>(null)
  const [interacting, setInteracting] = useState(false)

  const shownPos = livePos ?? pos
  const shownScale = liveScale ?? scale

  const pick = () => inputRef.current?.click()

  const startDrag = (e: React.PointerEvent) => {
    if (!photo || e.button !== 0) return
    // 落在更换/移除按钮上不进入拖拽（指针捕获会吞掉按钮的 click）
    if ((e.target as HTMLElement).closest('.photo-chrome')) return
    e.preventDefault()
    const el = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startY = e.clientY
    const baseDx = pos.dx
    const baseDy = pos.dy
    setInteracting(true)

    const onMove = (ev: PointerEvent) => {
      setLivePos({
        dx: clamp(baseDx + ev.clientX - startX, -420, 420),
        dy: clamp(baseDy + ev.clientY - startY, -560, 560),
      })
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setInteracting(false)
      const next = {
        dx: clamp(baseDx + ev.clientX - startX, -420, 420),
        dy: clamp(baseDy + ev.clientY - startY, -560, 560),
      }
      setLivePos(null)
      if (next.dx !== pos.dx || next.dy !== pos.dy) onChangePos(next)
    }
    // 指针捕获：鼠标移出元素或触屏拖动也能持续收到事件
    el.setPointerCapture(e.pointerId)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const startResize = (e: React.PointerEvent) => {
    if (!photo || e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget as HTMLElement
    const startX = e.clientX
    const startY = e.clientY
    const baseScale = scale
    setInteracting(true)

    const onMove = (ev: PointerEvent) => {
      const delta = (ev.clientX - startX + (ev.clientY - startY)) / 2
      setLiveScale(clamp(baseScale + delta / 120, MIN_SCALE, MAX_SCALE))
    }
    const onUp = (ev: PointerEvent) => {
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      setInteracting(false)
      const delta = (ev.clientX - startX + (ev.clientY - startY)) / 2
      const next = clamp(baseScale + delta / 120, MIN_SCALE, MAX_SCALE)
      setLiveScale(null)
      if (next !== scale) onChangeScale(next)
    }
    el.setPointerCapture(e.pointerId)
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  const handleFile = async (file: File | undefined) => {
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast.error('请选择图片文件')
      return
    }
    try {
      const dataUrl = await compressImage(file, 480)
      onChange(dataUrl)
      toast.success('证件照已更新')
    } catch {
      toast.error('图片处理失败，请换一张试试')
    }
  }

  return (
    <div
      className="photo-spot"
      data-variant={variant}
      data-has-photo={photo || undefined}
      data-interacting={interacting || undefined}
      style={{
        transform: `translate(${shownPos.dx}px, ${shownPos.dy}px) scale(${shownScale})`,
        transformOrigin: variant === 'float' ? 'top right' : 'top center',
        zIndex: interacting ? 30 : undefined,
      }}
    >
      {photo ? (
        <div
          className="photo-frame"
          onPointerDown={startDrag}
          title="拖拽移动 · 右下角手柄缩放"
          style={{ touchAction: 'none' }}
        >
          <img src={photo} alt="证件照" draggable={false} />
          <div className="photo-chrome">
            <button title="更换照片" aria-label="更换照片" onClick={pick}>
              <RefreshCw className="size-3.5" />
            </button>
            <button title="移除照片" aria-label="移除照片" onClick={() => onChange(undefined)}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
          <div
            className="photo-resize-handle"
            title="拉伸调整大小"
            aria-label="调整照片大小"
            onPointerDown={startResize}
            style={{ touchAction: 'none' }}
          />
        </div>
      ) : (
        <button className="photo-empty" onClick={pick} title="上传证件照">
          <Camera className="size-4" />
          <span>证件照</span>
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
    </div>
  )
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v))
}
