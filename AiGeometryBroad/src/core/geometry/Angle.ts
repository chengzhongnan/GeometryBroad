import { GeometricObject, type DrawTransform, type IPoint, type DrawOptions, type DrawLabelOptions, toScreenPoint, resolveLineWidth } from './base';
import { Point, PointNativeObject } from './Point';
import { Ray } from './LinearObject';

export class Angle extends GeometricObject {
    private _value: number; // Angle value in radians
    private _vertex: Point;
    private _point1: Point;
    private _point2: Point;
    private _line1?: Ray;
    private _line2?: Ray;
    private _showArc?: boolean;

    constructor(name: string, vertex: Point, point1: Point, point2: Point, showArc?: boolean) {
        super(name, 'Angle');

        this._vertex = vertex;
        this._point1 = point1;
        this._point2 = point2;
        this._value = this.calculateAngleFromPoints();

        if (showArc !== undefined) {
            this._showArc = showArc;
        } else {
            this._showArc = true; // Default to true if not specified
        }
    }

    private calculateAngleFromPoints(): number {
        if (!this._vertex || !this._point1 || !this._point2) {
            return 0;
        }

        const v1x = this._point1.x - this._vertex.x;
        const v1y = this._point1.y - this._vertex.y;
        const v2x = this._point2.x - this._vertex.x;
        const v2y = this._point2.y - this._vertex.y;

        const dotProduct = v1x * v2x + v1y * v2y;
        const magnitude1 = Math.sqrt(v1x * v1x + v1y * v1y);
        const magnitude2 = Math.sqrt(v2x * v2x + v2y * v2y);

        if (magnitude1 === 0 || magnitude2 === 0) {
            return 0;
        }

        let angle = Math.acos(dotProduct / (magnitude1 * magnitude2));

        // Determine the sign of the angle to get the correct direction
        const crossProduct = v1x * v2y - v1y * v2x;
        if (crossProduct < 0) {
            angle = -angle;
        }

        return angle;
    }

    public get value(): number {
        return this._value;
    }

    public get vertex(): Point {
        return this._vertex;
    }

    public get point1(): Point | undefined {
        return this._point1;
    }

    public get p1(): Point | undefined {
        return this._point1;
    }

    public get point2(): Point | undefined {
        return this._point2;
    }

    public get p2(): Point | undefined {
        return this._point2;
    }

    public get line1(): Ray | undefined {
        if (!this._line1) {
            this._line1 = new Ray(`${this.name}_line1`, this._vertex, this._point1);
        }
        return this._line1;
    }

    public get l1(): Ray | undefined {
        return this.line1;
    }

    public get line2(): Ray | undefined {
        if (!this._line2) {
            this._line2 = new Ray(`${this.name}_line2`, this._vertex, this._point2);
        }
        return this._line2;
    }

    public get l2(): Ray | undefined {
        return this.line2;
    }

    public get degreesValue(): number {
        return this._value * (180 / Math.PI);
    }

    public toRadians(): number {
        return this._value;
    }

    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
        if (!this._vertex || !this._point1 || !this._point2) {

            return;
        }

        const { scale, offsetX, offsetY } = transform;
        // 不在这里塞 lineWidth 默认值：塞了就分不清「用户没写」和「用户写了 1」，
        // 默认粗细交给 resolveLineWidth 按屏幕像素折算。
        const defaultOptions: DrawOptions = { color: 'black', fillColor: 'rgba(0,0,0,0)' };
        const drawOptions = { ...defaultOptions, ...options };

        ctx.save();
        ctx.beginPath();
        ctx.strokeStyle = drawOptions.color!;
        ctx.lineWidth = resolveLineWidth(drawOptions.lineWidth, transform);
        if (drawOptions.dashed) {
            ctx.setLineDash([5, 5]);
        }

        const vertex = this._vertex.transform(scale, offsetX, offsetY);
        const p1 = this._point1.transform(scale, offsetX, offsetY);
        const p2 = this._point2.transform(scale, offsetX, offsetY);

        if (this._showArc) {
            // Calculate initial and end angles for arc
            const startAngle = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
            const endAngle = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);

            // Draw the arc
            const radius = 10 * scale; // Fixed radius for the angle arc
            ctx.arc(vertex.x, 0 - vertex.y, radius, 0 - startAngle, 0 - endAngle);
            ctx.stroke();
        }

        // Draw the rays (optional, but good for visual representation)
        ctx.moveTo(vertex.x, 0 - vertex.y);
        ctx.lineTo(p1.x, 0 - p1.y);
        ctx.stroke();

        ctx.moveTo(vertex.x, 0 - vertex.y);
        ctx.lineTo(p2.x, 0 - p2.y);
        ctx.stroke();

        ctx.restore();
    }

    public static fromPoints(name: string, vertex: Point, point1: Point, point2: Point): Angle {
        return new Angle(name, vertex, point1, point2);
    }

    /**
     * Rotates the first arm of the angle (vertex -> point1) by a given angle.
     * @param theta The angle of rotation in degrees.
     * @param newPointName The name for the new Point object being created.
     * @returns {Point} A new Point object representing the rotated position of the original point1.
     */
    public getRotatedPoint1(theta: number): PointNativeObject {
        // 1. Translate point1 so the vertex is at the origin.
        const p1RelativeX = this._point1.x - this._vertex.x;
        const p1RelativeY = this._point1.y - this._vertex.y;

        // Pre-calculate sin and cos of the rotation angle.
        const realTheta = theta * (Math.PI / 180); // Convert degrees to radians if needed
        const cosTheta = Math.cos(realTheta);
        const sinTheta = Math.sin(realTheta);

        // 2. Apply the 2D rotation formula.
        const rotatedX = p1RelativeX * cosTheta - p1RelativeY * sinTheta;
        const rotatedY = p1RelativeX * sinTheta + p1RelativeY * cosTheta;

        // 3. Translate the new point back to the original coordinate system.
        const finalX = rotatedX + this._vertex.x;
        const finalY = rotatedY + this._vertex.y;

        return new PointNativeObject(finalX, finalY);
    }

    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        // 计算从顶点到两个点的向量
        const vector1 = {
            x: this._point1.x - this._vertex.x,
            y: this._point1.y - this._vertex.y
        };
        
        const vector2 = {
            x: this._point2.x - this._vertex.x,
            y: this._point2.y - this._vertex.y
        };
        
        // 计算两个向量的角度
        const angle1 = Math.atan2(vector1.y, vector1.x);
        const angle2 = Math.atan2(vector2.y, vector2.x);
        
        // 计算角度的平分线方向
        let bisectorAngle = (angle1 + angle2) / 2;
        
        // 处理角度跨越0度的情况
        const angleDiff = angle2 - angle1;
        if (Math.abs(angleDiff) > Math.PI) {
            if (angleDiff > 0) {
                bisectorAngle += Math.PI;
            } else {
                bisectorAngle -= Math.PI;
            }
        }
        
        // 确保角度在[-π, π]范围内
        while (bisectorAngle > Math.PI) bisectorAngle -= 2 * Math.PI;
        while (bisectorAngle < -Math.PI) bisectorAngle += 2 * Math.PI;
        
        // 计算标签与顶点的距离
        // 这个距离应该足够让标签不与角度弧线重叠
        const labelDistance = Math.max(
            30 / transform.scale,  // 最小距离
            Math.min(
                Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y),
                Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y)
            ) * 0.4  // 取较短边的40%作为距离
        );
        
        // 计算标签的基础位置（沿着角度平分线）
        let labelX = this._vertex.x + Math.cos(bisectorAngle) * labelDistance;
        let labelY = this._vertex.y + Math.sin(bisectorAngle) * labelDistance;
        
        // 获取标签的实际尺寸（考虑padding）
        const padding = options.padding || 0;
        const actualTextWidth = textWidth + padding * 2;
        const actualTextHeight = textHeight + padding * 2;
        
        // 根据drawDirection调整标签位置
        if (options.drawDirection) {
            switch (options.drawDirection) {
                case 'down':
                    labelY += actualTextHeight / 2 / transform.scale;
                    break;
                case 'up':
                    labelY -= actualTextHeight / 2 / transform.scale;
                    break;
                case 'left':
                    labelX -= actualTextWidth / 2 / transform.scale;
                    break;
                case 'right':
                    labelX += actualTextWidth / 2 / transform.scale;
                    break;
            }
        } else {
            // 如果没有指定方向，根据角度平分线的方向智能调整
            // 使标签中心相对于计算出的位置进行偏移，避免文本覆盖角度弧线
            const offsetX = Math.cos(bisectorAngle) * (actualTextWidth / 2) / transform.scale;
            const offsetY = Math.sin(bisectorAngle) * (actualTextHeight / 2) / transform.scale;
            
            labelX += offsetX;
            labelY += offsetY;
        }
        
        // 应用变换（逻辑坐标 -> 屏幕坐标）
        return toScreenPoint(labelX, labelY, transform);
    }
}
