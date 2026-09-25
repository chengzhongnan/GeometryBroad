import { GeometricObject, type DrawTransform, type DrawLabelOptions, type DrawOptions, type IPoint, toScreenPoint, resolveLineWidth } from './base';
import { Point } from './Point';
import { Circle } from './Circle';
import { Curve } from './Curve';
import { LinearObject, Segment } from './LinearObject';

export class Polygon extends GeometricObject {
    public vertices: Point[];

    constructor(name: string, vertices: Point[], type: string = 'polygon') {
        if (vertices.length < 3) {
            throw new Error("A polygon must have at least 3 vertices.");
        }
        super(name, type);
        this.vertices = vertices;
    }

    // 获取多边形的边（作为线段对象）
    get edges(): Segment[] {
        const edges: Segment[] = [];
        for (let i = 0; i < this.vertices.length; i++) {
            const p1 = this.vertices[i];
            const p2 = this.vertices[(i + 1) % this.vertices.length];
            // 边的名称可以动态生成，或不关心名称
            edges.push(new Segment(`edge_${p1.name}_${p2.name}`, p1, p2));
        }
        return edges;
    }

    // 计算面积 (使用鞋带公式)
    get area(): number {
        let area = 0;
        for (let i = 0; i < this.vertices.length; i++) {
            const p1 = this.vertices[i];
            const p2 = this.vertices[(i + 1) % this.vertices.length];
            area += p1.x * p2.y - p2.x * p1.y;
        }
        return Math.abs(area / 2.0);
    }

    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
        ctx.beginPath();
        if (this.vertices.length > 0) {
            const firstPoint = this.vertices[0].transform(transform.scale, transform.offsetX, transform.offsetY);
            ctx.moveTo(firstPoint.x, 0 - firstPoint.y); // 注意y轴方向反转

            for (let i = 1; i < this.vertices.length; i++) {
                const point = this.vertices[i].transform(transform.scale, transform.offsetX, transform.offsetY);
                ctx.lineTo(point.x, 0 - point.y); // 注意y轴方向反转
            }
            ctx.closePath(); // 连接最后一个点到第一个点

            if (options?.fillColor) {
                ctx.fillStyle = options.fillColor;
                ctx.fill();
            }

            ctx.strokeStyle = options?.color || 'black';
            ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform) * (options?.highlight ? 2 : 1);
            if (options?.dashed) {
                ctx.setLineDash([5, 5]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }
    }

    getDrawLabelPosition(transform: DrawTransform, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        // 标签放在多边形的几何中心（顶点平均值）附近
        const centerX = this.vertices.reduce((sum, v) => sum + v.x, 0) / this.vertices.length;
        const centerY = this.vertices.reduce((sum, v) => sum + v.y, 0) / this.vertices.length;
        return toScreenPoint(centerX, centerY, transform);
    }
}

// 有序点边界围成的可填充区域。
// Region 复用 Polygon 的路径绘制，因此 Canvas 与 SVG 使用完全相同的边界和填充规则。
export class Region extends Polygon {
    constructor(name: string, vertices: Point[]) {
        super(name, vertices, 'region');
    }
}

export type CircularRegionSide = 'left' | 'right';

// 由一条圆弧和对应弦线围成的精确圆弓形区域。
// arcStartAngle / arcEndAngle 使用 Canvas 坐标系角度，直接兼容 Canvas 和 SVG 上下文。
export class CircularRegion extends GeometricObject {
    public readonly circle: Circle;
    public readonly line: LinearObject;
    public readonly startPoint: IPoint;
    public readonly endPoint: IPoint;
    public readonly arcStartAngle: number;
    public readonly arcEndAngle: number;
    public readonly counterclockwise: boolean;
    public readonly side: CircularRegionSide;

    constructor(
        name: string,
        circle: Circle,
        line: LinearObject,
        startPoint: IPoint,
        endPoint: IPoint,
        arcStartAngle: number,
        arcEndAngle: number,
        counterclockwise: boolean,
        side: CircularRegionSide,
    ) {
        super(name, 'circular-region');
        this.circle = circle;
        this.line = line;
        this.startPoint = startPoint;
        this.endPoint = endPoint;
        this.arcStartAngle = arcStartAngle;
        this.arcEndAngle = arcEndAngle;
        this.counterclockwise = counterclockwise;
        this.side = side;
    }

    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
        const center = toScreenPoint(this.circle.center.x, this.circle.center.y, transform);
        const start = toScreenPoint(this.startPoint.x, this.startPoint.y, transform);
        const end = toScreenPoint(this.endPoint.x, this.endPoint.y, transform);
        const radius = Math.abs(this.circle.radius * transform.scale);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(start.x, start.y);
        ctx.lineTo(end.x, end.y);
        ctx.arc(center.x, center.y, radius, this.arcStartAngle, this.arcEndAngle, this.counterclockwise);
        ctx.closePath();

        if (options?.fillColor) {
            ctx.fillStyle = options.fillColor;
            ctx.fill();
        }

        ctx.strokeStyle = options?.color || 'black';
        ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform) * (options?.highlight ? 2 : 1);
        ctx.setLineDash(options?.dashed ? [5, 5] : []);
        ctx.stroke();
        ctx.restore();
    }

    getDrawLabelPosition(transform: DrawTransform, _options: DrawLabelOptions, _textWidth: number, _textHeight: number): IPoint {
        return toScreenPoint(this.circle.center.x, this.circle.center.y, transform);
    }
}

export type CurveCircleRegionSide = 'above' | 'below';

// 由一段 y=f(x) 曲线和圆弧围成的可填充区域。
// 曲线本身沿 x 方向采样，圆弧使用 Canvas/SVG 的 arc() 绘制。
export class CurveCircleRegion extends GeometricObject {
    public readonly curve: Curve;
    public readonly circle: Circle;
    public readonly curvePoints: IPoint[];
    public readonly arcStartAngle: number;
    public readonly arcEndAngle: number;
    public readonly counterclockwise: boolean;
    public readonly side: CurveCircleRegionSide;

    constructor(
        name: string,
        curve: Curve,
        circle: Circle,
        curvePoints: IPoint[],
        arcStartAngle: number,
        arcEndAngle: number,
        counterclockwise: boolean,
        side: CurveCircleRegionSide,
    ) {
        super(name, 'curve-circle-region');
        this.curve = curve;
        this.circle = circle;
        this.curvePoints = curvePoints;
        this.arcStartAngle = arcStartAngle;
        this.arcEndAngle = arcEndAngle;
        this.counterclockwise = counterclockwise;
        this.side = side;
    }

    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
        if (this.curvePoints.length < 2) return;

        const center = toScreenPoint(this.circle.center.x, this.circle.center.y, transform);
        const radius = Math.abs(this.circle.radius * transform.scale);
        const first = toScreenPoint(this.curvePoints[0].x, this.curvePoints[0].y, transform);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < this.curvePoints.length; i++) {
            const point = toScreenPoint(this.curvePoints[i].x, this.curvePoints[i].y, transform);
            ctx.lineTo(point.x, point.y);
        }
        ctx.arc(center.x, center.y, radius, this.arcStartAngle, this.arcEndAngle, this.counterclockwise);
        ctx.closePath();

        if (options?.fillColor) {
            ctx.fillStyle = options.fillColor;
            ctx.fill();
        }

        ctx.strokeStyle = options?.color || 'black';
        ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform) * (options?.highlight ? 2 : 1);
        ctx.setLineDash(options?.dashed ? [5, 5] : []);
        ctx.stroke();
        ctx.restore();
    }

    getDrawLabelPosition(transform: DrawTransform, _options: DrawLabelOptions, _textWidth: number, _textHeight: number): IPoint {
        const middle = this.curvePoints[Math.floor(this.curvePoints.length / 2)];
        return toScreenPoint(middle.x, middle.y, transform);
    }
}

// 三角形类
export class Triangle extends Polygon {
    constructor(name: string, p1: Point, p2: Point, p3: Point) {
        super(name, [p1, p2, p3], 'triangle');
    }

    get p1(): Point { return this.vertices[0]; }
    get p2(): Point { return this.vertices[1]; }
    get p3(): Point { return this.vertices[2]; }
}

// 矩形类
export class Rectangle extends Polygon {
    // 静态工厂方法，对应 DSL 的 RECTANGLE 指令
    public static fromThreePoints(name: string, p1: Point, p2: Point, p3: Point): Rectangle {
        // 假设 p1-p2 和 p2-p3 是相邻边
        // 向量 p2->p1
        const v21 = { x: p1.x - p2.x, y: p1.y - p2.y };
        // 向量 p2->p3
        const v23 = { x: p3.x - p2.x, y: p3.y - p2.y };

        // 检查是否垂直（点积为0）
        const dotProduct = v21.x * v23.x + v21.y * v23.y;
        if (Math.abs(dotProduct) > 1e-6) { // 容忍浮点误差
            // 如果不垂直，可以根据p1, p2, p3来构建平行四边形
            console.warn(`The three points for RECTANGLE ${name} do not form a right angle. A parallelogram will be formed instead.`);
        }

        // p4 = p1 + (p3 - p2)
        const p4_x = p1.x + v23.x;
        const p4_y = p1.y + v23.y;
        const p4 = new Point(`${name}_p4`, p4_x, p4_y); // 自动生成的点

        return new Rectangle(name, [p1, p2, p3, p4]);
    }

    public static fromWidthHeight(name: string, p1: Point, width: number, height: number): Rectangle {
        // p2 = p1 + width
        const p2 = new Point(`${name}_p2`, p1.x + width, p1.y);
        // p3 = p2 + height
        const p3 = new Point(`${name}_p3`, p2.x, p2.y - height);
        // p4 = p1 + height
        const p4 = new Point(`${name}_p4`, p1.x, p1.y - height);

        return new Rectangle(name, [p1, p2, p3, p4]);
    }

    private constructor(name: string, vertices: Point[]) {
        super(name, vertices, 'rectangle');
    }
}
