// 定义一个基础的点坐标接口，方便重用
export interface IPoint {
    x: number;
    y: number;
}

// 可视区域，使用画布坐标（y 轴向下），与 draw() 最终写入 ctx 的坐标系一致
export interface VisibleRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface DrawOptions {
    color?: string; // 绘制颜色
    lineWidth?: number; // 线条宽度
    fillColor?: string; // 填充颜色
    dashed?: boolean; // 是否为虚线
    highlight?: boolean; // 是否为选中对象放大显示
    // 直线/射线绘制出来的长度（逻辑单位）。
    // 直线以定义点的中点为基准向两端各延伸一半，射线从顶点向前延伸。
    // 不指定（undefined）时，默认只延伸到可视区域的边缘，不再往外。
    length?: number;
    // 可视区域，直线/射线据此裁剪，避免导出 SVG 时被无限长的线撑大
    visibleRect?: VisibleRect;
}

export interface DrawLabelOptions {
    color?: string; // 标签颜色
    fontSize?: number; // 标签字体大小
    fontFamily?: string; // 标签字体
    fontStyle?: string; // 标签字体样式
    fontWeight?: string; // 标签字体粗细
    backgroundColor?: string; // 标签背景颜色
    padding?: number; // 标签内边距
    drawDirection?: 'down' | 'up' | 'left' | 'right'; // 标签绘制方向
    // 用户拖动后的标签锚点，使用逻辑坐标；未提供时使用对象默认位置。
    position?: IPoint;
}

// 逻辑坐标 -> 屏幕坐标。
// 与 draw() 中的换算保持一致：x 直接缩放平移，y 轴翻转（屏幕 y 向下为正）。
// 标签定位统一使用这个换算，避免不同对象返回不同坐标系。
export function toScreenPoint(
    x: number,
    y: number,
    transform: { scale: number; offsetX: number; offsetY: number }
): IPoint {
    return {
        x: x * transform.scale + transform.offsetX,
        y: transform.offsetY - y * transform.scale,
    };
}

// 当用户未显式指定线宽时，让线条保持恒定像素粗细（抵消 Canvas 外层缩放）。
// 显式指定时保持原值，由调用方按 highlight 等规则再乘系数。
export function resolveLineWidth(lineWidth: number | undefined, scale: number): number {
    if (lineWidth != null) return lineWidth;
    return 1 / Math.max(Math.abs(scale), 1e-6);
}

// 当用户未显式指定点半径时，让点保持恒定像素大小（默认 4px）。
export function resolvePointRadius(explicitRadius: boolean, radius: number, scale: number): number {
    if (explicitRadius) return radius * scale;
    return 4; // 固定 4 像素
}

// 所有几何对象的基类
export abstract class GeometricObject {
    public readonly name: string;
    public readonly type: string;

    constructor(name: string, type: string) {
        this.name = name;
        this.type = type;
    }

    abstract getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint;

    // 绘制几何对象标签
    public drawLabel(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, label: string, options: DrawLabelOptions): void {
        ctx.save();
        ctx.font = `${options?.fontStyle || 'normal'} ${options?.fontWeight || 'normal'} ${options?.fontSize || 12}px ${options?.fontFamily || 'Arial'}`;
        ctx.fillStyle = options?.color || 'black';

        // 计算文本宽度和高度
        const textMetrics = ctx.measureText(label);
        const textWidth = textMetrics.width;
        // 从 "normal normal 12px Arial" 这样的 font 串中解析字号，
        // 兼容 parseInt 取不到值（NaN）的情况
        const parsedFontHeight = parseInt(ctx.font, 10);
        const textHeight = Number.isFinite(parsedFontHeight) && parsedFontHeight > 0
            ? parsedFontHeight
            : (options?.fontSize || 12);

        // 取得绘制标签位置。用户拖动后的逻辑坐标优先于对象默认位置。
        const labelPosition = options.position
            ? toScreenPoint(options.position.x, options.position.y, transform)
            : this.getDrawLabelPosition(transform, options, textWidth, textHeight);

        // 设置标签背景（transparent / none 表示不需要背景）
        const backgroundColor = options?.backgroundColor;
        if (backgroundColor && backgroundColor !== 'transparent' && backgroundColor !== 'none') {
            const padding = options.padding || 0;
            const bgWidth = textWidth + padding * 2;
            const bgHeight = textHeight + padding * 2;

            ctx.fillStyle = backgroundColor;
            ctx.fillRect(
                labelPosition.x - padding,
                labelPosition.y - textHeight - padding,
                bgWidth,
                bgHeight
            );
            ctx.fillStyle = options.color || 'black'; // 恢复文本颜色
        }

        // 绘制文本
        ctx.fillText(label, labelPosition.x, labelPosition.y);

        ctx.restore();
    }

    // 绘制该几何对象
    public abstract draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void;

    public static isZero(data: number): boolean {
        return Math.abs(data) <= 1e-9;
    }
}
