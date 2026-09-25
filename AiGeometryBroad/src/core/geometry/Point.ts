import { GeometricObject, type DrawTransform, type IPoint, type DrawLabelOptions, toScreenPoint, resolvePointRadius, resolveLineWidth } from './base';

export class PointNativeObject implements IPoint {
    public x: number;
    public y: number;
    public radius: number; // 半径
    public real: boolean; // 是否为实心点，false表示空心点

    constructor(x: number, y: number, radius: number = 1, real: boolean = true) {
        this.x = x;
        this.y = y;
        this.radius = radius; // 默认半径
        this.real = real; // 默认实心点
    }
}

export class Point extends GeometricObject implements IPoint {
    public x: number;
    public y: number;
    public radius: number; // 默认半径
    public real: boolean; // 是否为实心点，false表示空心点
    public explicitRadius: boolean; // 用户是否显式指定了半径
    // 冻结后画布上不允许左键拖动这个点（对应 `CREATE POINT ... frozen=true`）。
    // 解释器自动生成的点（中点、垂足、交点…）不参与，恒为 false。
    public frozen: boolean = false;

    constructor(name: string, x: number, y: number, radius?: number, real: boolean = true) {
        super(name, 'point');
        this.x = x;
        this.y = y;
        this.radius = radius ?? 1;
        this.explicitRadius = radius !== undefined;
        this.real = real; // Default to real point
    }

    /**
     * 点的旋转
     * @param rotateCenter 旋转中心点
     * @param angle 旋转角度（弧度）
     * @param direction true表示顺时针旋转，false表示逆时针旋转
     */
    public rotateSinglePoint(rotateCenter: Point, angle: number, direction: boolean): PointNativeObject {
        // 1. 根据旋转方向确定有效角度。
        // 标准的二维旋转公式是逆时针的，顺时针旋转等同于旋转一个负的角度。
        const effectiveAngle = direction ? -angle : angle;

        // 2. 为提高效率和可读性，预先计算sin和cos值。
        const cosAngle = Math.cos(effectiveAngle);
        const sinAngle = Math.sin(effectiveAngle);

        // 3. 将坐标系平移，使旋转中心点(rotateCenter)成为原点。
        //    这是应用标准旋转公式前的准备步骤。
        const translatedX = this.x - rotateCenter.x;
        const translatedY = this.y - rotateCenter.y;

        // 4. 应用标准的原点旋转公式。
        const rotatedX = translatedX * cosAngle - translatedY * sinAngle;
        const rotatedY = translatedX * sinAngle + translatedY * cosAngle;

        // 5. 将坐标系平移回去，将点恢复到原始坐标系中，得到最终的坐标。
        const finalX = rotatedX + rotateCenter.x;
        const finalY = rotatedY + rotateCenter.y;

        // 6. 创建并返回一个新的PointNativeObject实例。
        // 旋转不改变点的半径和虚实属性，因此我们沿用`this`的这些属性。
        return new PointNativeObject(finalX, finalY, this.radius, this.real);
    }

    // 计算两点之间的距离
    public distanceTo(other: Point): number {
        const dx = this.x - other.x;
        const dy = this.y - other.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    public distanceTo2(x: number, y: number): number {
        const dx = this.x - x;
        const dy = this.y - y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    // 应用变换，返回一个新的Point对象
    public transform(scale: number, offsetX: number, offsetY: number): PointNativeObject {
        const transformedX = this.x * scale + offsetX;
        const transformedY = this.y * scale - offsetY;
        const newPoint = new PointNativeObject(transformedX, transformedY);
        newPoint.radius = this.radius;
        newPoint.real = this.real;
        return newPoint;
    }

    // 绘制点
    public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: { color?: string; lineWidth?: number; fillColor?: string; highlight?: boolean; defaultPointRadiusPixels?: number }): void {
        const canvasPt = this.transform(transform.scale, transform.offsetX, transform.offsetY);
        const screenRadius = resolvePointRadius(this.explicitRadius, this.radius, transform, options?.defaultPointRadiusPixels) * (options?.highlight ? 2 : 1);

        ctx.beginPath();
        // y方向默认为向下正方向，在这里改成向上正方向
        ctx.arc(canvasPt.x, 0 - canvasPt.y, screenRadius, 0, Math.PI * 2);
        ctx.closePath();

        if (this.real) {
            ctx.fillStyle = options?.fillColor || 'black';
            ctx.fill();
        } else {
            ctx.strokeStyle = options?.color || 'black';
            ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform) * (options?.highlight ? 2 : 1);
            ctx.stroke();
        }
    }

    getDrawLabelPosition(transform: DrawTransform, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        // 获取标签的实际尺寸（考虑padding）
        const padding = options.padding || 0;
        const actualTextWidth = textWidth + padding * 2;
        const actualTextHeight = textHeight + padding * 2;
        
        let labelX = this.x;
        let labelY = this.y;
        
        // 计算点的实际显示半径
        const actualRadius = resolvePointRadius(this.explicitRadius, this.radius, transform, options.defaultPointRadiusPixels);
        
        // 根据drawDirection确定标签位置
        if (options.drawDirection) {
            // 计算偏移距离，确保标签不与点重叠
            const offsetDistance = Math.max(
                actualRadius / transform.scale + actualTextHeight / 2 / transform.scale,
                actualRadius / transform.scale + actualTextWidth / 2 / transform.scale
            ) + 1 / transform.scale; // 额外的安全间距
            
            switch (options.drawDirection) {
                case 'down':
                    // 向下为负方向，所以减去偏移距离
                    labelY -= offsetDistance;
                    break;
                case 'up':
                    // 向上为正方向，所以加上偏移距离
                    labelY += offsetDistance;
                    break;
                case 'left':
                    labelX -= offsetDistance;
                    break;
                case 'right':
                    labelX += offsetDistance;
                    break;
            }
        } else {
            // 如果没有指定方向，默认放置在点的右上方
            // 这是标注点的经典位置，既美观又不容易与其他元素冲突
            const defaultAngle = Math.PI / 4; // 45度，右上方（注意：这里改为正值，因为向上为正）
            
            // 计算偏移距离
            const offsetDistance = Math.max(
                actualRadius / transform.scale + Math.max(actualTextWidth, actualTextHeight) / 2 / transform.scale,
                9 / transform.scale  // 最小偏移距离
            ) + 1 / transform.scale; // 额外的安全间距
            
            labelX += Math.cos(defaultAngle) * offsetDistance;
            labelY += Math.sin(defaultAngle) * offsetDistance;
        }
        
        // 应用变换（逻辑坐标 -> 屏幕坐标）
        // 与 draw() 中的换算保持一致：x 直接缩放平移，y 轴翻转
        return toScreenPoint(labelX, labelY, transform);
    }
}
