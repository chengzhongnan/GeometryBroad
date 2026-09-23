// KaTeX 在画布与 SVG 导出两条路径上的渲染工具。
//
// 设计要点：
//   - SVG 导出是同步的：测尺寸用隐藏 div（同源浏览器）或近似（Node），
//     产出 `<svg><foreignObject>` 片段后直接塞进 SvgRenderContext。
//   - Canvas 实时渲染没法等异步：用同样的 SVG 片段当 data URL，
//     `Image` 加载完成后 drawImage 到离屏 canvas 缓存，下次重绘同步贴上。
//   - 缓存解析完成后通过订阅通知 GeometryCanvas 重绘。

import katex from 'katex';
// Vite 内置 ?raw：把 CSS 当字符串导入，构建期把 katex.min.css 内容打进 bundle。
// 这样导出的 SVG 可以单文件包含 KaTeX 样式（<defs><style>...）。
import katexCss from 'katex/dist/katex.min.css?raw';

export { katexCss };

interface CanvasEntry {
    promise: Promise<HTMLCanvasElement>;
    canvas?: HTMLCanvasElement;
}

const canvasCache = new Map<string, CanvasEntry>();
const listeners = new Set<() => void>();

function makeKey(latex: string, fontSize: number, color: string, displayMode: boolean): string {
    return `${fontSize}::${color}::${displayMode ? 'display' : 'inline'}::${latex}`;
}

// ----- 自包含 KaTeX CSS（内联字体为 base64 data URI）-----
//
// 问题：katex.min.css?raw 是原始内容，里面的 `@font-face` 引用 `fonts/KaTeX_*.woff2`
// 等相对路径。导出 SVG 单文件查看时（预览面板、邮件附件等），相对路径找不到字体，
// KaTeX 回落到系统字体，看起来就不像 KaTeX 了。
//
// 解决：模块加载时用 Vite 的 `import.meta.glob` 拿到所有 KaTeX 字体的实际 URL，
// fetch + base64 编码后替换 CSS 里的 url(fonts/...) 为 data URI。这样导出的
// SVG 完全自包含，浏览器打开就能正确渲染 KaTeX。
//
// 仅浏览器执行（需要 window/fetch）；Node/esbuild 直接跳过，回退到原始 CSS。

// Vite 构建时把每个字体文件变成带 hash 的 asset 并给出 URL。
// 显式导入比 `import.meta.glob` 可靠——后者对 node_modules 内的字体静默不展开。
import katexAmsRegularUrl from 'katex/dist/fonts/KaTeX_AMS-Regular.woff2?url';
import katexCaligraphicBoldUrl from 'katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2?url';
import katexCaligraphicRegularUrl from 'katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2?url';
import katexFrakturBoldUrl from 'katex/dist/fonts/KaTeX_Fraktur-Bold.woff2?url';
import katexFrakturRegularUrl from 'katex/dist/fonts/KaTeX_Fraktur-Regular.woff2?url';
import katexMainBoldUrl from 'katex/dist/fonts/KaTeX_Main-Bold.woff2?url';
import katexMainBoldItalicUrl from 'katex/dist/fonts/KaTeX_Main-BoldItalic.woff2?url';
import katexMainItalicUrl from 'katex/dist/fonts/KaTeX_Main-Italic.woff2?url';
import katexMainRegularUrl from 'katex/dist/fonts/KaTeX_Main-Regular.woff2?url';
import katexMathBoldItalicUrl from 'katex/dist/fonts/KaTeX_Math-BoldItalic.woff2?url';
import katexMathItalicUrl from 'katex/dist/fonts/KaTeX_Math-Italic.woff2?url';
import katexSansSerifBoldUrl from 'katex/dist/fonts/KaTeX_SansSerif-Bold.woff2?url';
import katexSansSerifItalicUrl from 'katex/dist/fonts/KaTeX_SansSerif-Italic.woff2?url';
import katexSansSerifRegularUrl from 'katex/dist/fonts/KaTeX_SansSerif-Regular.woff2?url';
import katexScriptRegularUrl from 'katex/dist/fonts/KaTeX_Script-Regular.woff2?url';
import katexSize1RegularUrl from 'katex/dist/fonts/KaTeX_Size1-Regular.woff2?url';
import katexSize2RegularUrl from 'katex/dist/fonts/KaTeX_Size2-Regular.woff2?url';
import katexSize3RegularUrl from 'katex/dist/fonts/KaTeX_Size3-Regular.woff2?url';
import katexSize4RegularUrl from 'katex/dist/fonts/KaTeX_Size4-Regular.woff2?url';
import katexTypewriterRegularUrl from 'katex/dist/fonts/KaTeX_Typewriter-Regular.woff2?url';

const fontUrlByName: Record<string, string> = {
    'KaTeX_AMS-Regular.woff2': katexAmsRegularUrl,
    'KaTeX_Caligraphic-Bold.woff2': katexCaligraphicBoldUrl,
    'KaTeX_Caligraphic-Regular.woff2': katexCaligraphicRegularUrl,
    'KaTeX_Fraktur-Bold.woff2': katexFrakturBoldUrl,
    'KaTeX_Fraktur-Regular.woff2': katexFrakturRegularUrl,
    'KaTeX_Main-Bold.woff2': katexMainBoldUrl,
    'KaTeX_Main-BoldItalic.woff2': katexMainBoldItalicUrl,
    'KaTeX_Main-Italic.woff2': katexMainItalicUrl,
    'KaTeX_Main-Regular.woff2': katexMainRegularUrl,
    'KaTeX_Math-BoldItalic.woff2': katexMathBoldItalicUrl,
    'KaTeX_Math-Italic.woff2': katexMathItalicUrl,
    'KaTeX_SansSerif-Bold.woff2': katexSansSerifBoldUrl,
    'KaTeX_SansSerif-Italic.woff2': katexSansSerifItalicUrl,
    'KaTeX_SansSerif-Regular.woff2': katexSansSerifRegularUrl,
    'KaTeX_Script-Regular.woff2': katexScriptRegularUrl,
    'KaTeX_Size1-Regular.woff2': katexSize1RegularUrl,
    'KaTeX_Size2-Regular.woff2': katexSize2RegularUrl,
    'KaTeX_Size3-Regular.woff2': katexSize3RegularUrl,
    'KaTeX_Size4-Regular.woff2': katexSize4RegularUrl,
    'KaTeX_Typewriter-Regular.woff2': katexTypewriterRegularUrl,
};

let inlinedKatexCss: string | null = null;
let inlinedKatexCssReady = false;
let inlinedKatexCssPromise: Promise<void> = Promise.resolve();

if (typeof window !== 'undefined' && typeof fetch !== 'undefined') {
    inlinedKatexCssPromise = (async () => {
        try {
            const needed = new Set<string>();
            const re = /url\(fonts\/([^)]+)\)/g;
            let mm: RegExpExecArray | null;
            while ((mm = re.exec(katexCss)) !== null) needed.add(mm[1]);

            const dataUriByName: Record<string, string> = {};
            await Promise.all(
                [...needed].map(async (fname) => {
                    const url = fontUrlByName[fname];
                    if (!url) return;
                    try {
                        const resp = await fetch(url);
                        const buf = await resp.arrayBuffer();
                        const bytes = new Uint8Array(buf);
                        let bin = '';
                        const CHUNK = 0x8000;
                        for (let i = 0; i < bytes.length; i += CHUNK) {
                            // eslint-disable-next-line @typescript-eslint/no-explicit-any
                            bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
                        }
                        const ext = fname.split('.').pop() || '';
                        const mime = ext === 'woff2' ? 'font/woff2' : ext === 'woff' ? 'font/woff' : ext === 'ttf' ? 'font/ttf' : 'application/octet-stream';
                        dataUriByName[fname] = `data:${mime};base64,${btoa(bin)}`;
                    } catch {
                        // 单个字体失败不阻塞整体
                    }
                })
            );

            inlinedKatexCss = katexCss.replace(
                /url\(fonts\/([^)]+)\)/g,
                (_, fname: string) => (dataUriByName[fname] ? `url(${dataUriByName[fname]})` : `url(fonts/${fname})`)
            );
        } catch {
            // 回退到原始 CSS；结构仍由 KaTeX HTML/CSS 渲染。
        } finally {
            inlinedKatexCssReady = true;
        }
    })();
}

// 同步获取"当前最佳"KaTeX CSS：内联版本准备好就用它，否则退回原始 CSS。
// 导出 SVG 的 `<defs><style>` 走这里。
export function getEffectiveKatexCss(): string {
    if (inlinedKatexCssReady && inlinedKatexCss) return inlinedKatexCss;
    return katexCss;
}

export interface KatexMeasure {
    width: number;
    height: number;
}

// 同步测量 KaTeX 的像素尺寸。
// 浏览器：把 KaTeX HTML 放进隐藏 div，用 getBoundingClientRect 拿真实大小。
// Node（SVG 离线导出走 esbuild 打包时没有 document）：按字符数近似，
// 数值粗略但能让导出脚本不报错。
export function measureKatex(latex: string, fontSize: number, color: string, displayMode = false): KatexMeasure {
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        const div = document.createElement('div');
        div.style.position = 'absolute';
        div.style.visibility = 'hidden';
        div.style.whiteSpace = 'nowrap';
        div.style.left = '-99999px';
        div.style.top = '-99999px';
        div.style.fontSize = `${fontSize}px`;
        div.style.color = color;
        div.style.display = 'inline-block';
        try {
            div.innerHTML = katex.renderToString(latex, {
                throwOnError: false,
                strict: 'ignore',
                output: 'html',
                displayMode,
            });
            document.body.appendChild(div);
            const rect = div.getBoundingClientRect();
            document.body.removeChild(div);
            // 给点余量，避免某些浏览器 sub-pixel 截断
            return { width: rect.width, height: rect.height };
        } catch {
            if (div.parentNode) div.parentNode.removeChild(div);
            return { width: latex.length * fontSize * 0.6 + 8, height: fontSize * 1.4 };
        }
    }
    // Node 回退：基于字符数的近似。
    const approxCharWidth = fontSize * 0.6;
    return { width: latex.length * approxCharWidth + 8, height: fontSize * 1.4 };
}

export interface KatexFragment {
    fragment: string;
    width: number;
    height: number;
}

// 构造一个独立的 `<svg>` 片段，里面是 `<foreignObject>` 包着 KaTeX HTML。
// `includeCss=true` 时片段自带 KaTeX CSS（Canvas data URL 渲染需要）。
// `includeCss=false` 时片段省略 CSS（导出 SVG 走顶层 <defs><style>）。
export function renderKatexToSvgFragment(
    latex: string,
    fontSize: number,
    color: string,
    opts: { includeCss?: boolean; displayMode?: boolean } = {}
): KatexFragment {
    const includeCss = opts.includeCss !== false;
    const displayMode = opts.displayMode === true;
    const { width, height } = measureKatex(latex, fontSize, color, displayMode);
    const html = katex.renderToString(latex, {
        throwOnError: false,
        strict: 'ignore',
        output: 'html',
        displayMode,
    });
    const styleBlock = includeCss ? `<style>${getEffectiveKatexCss()}</style>` : '';
    const fragment =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
        `${styleBlock}` +
        `<foreignObject x="0" y="0" width="${width}" height="${height}">` +
        `<div xmlns="http://www.w3.org/1999/xhtml" style="font-size:${fontSize}px;color:${color};display:inline-block;line-height:1">` +
        `${html}` +
        `</div>` +
        `</foreignObject>` +
        `</svg>`;
    return { fragment, width, height };
}

// 异步把 KaTeX 渲到离屏 canvas。结果放进缓存；同一个 latex 重复调用只跑一次。
// 仅在浏览器里能用（依赖 document/Image）。SVG 离线导出不要走这里。
export function prefetchKatexToCanvas(latex: string, fontSize: number, color: string, displayMode = false): void {
    if (typeof document === 'undefined') return;
    const key = makeKey(latex, fontSize, color, displayMode);
    if (canvasCache.has(key)) return;
    const entry: CanvasEntry = {
        promise: Promise.resolve().then(() => doRender(latex, fontSize, color, displayMode)),
    };
    canvasCache.set(key, entry);
    entry.promise
        .then((canvas) => {
            entry.canvas = canvas;
            for (const fn of listeners) fn();
        })
        .catch(() => {
            // KaTeX 在 throwOnError:false 下基本不会失败；这里只是兜底。
        });
}

async function doRender(latex: string, fontSize: number, color: string, displayMode = false): Promise<HTMLCanvasElement> {
    // data: SVG 不能可靠解析 CSS 中的相对字体路径；先等字体 CSS 内联完成，
    // 再生成离屏图片，避免首次渲染永久落到系统字体回退。
    await inlinedKatexCssPromise;
    const { fragment, width, height } = renderKatexToSvgFragment(latex, fontSize, color, {
        includeCss: true,
        displayMode,
    });
    const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(fragment);
    const img = new Image();
    img.src = dataUrl;
    await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = (e) => reject(e);
    });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Cannot acquire 2d context for KaTeX offscreen canvas');
    ctx.drawImage(img, 0, 0, width, height);
    return canvas;
}

export function getCachedKatexCanvas(latex: string, fontSize: number, color: string, displayMode = false): HTMLCanvasElement | null {
    const entry = canvasCache.get(makeKey(latex, fontSize, color, displayMode));
    return entry?.canvas ?? null;
}

export function subscribeKatexUpdates(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
        listeners.delete(fn);
    };
}