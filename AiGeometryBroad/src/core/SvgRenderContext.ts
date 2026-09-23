// 一个与 CanvasRenderingContext2D 部分接口兼容的 SVG 渲染上下文。
// 目的：让现有的 GeometricObject.draw(ctx, transform, options) 无需修改即可输出 SVG。
//
// 约定：
// 1. 现有绘制代码已经自行做了 y 轴翻转（例如 `0 - y`），因此这里直接记录传入坐标，不做二次翻转。
// 2. 只实现绘制代码实际用到的接口，不追求完整 Canvas 兼容。

import { getEffectiveKatexCss } from './katexRender';

export interface SvgBounds {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
}

interface SvgStyle {
    strokeStyle: string;
    fillStyle: string;
    lineWidth: number;
    lineDash: number[];
    font: string;
    lineCap: 'butt' | 'round' | 'square';
    lineJoin: 'miter' | 'round' | 'bevel';
}

const DEFAULT_STYLE: SvgStyle = {
    strokeStyle: 'black',
    fillStyle: 'black',
    lineWidth: 1,
    lineDash: [],
    font: '12px Arial',
    lineCap: 'butt',
    lineJoin: 'miter',
};

function escapeXml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

// 规范化颜色：处理 SVG 支持度较差的写法
function normalizeColor(color: string): string {
    if (!color) return 'black';
    const value = color.trim();
    if (value === 'transparent') return 'none';
    return value;
}

function formatNumber(value: number): string {
    if (!Number.isFinite(value)) return '0';
    // 限制小数位，避免 SVG 中出现大量 0.30000000000000004 之类的数值
    return String(Math.round(value * 1000) / 1000);
}

export class SvgRenderContext {
    private elements: string[] = [];
    private styleStack: SvgStyle[] = [];
    private style: SvgStyle = { ...DEFAULT_STYLE };
    private subpaths: string[][] = [];
    private currentPath: string[] | null = null;

    private width: number;
    private height: number;
    private bounds: SvgBounds | null = null;
    // 是否曾经绘制过 KaTeX 片段；用来在 toSVG 时决定是否需要附带 KaTeX CSS。
    private katexUsed = false;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    // 供外部读取 canvas.width / canvas.height
    public get canvas(): { width: number; height: number } {
        return { width: this.width, height: this.height };
    }

    // 修改画布尺寸（用于设置导出区域）
    public setSize(width: number, height: number): void {
        this.width = width;
        this.height = height;
    }

    // ---------- 样式属性 ----------

    public get strokeStyle(): string {
        return this.style.strokeStyle;
    }
    public set strokeStyle(value: string) {
        this.style.strokeStyle = value;
    }

    public get fillStyle(): string {
        return this.style.fillStyle;
    }
    public set fillStyle(value: string) {
        this.style.fillStyle = value;
    }

    public get lineWidth(): number {
        return this.style.lineWidth;
    }
    public set lineWidth(value: number) {
        this.style.lineWidth = value;
    }

    public get lineCap(): SvgStyle['lineCap'] {
        return this.style.lineCap;
    }
    public set lineCap(value: SvgStyle['lineCap']) {
        this.style.lineCap = value;
    }

    public get lineJoin(): SvgStyle['lineJoin'] {
        return this.style.lineJoin;
    }
    public set lineJoin(value: SvgStyle['lineJoin']) {
        this.style.lineJoin = value;
    }

    public get font(): string {
        return this.style.font;
    }
    public set font(value: string) {
        this.style.font = value;
    }

    // ---------- 状态栈 ----------

    public save(): void {
        this.styleStack.push({ ...this.style, lineDash: [...this.style.lineDash] });
    }

    public restore(): void {
        const previous = this.styleStack.pop();
        if (previous) {
            this.style = previous;
        }
    }

    public setLineDash(dash: number[]): void {
        this.style.lineDash = dash ? [...dash] : [];
    }

    public getLineDash(): number[] {
        return [...this.style.lineDash];
    }

    // ---------- 路径构建 ----------

    public beginPath(): void {
        this.subpaths = [];
        this.currentPath = null;
    }

    // 返回当前子路径，必要时自动创建
    private ensurePath(): string[] {
        if (!this.currentPath) {
            this.currentPath = [];
            this.subpaths.push(this.currentPath);
        }
        return this.currentPath;
    }

    public closePath(): void {
        if (this.currentPath && this.currentPath.length > 0) {
            this.currentPath.push('Z');
            // 闭合后结束当前子路径，后续 moveTo 会开启新的子路径
            this.currentPath = null;
        }
    }

    public moveTo(x: number, y: number): void {
        // 若已有子路径，moveTo 开启一条新的子路径
        this.currentPath = [`M ${formatNumber(x)} ${formatNumber(y)}`];
        this.subpaths.push(this.currentPath);
    }

    public lineTo(x: number, y: number): void {
        const path = this.ensurePath();
        if (path.length === 0) {
            path.push(`M ${formatNumber(x)} ${formatNumber(y)}`);
            return;
        }
        path.push(`L ${formatNumber(x)} ${formatNumber(y)}`);
    }

    public arc(x: number, y: number, radius: number, startAngle: number, endAngle: number, counterclockwise: boolean = false): void {
        this.appendArcAsBezier(x, y, radius, radius, 0, startAngle, endAngle, counterclockwise);
    }

    public ellipse(
        x: number,
        y: number,
        radiusX: number,
        radiusY: number,
        rotation: number,
        startAngle: number,
        endAngle: number,
        counterclockwise: boolean = false
    ): void {
        this.appendArcAsBezier(x, y, radiusX, radiusY, rotation, startAngle, endAngle, counterclockwise);
    }

    public rect(x: number, y: number, width: number, height: number): void {
        this.moveTo(x, y);
        this.lineTo(x + width, y);
        this.lineTo(x + width, y + height);
        this.lineTo(x, y + height);
        this.closePath();
    }

    // 用三次贝塞尔近似圆弧：Canvas 的 arc/ellipse 都可以这样转换
    private appendArcAsBezier(
        cx: number,
        cy: number,
        rx: number,
        ry: number,
        rotation: number,
        startAngle: number,
        endAngle: number,
        counterclockwise: boolean
    ): void {
        if (!Number.isFinite(rx) || !Number.isFinite(ry) || Math.abs(rx) < 1e-9 || Math.abs(ry) < 1e-9) {
            return;
        }

        const cosRot = Math.cos(rotation);
        const sinRot = Math.sin(rotation);

        // 参数方程 -> 画布坐标（注意：调用点已处理 y 轴方向，这里不再翻转）
        const pointAt = (t: number) => {
            const localX = rx * Math.cos(t);
            const localY = ry * Math.sin(t);
            return {
                x: cx + localX * cosRot - localY * sinRot,
                y: cy + localX * sinRot + localY * cosRot,
            };
        };

        let delta = endAngle - startAngle;
        const twoPi = Math.PI * 2;

        if (!counterclockwise) {
            while (delta < 0) delta += twoPi;
            while (delta > twoPi) delta -= twoPi;
        } else {
            while (delta > 0) delta -= twoPi;
            while (delta < -twoPi) delta += twoPi;
        }

        // 整圆需要拆成两段以上，否则贝塞尔端点重合会退化
        const segmentCount = Math.max(2, Math.ceil(Math.abs(delta) / (Math.PI / 2)));
        const step = delta / segmentCount;

        const start = pointAt(startAngle);

        const path = this.ensurePath();
        if (path.length === 0) {
            path.push(`M ${formatNumber(start.x)} ${formatNumber(start.y)}`);
        } else {
            path.push(`L ${formatNumber(start.x)} ${formatNumber(start.y)}`);
        }

        for (let i = 0; i < segmentCount; i++) {
            const t0 = startAngle + step * i;
            const t1 = startAngle + step * (i + 1);

            const p0 = pointAt(t0);
            const p1 = pointAt(t1);

            // 每段用 1/4 圆弧的标准控制点系数
            const alpha = Math.abs(step) * 0.5;
            const k = (4 / 3) * Math.tan(alpha / 2) * (step < 0 ? -1 : 1);

            const d0 = { x: -rx * Math.sin(t0), y: ry * Math.cos(t0) };
            const d1 = { x: -rx * Math.sin(t1), y: ry * Math.cos(t1) };

            const c0 = {
                x: p0.x + k * (d0.x * cosRot - d0.y * sinRot),
                y: p0.y + k * (d0.x * sinRot + d0.y * cosRot),
            };
            const c1 = {
                x: p1.x - k * (d1.x * cosRot - d1.y * sinRot),
                y: p1.y - k * (d1.x * sinRot + d1.y * cosRot),
            };

            path.push(
                `C ${formatNumber(c0.x)} ${formatNumber(c0.y)} ${formatNumber(c1.x)} ${formatNumber(c1.y)} ${formatNumber(p1.x)} ${formatNumber(p1.y)}`
            );
        }
    }

    private getPathData(): string {
        return this.subpaths.map(path => path.join(' ')).join(' ');
    }

    // ---------- 绘制 ----------

    public fill(): void {
        this.includePathBounds();
        // Canvas 的 fill() 不会清空当前路径；保留路径，便于后续 stroke()
        // 同时输出填充和边界线。
        const d = this.getPathData();
        if (!d) return;

        const attrs = [
            `d="${d}"`,
            `fill="${escapeXml(normalizeColor(this.style.fillStyle))}"`,
            `fill-rule="nonzero"`,
            'stroke="none"',
        ].join(' ');

        this.elements.push(`<path ${attrs} />`);
    }

    public stroke(): void {
        this.includePathBounds();
        // 与 Canvas 一致，stroke() 也不消费当前路径。
        const d = this.getPathData();
        if (!d) return;

        const dash = this.style.lineDash.length > 0 ? ` stroke-dasharray="${this.style.lineDash.map(formatNumber).join(',')}"` : '';

        const attrs = [
            `d="${d}"`,
            'fill="none"',
            `stroke="${escapeXml(normalizeColor(this.style.strokeStyle))}"`,
            `stroke-width="${formatNumber(this.style.lineWidth)}"`,
            `stroke-linecap="${this.style.lineCap}"`,
            `stroke-linejoin="${this.style.lineJoin}"`,
        ].join(' ') + dash;

        this.elements.push(`<path ${attrs} />`);
    }

    public fillRect(x: number, y: number, width: number, height: number): void {
        const attrs = [
            `x="${formatNumber(x)}"`,
            `y="${formatNumber(y)}"`,
            `width="${formatNumber(width)}"`,
            `height="${formatNumber(height)}"`,
            `fill="${escapeXml(normalizeColor(this.style.fillStyle))}"`,
        ].join(' ');

        // CLEAR 使用的整幅画布矩形只是背景，不应把内容边界撑回整张画布；
        // 标签背景等小矩形仍然会计入边界。
        const isCanvasBackground = x === 0 && y === 0 && width === this.width && height === this.height;
        if (!isCanvasBackground) {
            this.includeRect(x, y, width, height);
        }
        this.elements.push(`<rect ${attrs} />`);
    }

    public strokeRect(x: number, y: number, width: number, height: number): void {
        const dash = this.style.lineDash.length > 0 ? ` stroke-dasharray="${this.style.lineDash.map(formatNumber).join(',')}"` : '';

        const attrs = [
            `x="${formatNumber(x)}"`,
            `y="${formatNumber(y)}"`,
            `width="${formatNumber(width)}"`,
            `height="${formatNumber(height)}"`,
            'fill="none"',
            `stroke="${escapeXml(normalizeColor(this.style.strokeStyle))}"`,
            `stroke-width="${formatNumber(this.style.lineWidth)}"`,
        ].join(' ') + dash;

        this.includeRect(x, y, width, height, this.style.lineWidth / 2);
        this.elements.push(`<rect ${attrs} />`);
    }

    // ---------- 文本 ----------

    public measureText(text: string): { width: number } {
        return { width: this.estimateTextWidth(text) };
    }

    public fillText(text: string, x: number, y: number): void {
        const fontSize = this.getFontSize();
        const fontFamily = this.getFontFamily();

        const fontWeight = /\b(bold|bolder|lighter|[1-9]00)\b/.exec(this.style.font)?.[1] ?? 'normal';
        const fontStyle = /\b(italic|oblique)\b/.exec(this.style.font)?.[1] ?? 'normal';

        const attrs = [
            `x="${formatNumber(x)}"`,
            `y="${formatNumber(y)}"`,
            `fill="${escapeXml(normalizeColor(this.style.fillStyle))}"`,
            `font-size="${formatNumber(fontSize)}"`,
            `font-family="${escapeXml(fontFamily)}"`,
            fontStyle !== 'normal' ? `font-style="${fontStyle}"` : '',
            fontWeight !== 'normal' ? `font-weight="${fontWeight}"` : '',
        ].filter(Boolean).join(' ');

        this.includeRect(x, y - fontSize, this.estimateTextWidth(text), fontSize);
        this.elements.push(`<text ${attrs}>${escapeXml(text)}</text>`);
    }

    private getFontSize(): number {
        const match = /(\d+(?:\.\d+)?)px/.exec(this.style.font);
        return match ? parseFloat(match[1]) : 12;
    }

    // canvas font 形如 "normal normal 12px Arial" 或 "bold italic 14px sans-serif"
    private getFontFamily(): string {
        const withoutSize = this.style.font.replace(/\d+(?:\.\d+)?px/, '');
        const cleaned = withoutSize
            .replace(/\b(normal|italic|oblique|bold|bolder|lighter|[1-9]00)\b/g, '')
            .replace(/\s+/g, ' ')
            .trim();
        return cleaned || 'Arial';
    }

    // Canvas 的 measureText 需要真实字体度量，这里用经验系数近似，避免依赖浏览器
    private estimateTextWidth(text: string): number {
        const fontSize = this.getFontSize();
        let width = 0;
        for (const char of text) {
            const code = char.codePointAt(0) ?? 0;
            // 中日韩等宽字符按 1em 计，其余按 0.55em 计
            width += code > 0x2e80 ? fontSize : fontSize * 0.55;
        }
        return width;
    }

    // 绘制已渲染好的 KaTeX 片段（一个独立的 <svg><foreignObject>...</foreignObject></svg>）。
    // 通过 transform 平移到目标位置；外层 <svg> 提供自己的视口与尺寸。
    public drawKatex(fragment: string, x: number, y: number): void {
        this.katexUsed = true;
        const widthMatch = /<svg[^>]*\bwidth="([\d.]+)"/.exec(fragment);
        const heightMatch = /<svg[^>]*\bheight="([\d.]+)"/.exec(fragment);
        const w = widthMatch ? parseFloat(widthMatch[1]) : 0;
        const h = heightMatch ? parseFloat(heightMatch[1]) : 0;
        this.includeRect(x, y, w, h);
        this.elements.push(`<g transform="translate(${formatNumber(x)} ${formatNumber(y)})">${fragment}</g>`);
    }

    public hasKatex(): boolean {
        return this.katexUsed;
    }

    // ---------- 输出 ----------

    public getElements(): string[] {
        return [...this.elements];
    }

    public getBounds(): SvgBounds | null {
        return this.bounds ? { ...this.bounds } : null;
    }

    private includePoint(x: number, y: number, padding: number = 0): void {
        if (!Number.isFinite(x) || !Number.isFinite(y)) return;
        const minX = x - padding;
        const minY = y - padding;
        const maxX = x + padding;
        const maxY = y + padding;

        if (!this.bounds) {
            this.bounds = { minX, minY, maxX, maxY };
            return;
        }

        this.bounds.minX = Math.min(this.bounds.minX, minX);
        this.bounds.minY = Math.min(this.bounds.minY, minY);
        this.bounds.maxX = Math.max(this.bounds.maxX, maxX);
        this.bounds.maxY = Math.max(this.bounds.maxY, maxY);
    }

    private includeRect(x: number, y: number, width: number, height: number, padding: number = 0): void {
        this.includePoint(x, y, padding);
        this.includePoint(x + width, y + height, padding);
    }

    private includePathBounds(): void {
        const padding = Math.max(0, this.style.lineWidth / 2);
        for (const path of this.subpaths) {
            for (const token of path) {
                const values = token.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
                // M/L contain one point, C contains three points, Z contains none.
                for (let i = 0; i + 1 < values.length; i += 2) {
                    this.includePoint(values[i], values[i + 1], padding);
                }
            }
        }
        if (this.currentPath) {
            for (const token of this.currentPath) {
                const values = token.match(/[-+]?\d*\.?\d+(?:e[-+]?\d+)?/gi)?.map(Number) || [];
                for (let i = 0; i + 1 < values.length; i += 2) {
                    this.includePoint(values[i], values[i + 1], padding);
                }
            }
        }
    }

    public toSVG(options?: {
        background?: string;
        fitContent?: boolean;
        padding?: number;
        contentBounds?: SvgBounds | null;
        animation?: {
            frames: string[][];
            durationMs: number;
        };
    }): string {
        const background = options?.background;
        const fitContent = options?.fitContent !== false;
        const padding = Math.max(0, options?.padding ?? 12);
        const sourceBounds = options?.contentBounds || this.bounds;
        const cropBounds = fitContent && sourceBounds
            ? {
                minX: sourceBounds.minX - padding,
                minY: sourceBounds.minY - padding,
                maxX: sourceBounds.maxX + padding,
                maxY: sourceBounds.maxY + padding,
            }
            : { minX: 0, minY: 0, maxX: this.width, maxY: this.height };
        const outputWidth = Math.max(1, cropBounds.maxX - cropBounds.minX);
        const outputHeight = Math.max(1, cropBounds.maxY - cropBounds.minY);
        const width = formatNumber(outputWidth);
        const height = formatNumber(outputHeight);

        const normalizedBackground = background ? normalizeColor(background) : 'none';
        const backgroundRect = normalizedBackground !== 'none'
            ? `<rect x="${formatNumber(cropBounds.minX)}" y="${formatNumber(cropBounds.minY)}" width="${width}" height="${height}" fill="${escapeXml(normalizedBackground)}" />`
            : '';
        const animation = options?.animation;

        const katexStyle = this.katexUsed
            ? `<defs><style><![CDATA[${getEffectiveKatexCss()}]]></style></defs>`
            : '';

        if (!animation || animation.frames.length === 0) {
            return [
                `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="${formatNumber(cropBounds.minX)} ${formatNumber(cropBounds.minY)} ${width} ${height}">`,
                katexStyle,
                backgroundRect,
                ...this.elements,
                '</svg>',
            ].filter(Boolean).join('\n');
        }

        const frameCount = animation.frames.length;
        const durationMs = Math.max(1, animation.durationMs);
        const duration = formatNumber(durationMs / 1000);
        const framePercent = formatNumber(100 / frameCount);
        const frameDuration = durationMs / frameCount;
        const frameGroups = animation.frames.map((frame, index) => {
            // CSS 负延迟代表“动画已经运行了多久”。为了让第 index 帧在
            // index * frameDuration 时出现，需要从周期末尾倒推延迟。
            const delay = formatNumber(-((frameCount - index) * frameDuration) / 1000);
            // 非动画 SVG 查看器至少显示第一帧，不会把所有帧叠加在一起。
            const initialOpacity = index === 0 ? 1 : 0;
            const start = formatNumber(index / frameCount);
            const end = formatNumber((index + 1) / frameCount);
            const smilAnimation = index === 0
                ? `<animate attributeName="opacity" dur="${duration}s" repeatCount="indefinite" values="1;1;0" keyTimes="0;${end};1" calcMode="discrete" />`
                : `<animate attributeName="opacity" dur="${duration}s" repeatCount="indefinite" values="0;1;1;0" keyTimes="0;${start};${end};1" calcMode="discrete" />`;
            // CSS + SMIL 双实现：现代浏览器优先使用 CSS；支持 SMIL 的 SVG 查看器也能播放。
            // 不支持动画的查看器至少显示第一帧，不会把所有帧叠加在一起。
            const style = `opacity: ${initialOpacity}; animation: geometry-frame-cycle ${duration}s steps(1, end) infinite; animation-delay: ${delay}s;`;
            return `<g style="${style}">${smilAnimation}${frame.join('\n')}</g>`;
        });

        return [
            `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${width}" height="${height}" viewBox="${formatNumber(cropBounds.minX)} ${formatNumber(cropBounds.minY)} ${width} ${height}">`,
            katexStyle,
            '<style>',
            `@keyframes geometry-frame-cycle { 0%, ${framePercent}% { opacity: 1; } ${framePercent}%, 100% { opacity: 0; } }`,
            '</style>',
            backgroundRect,
            ...this.elements,
            ...frameGroups,
            '</svg>',
        ].filter(Boolean).join('\n');
    }
}
