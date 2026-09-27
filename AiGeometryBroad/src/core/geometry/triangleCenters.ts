/**
 * 三角形的各种「心」与内切 / 外接 / 旁切圆的**纯坐标计算**。
 *
 * 单独放一个模块的理由和 `canvasDragMode` 一样：这些是纯函数，
 * 能脱离画布、脱离 React 直接做离线断言 —— 而「内心算错了」这种事，
 * 在图上看起来只是「圆没贴住三条边」，靠肉眼很难发现。
 *
 * 公式来源都是初等几何，注释里给了依据，方便以后有人对着算一遍。
 */

export interface XY {
    x: number;
    y: number;
}

/** 三个顶点。顺序无所谓，但下面所有函数都按 p1 / p2 / p3 这个顺序理解「对角」。 */
export interface TriangleVertices {
    p1: XY;
    p2: XY;
    p3: XY;
}

export interface CenterAndRadius {
    center: XY;
    radius: number;
}

/** 共线判据用的阈值：`|叉积|` 小于它就算退化。和 `Circle.fromCircumcircle` 原本用的 1e-9 一致。 */
const COLLINEAR_EPSILON = 1e-9;

/**
 * 费马点的「钝角退化」阈值（度）。
 *
 * 有一个角 ≥ 120° 时，到三顶点距离之和最小的点就是**那个顶点本身**
 * （等边三角形的那套构造会跑到三角形外面去）。所以超过它就直接返回顶点。
 * 用 120 而不是「> 120」：正好 120° 时顶点和费马点重合，两种取法结果一样。
 */
const FERMAT_OBTUSE_LIMIT = 120;

/** 边 a = |p2p3|、b = |p1p3|、c = |p1p2|（a 对着 p1，以此类推）。 */
export function triangleSideLengths({ p1, p2, p3 }: TriangleVertices): { a: number; b: number; c: number } {
    return {
        a: Math.hypot(p3.x - p2.x, p3.y - p2.y),
        b: Math.hypot(p3.x - p1.x, p3.y - p1.y),
        c: Math.hypot(p2.x - p1.x, p2.y - p1.y),
    };
}

/** 有向面积的两倍。为 0（在阈值内）表示三点共线。 */
export function doubledSignedArea({ p1, p2, p3 }: TriangleVertices): number {
    return (p2.x - p1.x) * (p3.y - p1.y) - (p3.x - p1.x) * (p2.y - p1.y);
}

export function isCollinear(triangle: TriangleVertices): boolean {
    return Math.abs(doubledSignedArea(triangle)) < COLLINEAR_EPSILON;
}

/** 面积（恒为正）。 */
export function triangleArea(triangle: TriangleVertices): number {
    return Math.abs(doubledSignedArea(triangle)) / 2;
}

/** 三个内角（度），顺序对应 p1 / p2 / p3。 */
export function triangleAngles({ p1, p2, p3 }: TriangleVertices): [number, number, number] {
    const { a, b, c } = triangleSideLengths({ p1, p2, p3 });
    const angleAt = (opposite: number, side1: number, side2: number): number => {
        const cos = (side1 * side1 + side2 * side2 - opposite * opposite) / (2 * side1 * side2);
        // 浮点误差可能让 cos 略微越界，夹一下再反余弦，免得得到 NaN。
        return Math.acos(Math.min(1, Math.max(-1, cos))) * 180 / Math.PI;
    };
    return [angleAt(a, b, c), angleAt(b, a, c), angleAt(c, a, b)];
}

/** 重心：三个顶点坐标的算术平均。 */
export function centroid(triangle: TriangleVertices): XY {
    const { p1, p2, p3 } = triangle;
    return { x: (p1.x + p2.x + p3.x) / 3, y: (p1.y + p2.y + p3.y) / 3 };
}

/**
 * 外心（外接圆圆心）：到三顶点等距的点，也就是两条中垂线的交点。
 *
 * 用行列式解「到 p1 / p2 等距」和「到 p1 / p3 等距」这两条线性方程：
 *   2(p2−p1)·X = |p2|² − |p1|²
 *   2(p3−p1)·X = |p3|² − |p1|²
 * 系数矩阵的行列式正好是三点有向面积的两倍，所以共线时无解 —— 抛错。
 */
export function circumcenter(triangle: TriangleVertices): CenterAndRadius {
    const { p1, p2, p3 } = triangle;
    const d = 2 * doubledSignedArea(triangle);
    if (Math.abs(d) < COLLINEAR_EPSILON) {
        throw new Error('三点共线，没有外接圆');
    }
    const p1sq = p1.x * p1.x + p1.y * p1.y;
    const p2sq = p2.x * p2.x + p2.y * p2.y;
    const p3sq = p3.x * p3.x + p3.y * p3.y;

    const x = (p1sq * (p2.y - p3.y) + p2sq * (p3.y - p1.y) + p3sq * (p1.y - p2.y)) / d;
    const y = (p1sq * (p3.x - p2.x) + p2sq * (p1.x - p3.x) + p3sq * (p2.x - p1.x)) / d;

    return { center: { x, y }, radius: Math.hypot(x - p1.x, y - p1.y) };
}

/**
 * 内心（内切圆圆心）：三条角平分线的交点。
 *
 * 坐标是三个顶点按**对边长度**加权的平均（这是内心的重心坐标 a:b:c）：
 *   I = (a·P1 + b·P2 + c·P3) / (a+b+c)
 * 半径 = 面积 / 半周长。
 */
export function incenter(triangle: TriangleVertices): CenterAndRadius {
    if (isCollinear(triangle)) {
        throw new Error('三点共线，没有内切圆');
    }
    const { p1, p2, p3 } = triangle;
    const { a, b, c } = triangleSideLengths(triangle);
    const perimeter = a + b + c;

    const center: XY = {
        x: (a * p1.x + b * p2.x + c * p3.x) / perimeter,
        y: (a * p1.y + b * p2.y + c * p3.y) / perimeter,
    };
    const semiPerimeter = perimeter / 2;
    return { center, radius: triangleArea(triangle) / semiPerimeter };
}

/**
 * 垂心：三条高的交点。
 *
 * 用向量恒等式 `H = P1 + P2 + P3 − 2·O`（O 是外心）—— 比联立两条高的方程短得多，
 * 而且天然和「外心」共用同一套退化判据（共线时外心不存在，垂心也就没有意义）。
 */
export function orthocenter(triangle: TriangleVertices): XY {
    const { center } = circumcenter(triangle);
    const { p1, p2, p3 } = triangle;
    return { x: p1.x + p2.x + p3.x - 2 * center.x, y: p1.y + p2.y + p3.y - 2 * center.y };
}

/**
 * 三个旁心（旁切圆圆心）与它们的半径。
 *
 * 第 k 个旁心是「与 p_k 对面的那条边以及另外两条边的延长线都相切」的圆心，
 * 重心坐标是 `(−a : b : c)` 的轮换：
 *   I_a = (−a·P1 + b·P2 + c·P3) / (−a + b + c)
 * 半径 r_a = 面积 / (s − a)（s 是半周长）。
 *
 * 返回顺序固定为「对着 p1 / p2 / p3 的那一个」，和 `name=I1,I2,I3` 一一对应。
 */
export function excenters(triangle: TriangleVertices): CenterAndRadius[] {
    if (isCollinear(triangle)) {
        throw new Error('三点共线，没有旁切圆');
    }
    const { p1, p2, p3 } = triangle;
    const { a, b, c } = triangleSideLengths(triangle);
    const semiPerimeter = (a + b + c) / 2;
    const area = triangleArea(triangle);

    const vertices: XY[] = [p1, p2, p3];
    const opposite: number[] = [a, b, c];
    const weights: number[][] = [
        [-a, b, c],
        [a, -b, c],
        [a, b, -c],
    ];

    return weights.map((w, index) => {
        const sum = w[0] + w[1] + w[2];
        const center: XY = {
            x: (w[0] * vertices[0].x + w[1] * vertices[1].x + w[2] * vertices[2].x) / sum,
            y: (w[0] * vertices[0].y + w[1] * vertices[1].y + w[2] * vertices[2].y) / sum,
        };
        // 半周长减对边长；退化三角形已在前面挡掉，这里分母不会到 0。
        const radius = area / (semiPerimeter - opposite[index]);
        return { center, radius };
    });
}

/**
 * 第一费马点：到三个顶点距离之和最小的点。
 *
 * 两种情形：
 *   - 有内角 ≥ 120°：费马点就是**那个顶点**（等边三角形构造会落到三角形外面，
 *     所以不能用那套公式）；
 *   - 否则：三条边各向外作等边三角形，新顶点与原对顶点的连线交于一点。
 *     这里用交点的解析形式 —— 取边 P2P3 上的等边顶点 A'（在 P1 的对侧），
 *     再求直线 P1A' 与直线 P2B' 的交点。
 *
 * 直接解两条直线的参数方程，比先算重心坐标再转换更短，也不会有「1/sin(A+60°)
 * 在 A 接近 120° 时爆掉」的数值问题（那条路已经在上面用钝角分支绕开了，
 * 这里干脆不用）。
 */
export function fermatPoint(triangle: TriangleVertices): XY {
    if (isCollinear(triangle)) {
        throw new Error('三点共线，没有费马点');
    }
    const { p1, p2, p3 } = triangle;
    const angles = triangleAngles(triangle);
    const maxAngle = Math.max(...angles);
    if (maxAngle >= FERMAT_OBTUSE_LIMIT) {
        return angles.indexOf(maxAngle) === 0 ? { ...p1 } : angles.indexOf(maxAngle) === 1 ? { ...p2 } : { ...p3 };
    }

    // 在 P2P3 上作等边三角形，取**远离 P1** 的那个顶点。
    const apexA = equilateralApex(p2, p3, p1);
    const apexB = equilateralApex(p1, p3, p2);
    const intersection = lineIntersection(p1, apexA, p2, apexB);
    if (!intersection) {
        // 理论上到不了这里（非退化三角形两条线必相交）；真到了说明数值退化，
        // 与其返回一个 NaN 点让画布上出现「看不见的对象」，不如明确报错。
        throw new Error('费马点求解失败（三角形退化）');
    }
    return intersection;
}

/**
 * 以 `a`、`b` 为底边作等边三角形，返回**远离 `awayFrom` 那一侧**的顶点。
 *
 * 底边的中点到顶点的距离是边长 × √3/2，方向垂直于底边 —— 所以
 * `mid ± (√3/2)·rot90(b − a)` 就是两个候选，取离 `awayFrom` 远的那个。
 */
export function equilateralApex(a: XY, b: XY, awayFrom: XY): XY {
    const mid: XY = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const height = Math.sqrt(3) / 2;
    const candidate1: XY = { x: mid.x - dy * height, y: mid.y + dx * height };
    const candidate2: XY = { x: mid.x + dy * height, y: mid.y - dx * height };
    const distance = (p: XY) => Math.hypot(p.x - awayFrom.x, p.y - awayFrom.y);
    return distance(candidate1) >= distance(candidate2) ? candidate1 : candidate2;
}

/**
 * 两条直线的交点；平行（含重合）时返回 null。
 *
 * `p + t·(q−p)` 与 `r + s·(u−r)` 联立，解出 t 再代回去。
 * 分母是两方向向量的叉积，为 0 表示平行。
 */
export function lineIntersection(p: XY, q: XY, r: XY, u: XY): XY | null {
    const d1x = q.x - p.x;
    const d1y = q.y - p.y;
    const d2x = u.x - r.x;
    const d2y = u.y - r.y;
    const denominator = d1x * d2y - d1y * d2x;
    if (Math.abs(denominator) < COLLINEAR_EPSILON) return null;
    const t = ((r.x - p.x) * d2y - (r.y - p.y) * d2x) / denominator;
    return { x: p.x + t * d1x, y: p.y + t * d1y };
}
