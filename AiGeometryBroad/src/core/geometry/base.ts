// 定义一个基础的点坐标接口，方便重用
export interface IPoint {
    x: number;
    y: number;
}

export interface DrawOptions {
    color?: string; // 绘制颜色
    lineWidth?: number; // 线条宽度
    fillColor?: string; // 填充颜色
    dashed?: boolean; // 是否为虚线
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
        const textHeight = parseInt(ctx.font, 10); // 字体大小

        // 设置标签背景
        if (options?.backgroundColor) {
            ctx.fillStyle = options.backgroundColor;
            ctx.fillRect(transform.offsetX, transform.offsetY - textHeight, textWidth + (options.padding || 0) * 2, textHeight + (options.padding || 0) * 2);
            ctx.fillStyle = options.color || 'black'; // 恢复文本颜色
        }

        // 取得绘制标签位置，不同的几何对象可能有不同的标签位置
        const labelPosition = this.getDrawLabelPosition(transform, options, textWidth, textHeight);

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
