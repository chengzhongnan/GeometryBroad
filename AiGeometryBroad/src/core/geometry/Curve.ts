import { GeometricObject, type DrawTransform, type DrawLabelOptions, type DrawOptions, type IPoint, toScreenPoint, resolveLineWidth } from './base';
import { Point, PointNativeObject } from './Point';

// 一段折线在屏幕上的最大长度（像素）。采样步长是逻辑单位，乘以视图 scale 才是像素，
// 所以固定步长在小 scale 下看不出问题、放大后就会折线化；这里按像素兜住上限。
const MAX_SEGMENT_PIXELS = 1;
// 单条曲线的段数上限，避免「超大定义域 × 大 scale」生成过长 path。
const MAX_SEGMENTS = 20000;

export class Curve extends GeometricObject {
    private xStart: number;
    private xEnd: number;
    private lambda: (x: number) => number ;
    private stepSize: number = 0.5;
    constructor(name: string, xStart: number, xEnd: number, lambda: (x: number) => number, stepSize: number | null) {
        super(name, 'curve');

        this.xStart = xStart;
        this.xEnd = xEnd;
        this.lambda = lambda;

        if (stepSize != null) {
            this.stepSize = stepSize;
        }
    }

    public get rangeStart(): number {
        return this.xStart;
    }

    public get rangeEnd(): number {
        return this.xEnd;
    }

    public get sampleStep(): number {
        return this.stepSize;
    }

    public evaluate(x: number): number {
        return this.lambda(x);
    }

    // 实际绘制用的步长：以 stepSize 为「精度上界」，但不允许一段折线超过 MAX_SEGMENT_PIXELS。
    // 这样既保留调用方显式指定的更细步长，又保证放大视图时曲线依然平滑。
    private resolveDrawStep(scale: number): number {
        const absScale = Math.abs(scale);
        const byPixel = absScale > 1e-9 ? MAX_SEGMENT_PIXELS / absScale : this.stepSize;
        let step = Math.min(this.stepSize, byPixel);

        const span = Math.abs(this.xEnd - this.xStart);
        if (step > 0 && span / step > MAX_SEGMENTS) {
            step = span / MAX_SEGMENTS;
        }
        return step > 0 && Number.isFinite(step) ? step : this.stepSize;
    }

    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
        ctx.beginPath();
        
        // Apply drawing options
        ctx.strokeStyle = options?.color || 'black';
        ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform) * (options?.highlight ? 2 : 1);
        if (options?.dashed) {
            ctx.setLineDash([5, 5]);
        } else {
            ctx.setLineDash([]);
        }

        const step = this.resolveDrawStep(transform.scale);

        // Calculate the starting point and move the drawing context
        const startPointX = this.xStart * transform.scale + transform.offsetX;
        const startPointY = this.lambda(this.xStart) * transform.scale - transform.offsetY;
        ctx.moveTo(startPointX, 0 - startPointY);

        // Iterate through the curve's x-range, drawing line segments to approximate the curve.
        // 累加浮点误差可能让最后一个循环点落在 xEnd 的极近处（差 1e-16 量级），
        // 端点会在下面统一补，所以这里用相对 eps 把它排掉，避免产生零长度线段。
        const span = this.xEnd - this.xStart;
        const eps = Math.abs(span) * 1e-9;
        for (let x = this.xStart + step; x < this.xEnd - eps; x += step) {
            const y = this.lambda(x);
            const currentPointX = x * transform.scale + transform.offsetX;
            const currentPointY = y * transform.scale - transform.offsetY;
            ctx.lineTo(currentPointX, 0 - currentPointY);
        }

        // 步长通常除不尽定义域长度，必须补上端点，否则曲线画不到 xend 就停了。
        const endY = this.lambda(this.xEnd);
        ctx.lineTo(
            this.xEnd * transform.scale + transform.offsetX,
            0 - (endY * transform.scale - transform.offsetY),
        );

        ctx.stroke();
    }

    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        const start = new PointNativeObject(this.xStart, this.lambda(this.xStart));
        return toScreenPoint(start.x, start.y, transform);
    }
}