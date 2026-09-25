/**
 * 画布视图变换（平移 / 缩放 / 旋转）的纯数学部分。
 *
 * 渲染语义（与 GeometryCanvas 的 ctx 矩阵逐字对应）：
 *
 *     屏幕坐标 = C + R(θ) · ( s · u + pan − C )
 *
 * 其中 u 是「画布外层矩阵之前」的坐标（几何对象 toScreenPoint 的输出），
 * s 是画布缩放，pan 是画布平移，θ 是总旋转角，C 是画布中心。
 *
 * 旋转轴心取**画布中心**：拖动时内容绕画布中心打转，视觉上最稳；
 * 而且 θ 与 s / pan 相互独立 —— 改缩放不会连带把画面转掉，反过来也一样。
 * 与 s / pan 的关系纯粹是「后叠加」：θ=0 时整条公式退化成老实现
 * `屏幕 = s · u + pan`，逐字节一致。
 */
import type { IPoint } from './geometry/base';

/** 画布缩放的上下限。超过这个范围点半径 / 线宽的折算会明显失真，所以卡住。 */
export const MIN_VIEW_SCALE = 0.1;
export const MAX_VIEW_SCALE = 10;

/** Shift 吸附旋转的步长（度）。 */
export const ROTATION_SNAP_DEGREES = 15;

/** 画布视图状态：一份数据同时给渲染、命中测试和右键菜单的坐标反算使用。 */
export interface CanvasView {
    x: number;
    y: number;
    scale: number;
    /** 旋转角（弧度）。屏幕 y 轴向下，所以正值 = 顺时针。 */
    rotation: number;
}

export function createView(partial?: Partial<CanvasView>): CanvasView {
    return { x: 0, y: 0, scale: 1, rotation: 0, ...partial };
}

/** 旋转轴心：画布中心（画布像素坐标）。 */
export function viewPivot(width: number, height: number): IPoint {
    return { x: width / 2, y: height / 2 };
}

export function clampViewScale(scale: number): number {
    if (!Number.isFinite(scale)) return 1;
    return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
}

export function isUsableView(view: Partial<CanvasView> | null | undefined): boolean {
    return Boolean(view) && Number.isFinite(view!.scale) && (view!.scale as number) > 0;
}

/** 绕 pivot 旋转一点（弧度，正值 = 屏幕上顺时针）。 */
export function rotateAbout(point: IPoint, pivot: IPoint, angle: number): IPoint {
    if (!angle) return { x: point.x, y: point.y };
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const dx = point.x - pivot.x;
    const dy = point.y - pivot.y;
    return {
        x: pivot.x + dx * cos - dy * sin,
        y: pivot.y + dx * sin + dy * cos,
    };
}

/**
 * 画布外层矩阵：把「变换前坐标」映射到屏幕像素。
 *
 * `extraRotation` 是叠加在交互式旋转之上的**脚本声明的**旋转（`VIEW rotation=`）。
 * 两者合起来才是总旋转角 —— 与「交互缩放在脚本 scale 之上再乘一层」完全对称。
 */
export function buildCanvasMatrix(
    view: CanvasView,
    width: number,
    height: number,
    extraRotation = 0,
): [number, number, number, number, number, number] {
    const scale = Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1;
    const angle = (Number.isFinite(view.rotation) ? view.rotation : 0)
        + (Number.isFinite(extraRotation) ? extraRotation : 0);
    const pivot = viewPivot(width, height);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 屏幕 = C + R·(s·u + pan − C) 展开后：a..d 就是 s·R，
    // e/f 是「平移量自己也跟着转」之后的位移；θ=0 时退化成 (pan.x, pan.y)。
    const dx = view.x - pivot.x;
    const dy = view.y - pivot.y;
    return [
        scale * cos,
        scale * sin,
        -scale * sin,
        scale * cos,
        pivot.x + cos * dx - sin * dy,
        pivot.y + sin * dx + cos * dy,
    ];
}

/** 屏幕坐标 -> 「画布外层矩阵之前」的坐标（含反旋转）。 */
export function screenToViewSpace(
    view: CanvasView,
    width: number,
    height: number,
    screenX: number,
    screenY: number,
    extraRotation = 0,
): IPoint {
    const scale = Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1;
    const angle = -((Number.isFinite(view.rotation) ? view.rotation : 0) + extraRotation);
    const unrotated = rotateAbout({ x: screenX, y: screenY }, viewPivot(width, height), angle);
    return {
        x: (unrotated.x - view.x) / scale,
        y: (unrotated.y - view.y) / scale,
    };
}

/**
 * 缩放视图，并保持光标下那个点不动。
 *
 * 有旋转时不能直接把光标坐标代进老公式 —— 老公式默认「屏幕 = s·u + pan」，
 * 旋转之后屏幕点要先反旋转回未旋转的坐标系，锚点缩放才成立。
 */
export function zoomViewAt(
    view: CanvasView,
    width: number,
    height: number,
    screenX: number,
    screenY: number,
    nextScale: number,
    extraRotation = 0,
): CanvasView {
    const scale = Number.isFinite(view.scale) && view.scale !== 0 ? view.scale : 1;
    const target = clampViewScale(nextScale);
    const angle = (Number.isFinite(view.rotation) ? view.rotation : 0) + extraRotation;
    const anchor = rotateAbout({ x: screenX, y: screenY }, viewPivot(width, height), -angle);
    const factor = target / scale;
    return {
        x: anchor.x - (anchor.x - view.x) * factor,
        y: anchor.y - (anchor.y - view.y) * factor,
        scale: target,
        rotation: view.rotation,
    };
}

/** 把角度归一到 (-π, π]。逐帧累加拖动角时用它，跨 ±π 不会跳变一整圈。 */
export function normalizeAngle(angle: number): number {
    if (!Number.isFinite(angle)) return 0;
    const twoPi = Math.PI * 2;
    let value = angle % twoPi;
    if (value > Math.PI) value -= twoPi;
    if (value <= -Math.PI) value += twoPi;
    return value;
}

/** 把角度吸附到 stepDegrees 的整数倍。 */
export function snapAngle(angle: number, stepDegrees: number = ROTATION_SNAP_DEGREES): number {
    const step = (stepDegrees * Math.PI) / 180;
    if (!(step > 0)) return angle;
    return Math.round(angle / step) * step;
}

/** 弧度 -> 度，供 DSL（`VIEW rotation=`）与界面提示使用。 */
export function radiansToDegrees(angle: number): number {
    return (angle * 180) / Math.PI;
}

export function degreesToRadians(angle: number): number {
    return (angle * Math.PI) / 180;
}
