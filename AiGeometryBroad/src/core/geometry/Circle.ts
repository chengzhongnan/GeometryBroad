import { GeometricObject, type DrawTransform, type DrawLabelOptions, type DrawOptions, type IPoint, toScreenPoint, resolveLineWidth } from './base';
import { Point, PointNativeObject } from './Point';
import { LinearObject, Segment } from './LinearObject';

export class Circle extends GeometricObject {
    public center: Point;
    private _radius: number;

    // 主构造函数，接受圆心和半径
    private constructor(name: string, center: Point, radius: number) {
        super(name, 'circle');
        this.center = center;
        this._radius = radius;
    }

    // 静态工厂方法，对应DSL的 CIRCLE 命令
    public static fromRadius(name: string, center: Point, radius: number): Circle {
        if (radius <= 0) {
            throw new Error("Circle radius must be positive.");
        }
        return new Circle(name, center, radius);
    }

    // 静态工厂方法，对应DSL的 CIRCLE_BY_POINT 命令
    public static fromPointOnEdge(name: string, center: Point, pointOnEdge: Point): Circle {
        const radius = center.distanceTo(pointOnEdge);
        return new Circle(name, center, radius);
    }

    private static distanceTo(p1: Point, p2: PointNativeObject): number {
        return Math.sqrt((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y));
    }

    // 静态工厂方法，使用一条弦和圆心创建圆
    public static fromChord(name: string, center: Point, chordStart: Point, chordEnd: Point): Circle {
        const midPoint = new PointNativeObject(
            (chordStart.x + chordEnd.x) / 2,
            (chordStart.y + chordEnd.y) / 2
        );

        // 中点到圆心距离
        const distance = Circle.distanceTo(center, midPoint);
        // 半弦长
        const halfChordLength = chordStart.distanceTo(chordEnd) / 2;
        // 半径
        const radius = Math.sqrt(distance * distance + halfChordLength * halfChordLength);

        return new Circle(name, center, radius);
    }

    // 静态工厂方法，使用一条弦和弦对应的圆心角创建圆，这个可以做出两个圆，如果角度为pi，那么c2和c1是同一个圆
    // public static fromChordAndAngle(name_1: string, name_2: string, chord: Segment, angle: number): { c1: Circle, c2: Circle } {
    //     const midPoint = new PointNativeObject(
    //         (chord.p1.x + chord.p2.x) / 2,
    //         (chord.p1.y + chord.p2.y) / 2
    //     );

    //     const halfAngle = angle / 2;

    //     if (GeometricObject.isZero(Math.cos(halfAngle))) {
    //         // 弦是直径
    //         const circleCenter = new Point(name_1 + '<_circle_center>', midPoint.x, midPoint.y);
    //         const circle = new Circle(name_1, circleCenter, chord.length / 2);

    //         return { c1: circle, c2: circle };
    //     }

    //     // 处理异常情况：圆心角为 0 或 2π 的倍数
    //     if (GeometricObject.isZero(Math.sin(halfAngle))) {
    //         throw new Error("Angle cannot be 0 or a multiple of 2π, as this would imply an infinite radius for a non-zero chord.");
    //     }

    //     // 2. 使用半角公式计算半径
    //     // 在由半径(斜边)、半弦长和圆心到弦的距离(h)构成的直角三角形中，
    //     // sin(halfAngle) = (chord.length / 2) / radius
    //     const halfChordLength = chord.length / 2;
    //     const radius = halfChordLength / Math.sin(halfAngle);

    //     // 3. 计算圆心到弦中点的距离 h
    //     // cos(halfAngle) = h / radius  =>  h = radius * cos(halfAngle)
    //     // 或者使用 tan: tan(halfAngle) = halfChordLength / h => h = halfChordLength / tan(halfAngle)
    //     const h = halfChordLength / Math.tan(halfAngle);

    //     // 4. 计算从弦的一个端点到另一个端点的向量
    //     const dx = chord.p2.x - chord.p1.x;
    //     const dy = chord.p2.y - chord.p1.y;

    //     // 5. 计算一个垂直于弦的向量。如果弦向量是 (dx, dy)，则垂直向量是 (-dy, dx)。
    //     // 这个垂直向量的长度恰好也等于弦长 `chord.length`。
    //     // 我们需要将其缩放，使其长度等于 h。
    //     // 缩放因子 = h / chord.length
    //     const scale = h / chord.length;
    //     const offsetX = -dy * scale;
    //     const offsetY = dx * scale;

    //     // 6. 计算两个可能的圆心
    //     // 从中点分别加上和减去这个偏移向量
    //     const center1 = new Point(
    //         name_1 + '_<circle_center>',
    //         midPoint.x + offsetX,
    //         midPoint.y + offsetY
    //     );
    //     const center2 = new Point(
    //         name_2 + '_<circle_center>',
    //         midPoint.x - offsetX,
    //         midPoint.y - offsetY
    //     );

    //     // 7. 创建两个圆并返回
    //     const c1 = new Circle(name_1, center1, radius);
    //     const c2 = new Circle(name_2, center2, radius);

    //     return { c1, c2 };
    // }

    /**
        * Creates a Circle instance representing the circumcircle of a triangle defined by three points.
        * The circumcircle passes through all three vertices of the triangle.
        * @param name The name of the new circle.
        * @param p1 The first vertex of the triangle.
        * @param p2 The second vertex of the triangle.
        * @param p3 The third vertex of the triangle.
        * @returns A new Circle object.
        * @throws An error if the three points are collinear.
        */
    public static fromCircumcircle(p1: Point, p2: Point, p3: Point): { pt: PointNativeObject, radius: number } {
        // Using a formula based on coordinates to find the circumcenter (cx, cy)
        // The denominator D is twice the signed area of the triangle. If D is 0, the points are collinear.
        const D = 2 * (p1.x * (p2.y - p3.y) + p2.x * (p3.y - p1.y) + p3.x * (p1.y - p2.y));

        if (Math.abs(D) < 1e-9) { // Use a small epsilon for floating-point comparison
            throw new Error("Cannot create a circumcircle for collinear points.");
        }

        const p1_sq = p1.x * p1.x + p1.y * p1.y;
        const p2_sq = p2.x * p2.x + p2.y * p2.y;
        const p3_sq = p3.x * p3.x + p3.y * p3.y;

        const centerX = (p1_sq * (p2.y - p3.y) + p2_sq * (p3.y - p1.y) + p3_sq * (p1.y - p2.y)) / D;
        const centerY = (p1_sq * (p3.x - p2.x) + p2_sq * (p1.x - p3.x) + p3_sq * (p2.x - p1.x)) / D;

        const center = new PointNativeObject(centerX, centerY);

        // The radius is the distance from the center to any of the vertices.
        const radius = Math.sqrt((centerX - p1.x) ** 2 + (centerY - p1.y) ** 2);

        return { pt: center, radius: radius };
    }

    /**
        * Creates a Circle instance representing the incircle of a triangle defined by three points.
        * The incircle is tangent to all three sides of the triangle.
        * @param name The name of the new circle.
        * @param p1 The first vertex of the triangle.
        * @param p2 The second vertex of the triangle.
        * @param p3 The third vertex of the triangle.
        * @returns A new Circle object.
        * @throws An error if the three points are collinear.
        */
    public static fromIncircle(p1: Point, p2: Point, p3: Point): { pt: PointNativeObject, radius: number } {
        // Calculate the lengths of the triangle's sides
        const a = p2.distanceTo(p3); // Length of the side opposite p1
        const b = p1.distanceTo(p3); // Length of the side opposite p2
        const c = p1.distanceTo(p2); // Length of the side opposite p3

        const perimeter = a + b + c;

        // Check for collinearity: if the sum of two sides equals the third, they form a line.
        if (Math.abs(perimeter - 2 * Math.max(a, b, c)) < 1e-9) {
            throw new Error("Cannot create an incircle for collinear points.");
        }

        // The incenter's coordinates are a weighted average of the vertices' coordinates.
        const centerX = (a * p1.x + b * p2.x + c * p3.x) / perimeter;
        const centerY = (a * p1.y + b * p2.y + c * p3.y) / perimeter;

        // The radius is calculated by the formula: r = Area / s
        // where s is the semi-perimeter (perimeter / 2).
        const s = perimeter / 2;
        const area = Math.sqrt(s * (s - a) * (s - b) * (s - c)); // Heron's formula for area
        const radius = area / s;

        return { pt: new PointNativeObject(centerX, centerY), radius: radius };
    }

    /**
     * Generates a random point on the edge of the circle.
     * @return {PointNativeObject} A point on the edge of the circle.
     * */
    public randomPointOnEdge(startAngel?: number, endAngle?: number): PointNativeObject {
        if (this._radius <= 0) {
            throw new Error("Circle radius must be positive.");
        }

        // Generate a random angle in the range [0, 360)
        let angle = Math.random() * 360;

        // If startAngle and endAngle are provided, adjust the angle to be within that range
        if (startAngel !== undefined && endAngle !== undefined) {
            if (startAngel > endAngle) {
                throw new Error("startAngle must be less than or equal to endAngle.");
            }
            angle = startAngel + Math.random() * (endAngle - startAngel);
        }

        let realAngle = angle * (Math.PI / 180); // Convert degrees to radians

        const x = this.center.x + this._radius * Math.cos(realAngle);
        const y = this.center.y + this._radius * Math.sin(realAngle);

        return new PointNativeObject(x, y);
    }

    /**
     * [私有辅助函数] 计算两个圆的交点。
     * @param c1 第一个圆对象
     * @param c2 第二个圆对象
     * @returns 返回一个包含交点 Point 对象的数组。
     */
    private _findCircleCircleIntersection(c1: Circle, c2: Circle): Point[] {
        const p1 = c1.center;
        const r1 = c1.radius;
        const p2 = c2.center;
        const r2 = c2.radius;

        const d = p1.distanceTo(p2);

        // 情况1：两圆分离或一个完全包含另一个，没有交点
        if (d > r1 + r2 || d < Math.abs(r1 - r2)) {
            return [];
        }

        // 情况2：两圆重合，有无限交点，在作图中无意义
        if (d === 0 && r1 === r2) {
            return [];
        }

        // 利用余弦定理和几何关系求解
        // a 是从 p1 到两个交点公共弦中点的距离
        const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);

        // h 是公共弦长度的一半
        const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));

        // 计算公共弦的中点 P_mid
        const p_mid_x = p1.x + a * (p2.x - p1.x) / d;
        const p_mid_y = p1.y + a * (p2.y - p1.y) / d;

        // 计算两个交点坐标
        const i1_x = p_mid_x + h * (p2.y - p1.y) / d;
        const i1_y = p_mid_y - h * (p2.x - p1.x) / d;
        const i1 = new Point('', i1_x, i1_y);

        // 如果两圆相切，h会约等于0，两个交点会重合
        if (h < 1e-9) {
            return [i1];
        }

        const i2_x = p_mid_x - h * (p2.y - p1.y) / d;
        const i2_y = p_mid_y + h * (p2.x - p1.x) / d;
        const i2 = new Point('', i2_x, i2_y);

        return [i1, i2];
    }

    /**
     * 计算圆外一个点到圆上某个点距离等于指定距离的点。
     * @param p 圆外的一个点
     * @param distance 距离
     */
    public getPointAtDistanceFromTarget(p: Point, distance: number): PointNativeObject[] {
        // 构造一个以 p 为圆心, distance 为半径的辅助圆。
        // 因为我们是在 Circle 类的方法内部，所以可以调用私有构造函数。
        const helperCircle = new Circle('helper_circle', p, distance);

        // 调用两圆求交点的内部方法
        const intersectionPoints = this._findCircleCircleIntersection(this, helperCircle);

        // 将结果从 Point[] 转换为 PointNativeObject[]
        return intersectionPoints.map(point => new PointNativeObject(point.x, point.y));
    }

    /**
     * 计算圆与直线的交点。
     * @param line 直线对象
     */
    public getIntersectionWithLine(line: LinearObject): PointNativeObject[] {
        const p1 = line.p1;
        const p2 = line.p2;
        const center = this.center;
        const r = this.radius;

        // 计算直线的方向向量
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;

        // 构造关于参数 t 的一元二次方程 At^2 + Bt + C = 0

        // A = dx^2 + dy^2
        const A = dx * dx + dy * dy;

        // B = 2 * (dx * (x1 - cx) + dy * (y1 - cy))
        const B = 2 * (dx * (p1.x - center.x) + dy * (p1.y - center.y));

        // C = (x1 - cx)^2 + (y1 - cy)^2 - r^2
        const C = (p1.x - center.x) ** 2 + (p1.y - center.y) ** 2 - r * r;

        // 如果 A 约等于 0，说明 p1 和 p2 是同一个点，无法定义直线
        if (Math.abs(A) < 1e-9) {
            return [];
        }

        // 计算判别式
        const delta = B * B - 4 * A * C;

        const intersectionPoints: PointNativeObject[] = [];

        if (delta < -1e-9) {
            // Δ < 0，没有实数解，不相交
            return [];
        } else if (Math.abs(delta) < 1e-9) {
            // Δ = 0，一个实数解，相切
            const t = -B / (2 * A);

            // 将 t 代入直线参数方程求交点坐标
            const intersectX = p1.x + t * dx;
            const intersectY = p1.y + t * dy;
            intersectionPoints.push(new PointNativeObject(intersectX, intersectY));
        } else {
            // Δ > 0，两个实数解，相交
            const sqrtDelta = Math.sqrt(delta);

            const t1 = (-B + sqrtDelta) / (2 * A);
            const intersectX1 = p1.x + t1 * dx;
            const intersectY1 = p1.y + t1 * dy;
            intersectionPoints.push(new PointNativeObject(intersectX1, intersectY1));

            const t2 = (-B - sqrtDelta) / (2 * A);
            const intersectX2 = p1.x + t2 * dx;
            const intersectY2 = p1.y + t2 * dy;
            intersectionPoints.push(new PointNativeObject(intersectX2, intersectY2));
        }

        return intersectionPoints;
    }

    public get radius(): number {
        return this._radius;
    }

    public get r(): number {
        return this._radius;
    }

    public get c(): Point {
        return this.center;
    }

    public get diameter(): number {
        return this._radius * 2;
    }

    public get area(): number {
        return Math.PI * this._radius * this._radius;
    }

    public get circumference(): number {
        return 2 * Math.PI * this._radius;
    }

    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        // 获取标签的实际尺寸（考虑padding）
        const padding = options.padding || 0;
        const actualTextWidth = textWidth + padding * 2;
        const actualTextHeight = textHeight + padding * 2;

        // 计算标签相对于圆心的偏移距离
        // 标签应该位于圆的外侧，避免与圆重叠
        const offsetDistance = this._radius + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale + 10 / transform.scale;

        let labelX = this.center.x;
        let labelY = this.center.y;

        // 根据drawDirection确定标签位置
        if (options.drawDirection) {
            switch (options.drawDirection) {
                case 'down':
                    labelY += offsetDistance;
                    break;
                case 'up':
                    labelY -= offsetDistance;
                    break;
                case 'left':
                    labelX -= offsetDistance;
                    break;
                case 'right':
                    labelX += offsetDistance;
                    break;
            }
        } else {
            // 如果没有指定方向，默认放置在圆的右上方（45度角）
            // 这是一个常见的标签放置位置，既不会遮挡圆，也容易阅读
            const defaultAngle = -Math.PI / 4; // -45度，右上方
            labelX += Math.cos(defaultAngle) * offsetDistance;
            labelY += Math.sin(defaultAngle) * offsetDistance;
        }

        // 应用变换（逻辑坐标 -> 屏幕坐标）
        return toScreenPoint(labelX, labelY, transform);
    }

    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
        ctx.save();
        ctx.beginPath();

        const transformedCenterX = this.center.x * transform.scale + transform.offsetX;
        const transformedCenterY = this.center.y * transform.scale - transform.offsetY;
        const transformedRadius = this._radius * transform.scale;

        ctx.arc(transformedCenterX, 0 - transformedCenterY, transformedRadius, 0, 2 * Math.PI);

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
        ctx.restore();
    }
}
