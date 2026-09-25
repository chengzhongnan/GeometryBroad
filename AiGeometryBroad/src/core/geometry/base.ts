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
    // 「没写 radius= 的点」用的默认半径（屏幕像素）。解释器从 SET item=pointRadius 注入，
    // 不传就退回 DEFAULT_POINT_RADIUS_PIXELS。命中检测必须用同一个值，否则点的大小和
    // 可点区域会对不上。
    defaultPointRadiusPixels?: number;
}

// 绘制变换。
// scale/offsetX/offsetY 负责把逻辑坐标换算成「输出坐标」（画布像素 / SVG 用户单位）。
// pixelScale 是「输出坐标 -> 最终屏幕像素」的倍率，**只**用来把默认线宽、默认点半径
// 折算成恒定像素大小：画布路径取外层 ctx.setTransform 的缩放，SVG 导出为 1。
// 注意它和 scale 是两回事 —— scale 里含 VIEW scale，pixelScale 不含。
export interface DrawTransform {
    scale: number;
    offsetX: number;
    offsetY: number;
    pixelScale?: number;
    // 绕 pivot 的旋转角（弧度）。缺省 / 0 表示不旋转，此时换算与老实现逐字节一致。
    //
    // 只有**没有外层矩阵**的渲染路径需要它：Canvas 的旋转由 ctx.setTransform 提供，
    // SVG 导出没有外层矩阵，旋转必须烘进坐标里，所以走这里的字段。
    rotation?: number;
    // 旋转轴心（输出坐标）。只有 rotation 非 0 时才有意义。
    pivot?: IPoint;
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
    // 点标签定位要用到点的显示半径，口径必须和绘制一致（见 DrawOptions.defaultPointRadiusPixels）。
    defaultPointRadiusPixels?: number;
}

// 逻辑坐标 -> 屏幕坐标。
// 与 draw() 中的换算保持一致：x 直接缩放平移，y 轴翻转（屏幕 y 向下为正）。
// 标签定位统一使用这个换算，避免不同对象返回不同坐标系。
export function toScreenPoint(
    x: number,
    y: number,
    transform: DrawTransform
): IPoint {
    const screenX = x * transform.scale + transform.offsetX;
    const screenY = transform.offsetY - y * transform.scale;
    const rotation = transform.rotation ?? 0;
    if (!rotation) return { x: screenX, y: screenY };
    const pivot = transform.pivot ?? { x: 0, y: 0 };
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const dx = screenX - pivot.x;
    const dy = screenY - pivot.y;
    return {
        x: pivot.x + dx * cos - dy * sin,
        y: pivot.y + dx * sin + dy * cos,
    };
}

// toScreenPoint 的逆运算。旋转角为 0 时与老的「除法 + y 轴翻转」完全一致。
//
// 旋转必须在缩放平移**之前**反算（顺序与正向相反），否则轴心会跟着被缩放，
// 反出来的点会整体偏出去。
export function fromScreenPoint(
    screenX: number,
    screenY: number,
    transform: DrawTransform
): IPoint {
    let unrotatedX = screenX;
    let unrotatedY = screenY;
    const rotation = transform.rotation ?? 0;
    if (rotation) {
        const pivot = transform.pivot ?? { x: 0, y: 0 };
        const cos = Math.cos(-rotation);
        const sin = Math.sin(-rotation);
        const dx = screenX - pivot.x;
        const dy = screenY - pivot.y;
        unrotatedX = pivot.x + dx * cos - dy * sin;
        unrotatedY = pivot.y + dx * sin + dy * cos;
    }
    return {
        x: (unrotatedX - transform.offsetX) / transform.scale,
        y: (transform.offsetY - unrotatedY) / transform.scale,
    };
}

// 未显式指定线宽时的默认粗细（屏幕像素）。
export const DEFAULT_LINE_WIDTH_PIXELS = 1;
// 未显式指定半径时的默认点半径（屏幕像素）。
export const DEFAULT_POINT_RADIUS_PIXELS = 4;

// 当用户未显式指定线宽时，让线条保持恒定像素粗细。
//
// 关键是除对「倍率」：pixelScale 表示绘制坐标 -> 最终屏幕像素的倍率，
// 画布路径取外层矩阵的缩放（ctx.setTransform），SVG 导出为 1。
// 历史实现除的是 VIEW scale，而 VIEW scale 已经烘进坐标里了，等于多除一次：
//   scale=110 时默认线宽变成 1/110 ≈ 0.009px，线段画了却完全看不见。
// 显式指定时保持原值，由调用方按 highlight 等规则再乘系数。
export function resolveLineWidth(lineWidth: number | undefined, transform: { pixelScale?: number }): number {
    if (lineWidth != null) return lineWidth;
    return DEFAULT_LINE_WIDTH_PIXELS / Math.max(Math.abs(transform.pixelScale ?? 1), 1e-6);
}

// 点半径是**屏幕像素**值，与 VIEW scale 无关，也不随画布缩放变化。
//
// 历史实现会乘 VIEW scale，于是 scale=110 时半径 110px（直径 220px）；
// 而解释器自己算出来的点（中点、垂足、交点…）走的是不传 radius 的分支、恒定 4px，
// 同一张图上两类点大小相差几十倍。现在两者统一为像素值：
// 显式写 radius=<n> 就是 n 像素，不写就是 4 像素。
// 和 resolveLineWidth 一样要除掉 pixelScale，这样画布缩放时点大小保持不变
// （GeoGebra 一类几何软件的行为）。
export function resolvePointRadius(
    explicitRadius: boolean,
    radius: number,
    transform: { pixelScale?: number },
    defaultPixels: number = DEFAULT_POINT_RADIUS_PIXELS,
): number {
    const pixels = explicitRadius ? radius : defaultPixels;
    return pixels / Math.max(Math.abs(transform.pixelScale ?? 1), 1e-6);
}

// 所有几何对象的基类
export abstract class GeometricObject {
    public readonly name: string;
    public readonly type: string;

    constructor(name: string, type: string) {
        this.name = name;
        this.type = type;
    }

    abstract getDrawLabelPosition(transform: DrawTransform, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint;

    // 绘制几何对象标签
    public drawLabel(ctx: CanvasRenderingContext2D, transform: DrawTransform, label: string, options: DrawLabelOptions): void {
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
    public abstract draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void;

    public static isZero(data: number): boolean {
        return Math.abs(data) <= 1e-9;
    }
}
