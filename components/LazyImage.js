import { siteConfig } from '@/lib/config'
import { optimizeNotionImage } from '@/lib/db/notion/mapImage'
import Head from 'next/head'
import { useCallback, useEffect, useRef, useState } from 'react'

const getTargetImageWidth = (width, maxWidth) => {
  const parsedWidth = Number(width)
  const parsedMaxWidth = Number(maxWidth)

  if (Number.isFinite(parsedWidth) && parsedWidth > 0) {
    return Number.isFinite(parsedMaxWidth) && parsedMaxWidth > 0
      ? Math.min(parsedWidth, parsedMaxWidth)
      : parsedWidth
  }

  return maxWidth
}

/**
 * 图片懒加载
 * @param {*} param0
 * @returns
 */
export default function LazyImage({
  priority,
  id,
  src,
  alt,
  fallbackSrc,
  placeholderSrc,
  className,
  width,
  height,
  title,
  onLoad,
  onClick,
  style,
  loading
}) {
  const maxWidth = siteConfig('IMAGE_COMPRESS_WIDTH')
  const targetImageWidth = getTargetImageWidth(width, maxWidth)
  const defaultPlaceholderSrc = siteConfig('IMG_LAZY_LOAD_PLACEHOLDER')
  const imageRef = useRef(null)
  const [currentSrc, setCurrentSrc] = useState(
    priority && src
      ? getImageSrc(src, targetImageWidth, maxWidth)
      : placeholderSrc || defaultPlaceholderSrc
  )
  const [imageLoaded, setImageLoaded] = useState(Boolean(priority && src))

  /**
   * 占位图加载成功
   */
  const handleThumbnailLoaded = () => {
    if (typeof onLoad === 'function') {
      // onLoad() // 触发传递的onLoad回调函数
    }
  }

  const handleImageError = useCallback(() => {
    if (imageRef.current) {
      // 优先回退 fallbackSrc，再尝试 placeholderSrc，最后 defaultPlaceholderSrc
      if (imageRef.current.src !== fallbackSrc && fallbackSrc) {
        imageRef.current.src = fallbackSrc
      } else if (imageRef.current.src !== placeholderSrc && placeholderSrc) {
        imageRef.current.src = placeholderSrc
      } else {
        imageRef.current.src = defaultPlaceholderSrc
      }
      setImageLoaded(true)
      imageRef.current.classList.remove('lazy-image-placeholder')
    }
  }, [defaultPlaceholderSrc, fallbackSrc, placeholderSrc])

  useEffect(() => {
    const adjustedImageSrc =
      adjustImgSize(src, targetImageWidth) || defaultPlaceholderSrc
    // Notion 图片优先走 Vercel 图片优化
    const imageSrc =
      getImageSrc(src, targetImageWidth, maxWidth) || adjustedImageSrc
    const imageElement = imageRef.current
    const handleImageLoaded = () => {
      if (typeof onLoad === 'function') {
        onLoad()
      }
      setImageLoaded(true)
      if (imageRef.current) {
        imageRef.current.classList.remove('lazy-image-placeholder')
      }
    }

    /**
     * 预加载图片，成功后再替换占位图
     * 图片优化失败时（如超出额度返回 402）先回退到原图，原图也失败才走 handleImageError
     */
    const preloadImage = img => {
      let loadingSrc = imageSrc
      img.onload = () => {
        setCurrentSrc(loadingSrc)
        handleImageLoaded(loadingSrc)
      }
      img.onerror = () => {
        if (loadingSrc !== adjustedImageSrc) {
          loadingSrc = adjustedImageSrc
          img.src = loadingSrc
          return
        }
        handleImageError()
      }
      img.src = loadingSrc
    }

    // 如果是优先级图片，直接加载
    if (priority) {
      preloadImage(new Image())
      return
    }

    // 检查浏览器是否支持IntersectionObserver
    if (!window.IntersectionObserver) {
      // 降级处理：直接加载图片
      preloadImage(new Image())
      return
    }

    const observer = new IntersectionObserver(
      entries => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // 预加载图片
            const img = new Image()
            // 设置图片解码优先级
            if ('decoding' in img) {
              img.decoding = 'async'
            }
            preloadImage(img)

            observer.unobserve(entry.target)
          }
        })
      },
      {
        rootMargin: siteConfig('LAZY_LOAD_THRESHOLD', '200px'),
        threshold: 0.1
      }
    )

    if (imageElement) {
      observer.observe(imageElement)
    }

    return () => {
      if (imageElement) {
        observer.unobserve(imageElement)
      }
    }
  }, [
    src,
    targetImageWidth,
    maxWidth,
    priority,
    defaultPlaceholderSrc,
    fallbackSrc,
    handleImageError,
    onLoad,
    placeholderSrc
  ])

  // 动态添加width、height和className属性，仅在它们为有效值时添加
  const imgProps = {
    ref: imageRef,
    src: currentSrc,
    'data-src': src, // 存储原始图片地址
    alt: alt || 'Lazy loaded image',
    onLoad: handleThumbnailLoaded,
    onError: handleImageError,
    className: `${className || ''}${imageLoaded ? '' : ' lazy-image-placeholder'}`,
    style: {
      aspectRatio: width && height ? `${width} / ${height}` : undefined,
      containIntrinsicSize: width || height ? undefined : '300px 200px',
      ...style
    },
    onClick,
    // 性能优化属性
    loading: priority ? 'eager' : loading || 'lazy',
    decoding: 'async',
    // 现代图片格式支持
    ...(siteConfig('WEBP_SUPPORT') && { 'data-webp': true }),
    ...(siteConfig('AVIF_SUPPORT') && { 'data-avif': true })
  }

  if (id) imgProps.id = id
  if (title) imgProps.title = title
  if (width) imgProps.width = width
  if (height) imgProps.height = height
  if (priority) imgProps.fetchpriority = 'high'

  if (!src) {
    return null
  }

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={imgProps.alt} {...imgProps} />
      {/* 预加载 */}
      {priority && (
        <Head>
          <link
            rel='preload'
            as='image'
            href={getImageSrc(src, targetImageWidth, maxWidth)}
            fetchpriority='high'
          />
        </Head>
      )}
    </>
  )
}

/**
 * Notion 图片改走 Vercel 图片优化，其余图片按窗口尺寸压缩
 * 优化时用未按屏宽调整的原地址，避免不同屏幕宽度各产生一份缓存、重复消耗转换额度；
 * 按 2 倍宽度取图兼顾高清屏，但不超过 IMAGE_COMPRESS_WIDTH
 * @param {*} src
 * @param {*} targetWidth
 * @param {*} maxWidth
 * @returns
 */
const getImageSrc = (src, targetWidth, maxWidth) => {
  const optimizedSrc = optimizeNotionImage(
    src,
    Math.min(Number(targetWidth) * 2, Number(maxWidth)) || targetWidth
  )
  return optimizedSrc !== src ? optimizedSrc : adjustImgSize(src, targetWidth)
}

/**
 * 根据窗口尺寸决定压缩图片宽度
 * @param {*} src
 * @param {*} maxWidth
 * @returns
 */
const adjustImgSize = (src, maxWidth) => {
  if (!src) {
    return null
  }
  const screenWidth =
    (typeof window !== 'undefined' && window?.screen?.width) || maxWidth
  const parsedMaxWidth = Number(maxWidth)
  const targetWidth =
    Number.isFinite(parsedMaxWidth) && parsedMaxWidth > 0
      ? Math.min(screenWidth, parsedMaxWidth)
      : screenWidth

  // 屏幕尺寸大于默认图片尺寸，没必要再压缩
  if (!targetWidth) {
    return src
  }

  // 正则表达式，用于匹配 URL 中的 width 参数
  const widthRegex = /width=\d+/
  // 正则表达式，用于匹配 URL 中的 w 参数
  const wRegex = /w=\d+/

  // 使用正则表达式替换 width/w 参数
  return src
    .replace(widthRegex, `width=${targetWidth}`)
    .replace(wRegex, `w=${targetWidth}`)
}
