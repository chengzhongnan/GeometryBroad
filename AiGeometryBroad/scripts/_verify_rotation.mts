/**
 * 旋转功能端到端验证。
 *
 * 两套渲染路径必须对任意逻辑点给出同一屏幕坐标（命中测试 / Canvas 预览 / SVG 导出一致）：
 *   - Canvas 路径：内层 toScreenPoint(rotation=0) 只含 VIEW scale/center；外层 ctx 矩阵
 *     buildCanvasMatrix(view交互, W, H, 脚本旋转) 再叠交互缩放/平移/旋转。
 *   - SVG/命中路径：toScreenPoint 一次性把 交互scale * VIEWscale、交互pan + 交互scale*baseOffset、总旋转 烘进坐标。
 *
 * 下方 8 项检查分两类：
 *   1) 纯数学（matrix θ=0、round-trip、normalize/snap/clamp）—— 单模块自洽。
 *   2) 跨路径一致性（test 2 渲染矩阵 == SVG 旋转坐标；test 4 缩放锚点光标不动；
 *      test 5 命中变换 == 渲染矩阵）—— 两条路径对同一点算同一屏幕坐标。
 */
import {
    buildCanvasMatrix,
    zoomViewAt,
    screenToViewSpace,
    viewPivot,
    normalizeAngle,
    snapAngle,
    degreesToRadians,
    clampViewScale,
} from '../src/core/viewTransform';
import { toScreenPoint, fromScreenPoint, type DrawTransform } from '../src/core/geometry/base';

type Pt = { x: number; y: number };
const approx = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) <= eps;
const check = (name: string, ok: boolean, extra = '') =>
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`);

const W = 800;
const H = 600;
const pivot = viewPivot(W, H); // {400, 300}

// 1) θ=0 时 buildCanvasMatrix 必须退化成老实现 scale/平移
{
    const [a, b, c, d, e, f] = buildCanvasMatrix({ x: 50, y: -20, scale: 1.5, rotation: 0 }, W, H);
    check('matrix θ=0', approx(a, 1.5) && approx(b, 0) && approx(c, 0) && approx(d, 1.5) && approx(e, 50) && approx(f, -20));
}

// 2) Canvas 渲染路径（外层矩阵 * 内层 toScreenPoint(rotation=0)）必须 == SVG 路径 toScreenPoint(rotation=θ)。
//    内层变换独立持有 scale/offset，外层矩阵只负责旋转（scale=1, pan=0），不重复缩放，两层口径对齐。
{
    const theta = degreesToRadians(30);
    const inner: DrawTransform = { scale: 2, offsetX: 10, offsetY: 20 }; // 内层：VIEW scale + center
    const [a, b, c, d, e, f] = buildCanvasMatrix({ x: 0, y: 0, scale: 1, rotation: 0 }, W, H, theta);
    let allOk = true;
    for (const [px, py] of [[3, -4], [0, 0], [-7, 9]] as const) {
        const innerPt = toScreenPoint(px, py, inner);
        const byMatrix: Pt = { x: a * innerPt.x + c * innerPt.y + e, y: b * innerPt.x + d * innerPt.y + f };
        const byTransform = toScreenPoint(px, py, { scale: 2, offsetX: 10, offsetY: 20, rotation: theta, pivot });
        if (!approx(byMatrix.x, byTransform.x, 1e-9) || !approx(byMatrix.y, byTransform.y, 1e-9)) {
            allOk = false;
            console.log(`   mismatch at (${px},${py}) matrix=(${byMatrix.x.toFixed(2)},${byMatrix.y.toFixed(2)}) transform=(${byTransform.x.toFixed(2)},${byTransform.y.toFixed(2)})`);
        }
    }
    check('render matrix == toScreenPoint(rotation)', allOk);
}

// 3) fromScreenPoint 是 toScreenPoint 的逆（含旋转）
{
    const theta = degreesToRadians(63);
    const L: DrawTransform = { scale: 1.7, offsetX: -30, offsetY: 55, rotation: theta, pivot };
    const px = -7.3, py = 12.8;
    const s = toScreenPoint(px, py, L);
    const back = fromScreenPoint(s.x, s.y, L);
    check('toScreenPoint/fromScreenPoint round-trip', approx(back.x, px) && approx(back.y, py));
}

// 4) zoomViewAt：光标下那个点缩放前后屏幕位置不变。
//    mouse 是屏幕坐标，需先反算成「内层坐标」u，再验证 before/after 矩阵都把 u 映回同一屏幕点。
//    有旋转时必须把 declared rotation 作为 extraRotation 传入，否则内部分反旋转与对照矩阵角度不一致。
{
    const declared = degreesToRadians(40); // VIEW rotation=40
    const view = { x: 12, y: -8, scale: 1.25, rotation: declared }; // 交互旋转也设成 40°，总旋转 80°
    const mouse = { x: 620, y: 95 };
    const zoomed = zoomViewAt(view, W, H, mouse.x, mouse.y, view.scale * 1.8, declared);
    const u = screenToViewSpace(view, W, H, mouse.x, mouse.y, declared); // 光标对应的内层坐标
    const [a0, b0, c0, d0, e0, f0] = buildCanvasMatrix(view, W, H, declared);
    const [a1, b1, c1, d1, e1, f1] = buildCanvasMatrix(zoomed, W, H, declared);
    const beforeScreen: Pt = { x: a0 * u.x + c0 * u.y + e0, y: b0 * u.x + d0 * u.y + f0 };
    const afterScreen: Pt = { x: a1 * u.x + c1 * u.y + e1, y: b1 * u.x + d1 * u.y + f1 };
    check('zoom keeps cursor anchored',
        approx(beforeScreen.x, mouse.x, 1e-6) && approx(beforeScreen.y, mouse.y, 1e-6) && approx(afterScreen.x, mouse.x, 1e-6) && approx(afterScreen.y, mouse.y, 1e-6),
        `before=(${beforeScreen.x.toFixed(2)},${beforeScreen.y.toFixed(2)}) after=(${afterScreen.x.toFixed(2)},${afterScreen.y.toFixed(2)})`);
}

// 5) 交互旋转 + 脚本旋转 叠加后，命中测试用的「逻辑->屏幕」变换与渲染一致。
//    Canvas 路径：inner(scale=viewScale, offset=baseOffset, rotation=0) 再由 buildCanvasMatrix(view交互, W, H, declared) 作用。
//    SVG/命中路径：toScreenPoint(scale=view.scale*viewScale, offset=view.scale*baseOffset+view.x, rotation=total)。
{
    const viewScale = 1;
    const baseOffsetX = W / 2; // centerX=0
    const baseOffsetY = H / 2;
    const interactiveRotation = degreesToRadians(15);
    const declaredRotation = degreesToRadians(25); // VIEW rotation=25
    const total = interactiveRotation + declaredRotation;
    const view = { x: 30, y: 10, scale: 2, rotation: interactiveRotation };
    const inner: DrawTransform = { scale: viewScale, offsetX: baseOffsetX, offsetY: baseOffsetY };
    const [a, b, c, d, e, f] = buildCanvasMatrix(view, W, H, declaredRotation);
    const transform: DrawTransform = {
        scale: view.scale * viewScale,
        offsetX: view.scale * baseOffsetX + view.x,
        offsetY: view.scale * baseOffsetY + view.y,
        rotation: total,
        pivot,
    };
    let allOk = true;
    for (const [px, py] of [[0, 0], [1, -1], [-3, 4], [50, 7]] as const) {
        const byTransform = toScreenPoint(px, py, transform);
        const innerPt = toScreenPoint(px, py, inner);
        const byMatrix: Pt = { x: a * innerPt.x + c * innerPt.y + e, y: b * innerPt.x + d * innerPt.y + f };
        if (!approx(byTransform.x, byMatrix.x, 1e-7) || !approx(byTransform.y, byMatrix.y, 1e-7)) {
            allOk = false;
            console.log(`   mismatch at (${px},${py})`);
        }
    }
    check('hit-test transform == render matrix (stacked rotation)', allOk);
}

// 6) normalizeAngle 跨 ±π 不跳变一整圈
check('normalizeAngle', approx(normalizeAngle(0.3), 0.3) && approx(normalizeAngle(Math.PI * 1.5), -Math.PI / 2) && approx(normalizeAngle(-Math.PI * 1.5), Math.PI / 2));

// 7) snapAngle 吸附到 15°
check('snapAngle', approx(snapAngle(degreesToRadians(38)), degreesToRadians(45)) && approx(snapAngle(degreesToRadians(7)), 0));

// 8) clampViewScale 卡边界
check('clampViewScale', clampViewScale(0.01) === 0.1 && clampViewScale(100) === 10 && approx(clampViewScale(2.5), 2.5));

console.log('done');
