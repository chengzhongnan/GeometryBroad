import { Point } from './Point';
import { Line } from './LinearObject';
import { GeometricObject, type DrawLabelOptions, type DrawOptions, type IPoint } from './base';

export class Hyperbola extends GeometricObject {
    // 双曲线中心
    public center: Point;
    // 半实轴长
    public aValue: number;
    // 半虚轴长
    public bValue: number;
    // 旋转角度（度）
    public rotateAngle: number;

    constructor(name: string, center: Point, aValue: number, bValue: number, rotateAngle: number) {
        super(name, 'hyperbola');
        this.center = center;
        this.aValue = aValue;
        this.bValue = bValue;
        this.rotateAngle = rotateAngle;
    }

    /**
     * 计算并返回双曲线一个焦点的屏幕坐标，用于放置标签。
     */
    getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
        // 1. 对于标准双曲线 x²/a² - y²/b² = 1，焦点距离中心的距离 c 满足 c² = a² + b²
        const c = Math.sqrt(this.aValue * this.aValue + this.bValue * this.bValue);
        // 取其中一个焦点作为局部坐标
        const localFocusX = c;
        const localFocusY = 0;

        // 2. 将焦点坐标绕原点旋转
        const angleRad = this.rotateAngle * (Math.PI / 180);
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        const rotatedX = localFocusX * cosA - localFocusY * sinA;
        const rotatedY = localFocusX * sinA + localFocusY * cosA;

        // 3. 将旋转后的坐标进行平移，从中心点位置移动到世界坐标
        const worldX = rotatedX + this.center.x;
        const worldY = rotatedY + this.center.y;

        // 4. 将世界坐标转换为屏幕坐标并返回
        return {
            x: worldX * transform.scale + transform.offsetX,
            y: worldY * transform.scale + transform.offsetY,
        };
    }

    /**
     * 在Canvas上绘制双曲线。
     * @param ctx - Canvas 2D 绘图上下文。
     * @param transform - 视口变换信息。
     * @param options - 绘制选项。
     */
    public draw(ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, options?: DrawOptions): void {
        if (this.aValue === 0 || this.bValue === 0) {
            return; // a或b为0时双曲线退化，不进行绘制
        }

        ctx.strokeStyle = options?.color || 'black';
        ctx.lineWidth = options?.lineWidth || 1;
        ctx.setLineDash(options?.dashed ? [5, 5] : []);

        const angleRad = this.rotateAngle * (Math.PI / 180);
        const cosA = Math.cos(angleRad);
        const sinA = Math.sin(angleRad);
        
        const step = 0.001; // 参数t的步长，越小曲线越平滑
        // 定义参数t的范围以避免无穷大。t在±π/2处，sec(t)和tan(t)为无穷
        const rangeLimit = Math.PI / 2 - 0.005;

        // 绘制双曲线的两条分支
        for (let i = 0; i < 2; i++) {
            ctx.beginPath();
            let isFirstPoint = true;
            
            // 根据i的值选择t的范围，分别绘制左右两条分支
            const startT = (i === 0) ? -rangeLimit : (Math.PI - rangeLimit);
            const endT = (i === 0) ? rangeLimit : (Math.PI + rangeLimit);

            for (let t = startT; t <= endT; t += step) {
                // 1. 使用参数方程 x = a*sec(t), y = b*tan(t) 计算局部坐标
                // 为了数值稳定性，我们使用 1/cos(t) 代替 sec(t)
                const xLocal = this.aValue / Math.cos(t);
                const yLocal = this.bValue * Math.tan(t);

                // 2. 对该点 (xLocal, yLocal) 进行旋转
                const rotatedX = xLocal * cosA - yLocal * sinA;
                const rotatedY = xLocal * sinA + yLocal * cosA;

                // 3. 对旋转后的点进行平移 (以center为基准)
                const worldX = rotatedX + this.center.x;
                const worldY = rotatedY + this.center.y;

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
}