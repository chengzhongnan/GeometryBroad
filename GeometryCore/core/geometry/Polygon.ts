import { GeometricObject, type DrawLabelOptions, type DrawOptions, type IPoint } from './base';
import { Point } from './Point';
import { Segment } from './LinearObject';

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

    public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
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
            ctx.lineWidth = options?.lineWidth || 1;
            if (options?.dashed) {
                ctx.setLineDash([5, 5]);
            } else {
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }
    }

    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        throw new Error("Polygon does not support label drawing yet.");
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
