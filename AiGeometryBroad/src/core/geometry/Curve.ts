import { GeometricObject, type DrawLabelOptions, type DrawOptions, type IPoint, toScreenPoint } from './base';
import { Point, PointNativeObject } from './Point';

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


    public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
        ctx.beginPath();
        
        // Apply drawing options
        ctx.strokeStyle = options?.color || 'black';
        ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
        if (options?.dashed) {
            ctx.setLineDash([5, 5]);
        } else {
            ctx.setLineDash([]);
        }

        // Calculate the starting point and move the drawing context
        const startPointX = this.xStart * transform.scale + transform.offsetX;
        const startPointY = this.lambda(this.xStart) * transform.scale - transform.offsetY;
        ctx.moveTo(startPointX, 0 - startPointY);

        // Iterate through the curve's x-range, drawing line segments to approximate the curve
        for (let x = this.xStart + this.stepSize; x <= this.xEnd; x += this.stepSize) {
            const y = this.lambda(x);
            const currentPointX = x * transform.scale + transform.offsetX;
            const currentPointY = y * transform.scale - transform.offsetY;
            ctx.lineTo(currentPointX, 0 - currentPointY);
        }

        ctx.stroke();
    }

    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        const start = new PointNativeObject(this.xStart, this.lambda(this.xStart));
        return toScreenPoint(start.x, start.y, transform);
    }
}