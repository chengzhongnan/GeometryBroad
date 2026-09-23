import { Point } from './Point';
import { Line } from './LinearObject';
import { GeometricObject, type DrawLabelOptions, type DrawOptions, type IPoint, toScreenPoint } from './base';

type ParabolaDirection = 'up' | 'down' | 'left' | 'right';

export class Parabola extends GeometricObject {
    // 抛物线顶点
    public vertex: Point;
    // y^2 = 2px 这样定义的抛物线的p值
    public pValue: number;
    // 旋转角度（度），所有的抛物线都可以看作是由 y^2=2px 旋转和平移得到的
    public rotateAngle: number;

    constructor(name: string, vertex: Point, pValue: number, rotateAngle: number) {
        super(name, 'parabola');
        this.vertex = vertex;
        this.pValue = pValue;
        this.rotateAngle = rotateAngle;
    }

    /**
     * 计算并返回抛物线焦点的屏幕坐标，用于放置标签。
     */
    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        // 1. 标准抛物线 y^2 = 2px 的焦点在 (p/2, 0)
        const localFocusX = this.pValue / 2;
        const localFocusY = 0;

        // 2. 将焦点坐标绕原点(即顶点)旋转
        const angleRad = this.rotateAngle * (Math.PI / 180);
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        const rotatedX = localFocusX * cosA - localFocusY * sinA;
        const rotatedY = localFocusX * sinA + localFocusY * cosA;

        // 3. 将旋转后的坐标进行平移，从顶点位置移动到世界坐标
        const worldX = rotatedX + this.vertex.x;
        const worldY = rotatedY + this.vertex.y;

        // 4. 将世界坐标转换为屏幕坐标并返回
        return toScreenPoint(worldX, worldY, transform);
    }

    /**
         * 在Canvas上绘制抛物线。
         * @param ctx - Canvas 2D 绘图上下文。
         * @param transform - 视口变换信息。
         * @param options - 绘制选项。
         */
    public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
        if (this.pValue === 0) {
            // p=0 时抛物线退化为一条射线，此处为避免除以0，直接不绘制
            return;
        }

        ctx.strokeStyle = options?.color || 'black';
        ctx.lineWidth = (options?.lineWidth || 1) * (options?.highlight ? 2 : 1);
        ctx.setLineDash(options?.dashed ? [5, 5] : []);
        ctx.beginPath();

        // 预计算旋转角度的sin和cos值，避免在循环中重复计算
        const angleRad = this.rotateAngle * (Math.PI / 180);
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);

        // --- 动态计算绘制范围 ---
        // 1. 获取画布的尺寸
        const { width, height } = ctx.canvas;
        // 2. 计算屏幕对角线的像素长度
        const screenDiagonal = Math.sqrt(width * width + height * height);
        // 3. 将其转换为世界坐标系中的长度，作为动态的绘制范围
        const dynamicRange = screenDiagonal / transform.scale;
        // 4. 结合固有的p值和动态范围，得到最终的采样范围
        const range = 4 * Math.abs(this.pValue) + dynamicRange;
        // --- 范围计算结束 ---

        // 步长与缩放级别关联，保证在任何缩放级别下看起来都平滑
        const step = 0.1 / transform.scale;

        let isFirstPoint = true;

        // 通过在标准抛物线上取样一系列点，然后对每个点进行变换来绘制
        for (let yLocal = -range; yLocal <= range; yLocal += step) {
            // 1. 根据标准方程 y² = 2px 计算 x
            const xLocal = (yLocal * yLocal) / (2 * this.pValue);

            // 2. 对该点 (xLocal, yLocal) 进行旋转
            const rotatedX = xLocal * cosA - yLocal * sinA;
            const rotatedY = xLocal * sinA + yLocal * cosA;

            // 3. 对旋转后的点进行平移 (以vertex为基准)
            const worldX = rotatedX + this.vertex.x;
            const worldY = rotatedY + this.vertex.y;

            // 4. 将世界坐标转换为屏幕坐标
            const screenX = worldX * transform.scale + transform.offsetX;
            const screenY = worldY * transform.scale + transform.offsetY;

            // 5. 绘制路径
            if (isFirstPoint) {
                ctx.moveTo(screenX, screenY);
                isFirstPoint = false;
            } else {
                ctx.lineTo(screenX, screenY);
            }
        }

        ctx.stroke();
    }
}