import { GeometricObject, type DrawTransform, type DrawOptions, type DrawLabelOptions, type IPoint, type VisibleRect, toScreenPoint, resolveLineWidth } from './base';
import { Point, PointNativeObject } from './Point';

// 沿单位方向向量 (ux, uy) 从锚点出发，求直线/射线与可视矩形的相交区间。
// 参数 t 以锚点为原点，单位为屏幕像素；tMin 是参数下界（直线传 -Infinity，射线传 0）。
// 返回 null 表示该对象在可视区域内没有可见部分。
function clipToRect(
  anchorX: number,
  anchorY: number,
  ux: number,
  uy: number,
  rect: VisibleRect,
  tMin: number
): [number, number] | null {
  let lower = tMin;
  let upper = Infinity;

  // x 方向：方向分量接近 0 时，锚点必须落在区间内才可能可见
  if (Math.abs(ux) < 1e-12) {
    if (anchorX < rect.x || anchorX > rect.x + rect.width) return null;
  } else {
    let t1 = (rect.x - anchorX) / ux;
    let t2 = (rect.x + rect.width - anchorX) / ux;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    lower = Math.max(lower, t1);
    upper = Math.min(upper, t2);
  }

  // y 方向
  if (Math.abs(uy) < 1e-12) {
    if (anchorY < rect.y || anchorY > rect.y + rect.height) return null;
  } else {
    let t1 = (rect.y - anchorY) / uy;
    let t2 = (rect.y + rect.height - anchorY) / uy;
    if (t1 > t2) {
      const swap = t1;
      t1 = t2;
      t2 = swap;
    }
    lower = Math.max(lower, t1);
    upper = Math.min(upper, t2);
  }

  if (!(upper > lower)) return null;
  return [lower, upper];
}

export class LinearNativeObject {
  constructor(p1: PointNativeObject, p2: PointNativeObject) {
    this.p1 = p1;
    this.p2 = p2;
  }

  public p1: PointNativeObject;
  public p2: PointNativeObject;
}

/**
 * 截止点的方向。
 *
 * - `'left'`：声明该点**负方向**一侧不绘制，DSL 写 `-A`（「从 A 开始」）；
 * - `'right'`：声明该点**正方向**一侧不绘制，DSL 写 `+A`（「到 A 为止」）；
 * - `null`：不带方向，DSL 只写 `A`。
 *
 * 多个截止点沿参数方向逐个**翻转**绘制状态，起点是否绘制由第一个截止点的方向决定
 * （第一个点写 `-A` 就说明 A 之前本来就没画）。详见 `getVisibleParameterIntervals`。
 */
export type CutSide = 'left' | 'right' | null;

export interface LinearCutPoint {
  point: Point;
  side: CutSide;
}

// 线性对象的抽象基类
export abstract class LinearObject extends GeometricObject {
  public p1: Point;
  public p2: Point;
  /**
   * 绘制截止点数组。点对象本身保留引用，因此用户拖动截止点时，线的可见区间会随之更新。
   *
   * 沿 p1 → p2 的参数方向排序后逐个翻转绘制状态。起点是否绘制由**第一个**截止点的
   * 方向决定：写 `-A` 意味着 A 的负方向一侧本来就不画，所以从隐藏态开始；其余情况从
   * 绘制态开始（这也是全部截止点都不带方向时的老行为）。于是：
   *
   * - 空数组：正常绘制；
   * - `A`：画到 A 为止（从定义域起点到 A）；
   * - `A,B`：跳过 A 到 B，两侧都画（挖掉中间一段）；
   * - `-A,+B`：从 A 开始、到 B 结束 —— 直线/射线被截成线段 [A,B]；
   * - `+A,-B`：A 之前和 B 之后都画，中间不画；
   * - `-A,+B,-C,+D`：画 [A,B] ∪ [C,D]，以此类推。
   *
   * 带方向是必须的：派生线（中垂线 / 平行线…）的两个定义点是内部合成点，
   * 没法像 `CREATE LINE` 那样交换 p1/p2 来表达「删掉某一侧」。
   */
  public cutPoints: LinearCutPoint[] = [];

  constructor(name: string, type: string, p1: Point, p2: Point) {
    super(name, type);
    this.p1 = p1;
    this.p2 = p2;
  }

  /** 接受裸点（等价于不带方向）或已带方向的截止点，统一存成 `LinearCutPoint`。 */
  public setCutPoints(cuts: Array<Point | LinearCutPoint>): void {
    this.cutPoints = cuts
      .filter(Boolean)
      .map(cut => (cut instanceof Point ? { point: cut, side: null } : cut))
      // 用鸭子类型而不是 `instanceof Point`：截止点只要能被投影到参数轴上就够用，
      // 没必要把它和某个具体子类绑死。
      .filter(cut => cut.point && typeof cut.point.x === 'number' && typeof cut.point.y === 'number');
  }

  /** 定义域下界：线段和射线从 p1 起算（参数 0），直线向两端无限延伸。 */
  protected get domainStart(): number {
    return this.type === 'line' ? -Infinity : 0;
  }

  /** 定义域上界：只有线段封到 p2（参数 1）。 */
  protected get domainEnd(): number {
    return this.type === 'segment' ? 1 : Infinity;
  }

  /** 把点投影到 p1 → p2 的归一化参数轴（p1 = 0，p2 = 1）。 */
  protected parameterOf(point: Point): number | null {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!(lengthSquared > 1e-12)) return null;
    const value = ((point.x - this.p1.x) * dx + (point.y - this.p1.y) * dy) / lengthSquared;
    return Number.isFinite(value) ? value : null;
  }

  /**
   * 截止点按参数升序排好，并过滤掉落在定义域之外的。
   *
   * 不去重：连续裁剪可能需要在同一边界处再次翻转可见状态，
   * 例如已有 `A,B` 后再删除 B 之后的可见尾部会追加一个 B。
   */
  protected getOrderedCutPoints(): Array<{ cut: LinearCutPoint; value: number }> {
    const lo = this.domainStart;
    const hi = this.domainEnd;
    return this.cutPoints
      .map(cut => ({ cut, value: this.parameterOf(cut.point) }))
      .filter((entry): entry is { cut: LinearCutPoint; value: number } => (
        entry.value !== null && entry.value >= lo - 1e-9 && entry.value <= hi + 1e-9
      ))
      .sort((a, b) => a.value - b.value);
  }

  /**
   * 归一化参数轴上的可见区间（p1 = 0，p2 = 1）。
   *
   * 沿参数方向扫描，每个截止点翻转一次绘制状态：
   * 起点状态由第一个截止点的方向决定 —— 它写 `-A` 就说明 A 的负方向本来就没画，
   * 于是从隐藏态起步；否则从绘制态起步（所有截止点都不带方向时的老行为）。
   */
  protected getVisibleParameterIntervals(): Array<[number, number]> {
    const lo = this.domainStart;
    const hi = this.domainEnd;
    const ordered = this.getOrderedCutPoints();
    if (ordered.length === 0) return [[lo, hi]];

    const intervals: Array<[number, number]> = [];
    let visible = ordered[0].cut.side !== 'left';
    let cursor = lo;
    for (const { value } of ordered) {
      if (value <= cursor + 1e-9) {
        // 和定义域起点重合：这一侧没有长度可画，直接翻转状态。
        visible = !visible;
        continue;
      }
      if (visible) intervals.push([cursor, value]);
      cursor = value;
      visible = !visible;
    }
    if (visible && hi > cursor + 1e-9) intervals.push([cursor, hi]);
    return intervals;
  }

  /** 命中测试复用绘制语义：被截止点砍掉的部分不可选。 */
  public isParameterVisible(parameter: number): boolean {
    if (this.type === 'segment' && (parameter < -1e-9 || parameter > 1 + 1e-9)) return false;
    if (this.type === 'ray' && parameter < -1e-9) return false;

    const ordered = this.getOrderedCutPoints();
    if (ordered.length === 0) return true;

    let visible = ordered[0].cut.side !== 'left';
    for (const { value } of ordered) {
      if (parameter < value - 1e-9) return visible;
      if (Math.abs(parameter - value) <= 1e-9) return true;
      visible = !visible;
    }
    return visible;
  }

  /** 把可见区间从归一化参数轴换算到屏幕参数轴，并与本次绘制范围求交。 */
  protected getVisibleDrawIntervals(
    extent: [number, number],
    parameterToScreen: (parameter: number) => number,
  ): Array<[number, number]> {
    const intervals: Array<[number, number]> = [];
    for (const [start, end] of this.getVisibleParameterIntervals()) {
      const a = parameterToScreen(start);
      const b = parameterToScreen(end);
      const from = Math.max(extent[0], Math.min(a, b));
      const to = Math.min(extent[1], Math.max(a, b));
      if (to > from + 1e-9) intervals.push([from, to]);
    }
    return intervals;
  }

  getDrawLabelPosition(transform: { scale: number; offsetX: number; offsetY: number; }, options: DrawLabelOptions, textWidth: number, textHeight: number): IPoint {
    // 计算两个点的中点
    const midX = (this.p1.x + this.p2.x) / 2;
    const midY = (this.p1.y + this.p2.y) / 2;

    // 获取标签的实际尺寸（考虑padding）
    const padding = options.padding || 0;
    const actualTextWidth = textWidth + padding * 2;
    const actualTextHeight = textHeight + padding * 2;

    let labelX = midX;
    let labelY = midY;

    // 根据drawDirection确定标签位置
    if (options.drawDirection) {
      // 计算偏移距离，确保标签不与直线重叠
      const offsetDistance = Math.max(actualTextHeight, actualTextWidth) / 2 / transform.scale + 5 / transform.scale;

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
      // 如果没有指定方向，智能选择标签位置
      // 计算直线的方向向量
      const dx = this.p2.x - this.p1.x;
      const dy = this.p2.y - this.p1.y;

      // 计算直线的角度
      const lineAngle = Math.atan2(dy, dx);

      // 计算垂直于直线的方向（向上偏移）
      const perpAngle = lineAngle + Math.PI / 2;

      // 计算偏移距离
      const offsetDistance = Math.max(actualTextHeight, actualTextWidth) / 2 / transform.scale + 8 / transform.scale;

      // 选择垂直方向上的偏移，通常选择向上的方向
      // 如果直线接近垂直，则选择向右偏移
      if (Math.abs(Math.cos(lineAngle)) < 0.3) {
        // 直线接近垂直，向右偏移
        labelX += offsetDistance;
      } else {
        // 直线不是很垂直，使用垂直方向偏移
        labelX += Math.cos(perpAngle) * offsetDistance;
        labelY += Math.sin(perpAngle) * offsetDistance;

        // 确保标签偏移到直线的"上方"（屏幕坐标系中y值较小的方向）
        if (Math.sin(perpAngle) > 0) {
          labelX += Math.cos(perpAngle + Math.PI) * offsetDistance;
          labelY += Math.sin(perpAngle + Math.PI) * offsetDistance;
        }
      }
    }

    // 应用变换（逻辑坐标 -> 屏幕坐标）
    return toScreenPoint(labelX, labelY, transform);
  }

  // 统一的描边样式设置
  protected applyStrokeStyle(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
    ctx.strokeStyle = options?.color || 'black';
    ctx.lineWidth = resolveLineWidth(options?.lineWidth, transform) * (options?.highlight ? 2 : 1);
    if (options?.dashed) {
      ctx.setLineDash([5, 5]);
    } else {
      ctx.setLineDash([]);
    }
  }

  /**
   * 计算线性对象本次实际要绘制的区间。
   *
   * 返回值是沿单位方向 (ux, uy)、以锚点 (anchorX, anchorY) 为原点的参数区间 [t0, t1]，
   * 单位为屏幕像素；返回 null 表示该对象在可视区域内没有可见部分。
   *
   * - 指定了 length（逻辑单位）：forwardOnly 为 false 时以锚点为中心向两端各延伸一半（直线），
   *   为 true 时从锚点向前延伸（射线）。
   * - 未指定 length：只延伸到可视区域的边缘就停住，不再往外，
   *   避免无限长的线把导出 SVG 的画布撑得非常大、几何图形显得很小。
   */
  protected resolveDrawExtent(
    ctx: CanvasRenderingContext2D,
    transform: DrawTransform,
    options: DrawOptions | undefined,
    anchorX: number,
    anchorY: number,
    ux: number,
    uy: number,
    tMin: number,
    forwardOnly: boolean
  ): [number, number] | null {
    const specified = options?.length;
    const total = typeof specified === 'number' && Number.isFinite(specified)
      ? specified * Math.abs(transform.scale)
      : 0;

    if (total > 0) {
      if (forwardOnly) {
        // 射线：从顶点开始向前画 total
        return [tMin, tMin + total];
      }
      // 直线：以锚点为中心，向两端各延伸一半
      const half = total / 2;
      return [-half, half];
    }

    const rect = options?.visibleRect;
    const visible: VisibleRect = rect && rect.width > 0 && rect.height > 0
      ? rect
      : { x: 0, y: 0, width: ctx.canvas.width, height: ctx.canvas.height };

    return clipToRect(anchorX, anchorY, ux, uy, visible, tMin);
  }

  // 直线绕着 p1 点旋转指定角度
  /**
   * 
   * @param angle 旋转角度，单位为弧度
   * @param centerPoint 旋转的中心点
   * @param direction true为顺时针旋转，false为逆时针旋转
   */
  public rotateAroundPoint(angle: number, centerPoint: Point, direction: boolean): LinearNativeObject {
    // 1. 调用 p1 点自身的旋转方法，得到旋转后的新点 newP1
    const newP1 = this.p1.rotateSinglePoint(centerPoint, angle, direction);

    // 2. 调用 p2 点自身的旋转方法，得到旋转后的新点 newP2
    const newP2 = this.p2.rotateSinglePoint(centerPoint, angle, direction);

    // 3. 将两个新的点对象组合成一个 LinearNativeObject 并返回
    return {
      p1: newP1,
      p2: newP2
    };
  }

  /**
   * @param point 检查点是否在直线、线段或射线上
   */
  public containsPoint(point: Point): boolean {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      // p1 和 p2 是同一点
      return point.x === this.p1.x && point.y === this.p1.y;
    }

    // 检查点是否共线
    const crossProduct = (point.y - this.p1.y) * dx - (point.x - this.p1.x) * dy;
    if (Math.abs(crossProduct) > 1e-6) { // 使用一个小的容差
      return false; // 不共线
    }

    // 检查点是否在线段的x和y范围内
    const dotProduct = (point.x - this.p1.x) * dx + (point.y - this.p1.y) * dy;
    return dotProduct >= 0 && dotProduct <= lengthSquared;
  }

  // 在线段上取一个给定长度的点
  public pointAtDistance(startPoint: Point, distance: number): PointNativeObject {
    let dx: number;
    let dy: number;

    // 1. 根据规则确定方向向量 (dx, dy)
    // 检查起始点是否为 p2，以决定方向
    if (startPoint.name === this.p2.name) {
      // 方向为 p2 -> p1
      dx = this.p1.x - this.p2.x;
      dy = this.p1.y - this.p2.y;
    } else {
      // 默认方向为 p1 -> p2 (适用于 startPoint 是 p1 或任何其他点的情况)
      dx = this.p2.x - this.p1.x;
      dy = this.p2.y - this.p1.y;
    }

    // 2. 计算方向向量的长度（即 p1 和 p2 之间的距离）
    const length = Math.sqrt(dx * dx + dy * dy);

    // 3. 处理特殊情况：线段长度为零
    // 当 p1 和 p2 是同一个点时，无法定义方向。
    if (length === 0) {
      // 如果移动距离也为0，可以认为结果就是起点本身。
      if (distance === 0) {
        return new PointNativeObject(startPoint.x, startPoint.y);
      }
      // 否则，无法在无方向的线上移动，抛出错误。
      throw new Error("Cannot calculate point on a zero-length segment (p1 and p2 are the same).");
    }

    // 4. 计算缩放比例
    // 这是为了将方向向量转换为单位向量后再乘以目标距离，一步完成。
    const scale = distance / length;

    // 5. 计算新点的坐标
    // 新坐标 = 起点坐标 + 方向向量 * 缩放比例
    const newX = startPoint.x + dx * scale;
    const newY = startPoint.y + dy * scale;

    // 6. 创建并返回新的 Point 对象
    return new PointNativeObject(newX, newY);
  }

  // 取得该直线的方向向量
  public get directionVector(): PointNativeObject {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;

    if (dx === 0 && dy === 0) {
      throw new Error("Cannot calculate slope for a point.");
    }

    if (dx === 0) {
      return new PointNativeObject(0, dy > 0 ? 1 : -1); // 垂直线
    }
    if (dy === 0) {
      return new PointNativeObject(dx > 0 ? 1 : -1, 0); // 水平线
    }
    return new PointNativeObject(dx > 0 ? 1 : -1, dy / dx); // 一般情况
  }

  // 获取某点的垂线上的一个点
  public perpendicularLineThroughPoint(point: Point): PointNativeObject {
    // 首先，计算该线性对象的方向向量
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;

    // 如果p1和p2是同一个点，则它不是一条线，无法定义垂线
    if (dx === 0 && dy === 0) {
      throw new Error("Cannot calculate a perpendicular line for a single point object.");
    }

    // 原直线的方向向量是 (dx, dy)。
    // 与其垂直的向量是 (-dy, dx)。这是一个关键的几何原理。
    // 例如，如果原直线是水平的 (dx=1, dy=0)，则垂线向量是 (0, 1)，即垂直向上。
    // 如果原直线是垂直的 (dx=0, dy=1)，则垂线向量是 (-1, 0)，即水平向左。

    // 我们需要找到一条经过输入点 `point` 且方向为 (-dy, dx) 的直线。
    // 获取这条垂线上的任意一个点，最简单的方法就是从 `point` 开始，
    // 沿着垂直向量移动。
    // 新点的坐标 = point的坐标 + 垂直向量的分量
    const perpendicularPointX = point.x - dy;
    const perpendicularPointY = point.y + dx;

    // 返回这个新计算出的点
    return new PointNativeObject(perpendicularPointX, perpendicularPointY);
  }

  /**
 * 计算并返回一个点，该点位于一条穿过指定点且与当前线段平行的线上。
 *
 * @param throughPoint 平行线必须穿过的点。
 * @param name 新点的名称。
 * @param distance (可选) 从 a_PointAlongLine 沿着平行线方向移动的距离。
 * 如果为正，则沿 p1->p2 方向移动；如果为负，则反向移动。
 * 如果未提供，默认使用当前线段自身的长度。
 * @returns {Point} 一个在平行线上的新点。
 */
  public parallelLineThroughPoint(throughPoint: Point, distance?: number): PointNativeObject {
    // 1. 获取原始线段的方向向量 (p1 -> p2)
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;

    // 2. 计算方向向量的长度
    const length = Math.sqrt(dx * dx + dy * dy);

    // 3. 处理原始线段长度为零的特殊情况
    if (length === 0) {
      throw new Error("Cannot define a parallel line for a zero-length segment (p1 and p2 are the same).");
    }

    // 4. 确定要移动的距离
    // 如果用户没有提供 distance 参数，我们就使用原始线段的长度作为默认值。
    const moveDistance = distance ?? length;

    // 5. 计算缩放比例
    const scale = moveDistance / length;

    // 6. 计算新点的坐标
    // 新坐标 = 起点(throughPoint)坐标 + 方向向量 * 缩放比例
    const newX = throughPoint.x + dx * scale;
    const newY = throughPoint.y + dy * scale;

    // 7. 返回新创建的点
    return new PointNativeObject(newX, newY);
  }

  public randomPointOnLine(start: number, end: number): PointNativeObject {
    // 生成一个介于-5和5之间的随机数
    const t = Math.random() * (end - start) + start; // 这样可以生成一个范围在[-5, 5]之间的随机数

    // 计算随机点的坐标
    const x = this.p1.x + t * (this.p2.x - this.p1.x);
    const y = this.p1.y + t * (this.p2.y - this.p1.y);

    return new PointNativeObject(x, y);
  }

  public IntersectionWithLine(other: LinearObject): PointNativeObject | null {
    const x1 = this.p1.x;
    const y1 = this.p1.y;
    const x2 = this.p2.x;
    const y2 = this.p2.y;

    const x3 = other.p1.x;
    const y3 = other.p1.y;
    const x4 = other.p2.x;
    const y4 = other.p2.y;

    // 计算分母 D
    const denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);

    // 如果分母为0，则两直线平行或共线
    // 使用一个小的容差值来处理浮点数精度问题
    if (Math.abs(denominator) < 1e-9) {
      return null;
    }

    // 计算参数 t 的分子
    const tNumerator = (x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4);

    // 计算参数 t
    const t = tNumerator / denominator;

    // 使用参数 t 计算交点的坐标
    const intersectX = x1 + t * (x2 - x1);
    const intersectY = y1 + t * (y2 - y1);

    // 创建并返回交点对象
    return new PointNativeObject(intersectX, intersectY);
  }
}

// 无限长的直线
export class Line extends LinearObject {
  constructor(name: string, p1: Point, p2: Point) {
    super(name, 'line', p1, p2);
  }

  public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();
    this.applyStrokeStyle(ctx, transform, options);

    const start = toScreenPoint(this.p1.x, this.p1.y, transform);
    const through = toScreenPoint(this.p2.x, this.p2.y, transform);

    const dx = through.x - start.x;
    const dy = through.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1e-9) {
      // 两个定义点重合，方向无法确定，不绘制
      ctx.restore();
      return;
    }

    const ux = dx / distance;
    const uy = dy / distance;

    // 基准点取两个定义点的中点：指定长度时向两端各延伸一半
    const anchorX = (start.x + through.x) / 2;
    const anchorY = (start.y + through.y) / 2;

    // 直线向两端延伸，参数下界为 -Infinity
    const extent = this.resolveDrawExtent(ctx, transform, options, anchorX, anchorY, ux, uy, -Infinity, false);
    if (!extent) {
      ctx.restore();
      return;
    }

    const intervals = this.getVisibleDrawIntervals(extent, parameter => (parameter - 0.5) * distance);
    for (const [from, to] of intervals) {
      ctx.moveTo(anchorX + ux * from, anchorY + uy * from);
      ctx.lineTo(anchorX + ux * to, anchorY + uy * to);
    }

    if (intervals.length > 0) ctx.stroke();
    ctx.restore();
  }
}

// 线段
export class Segment extends LinearObject {
  constructor(name: string, p1: Point, p2: Point) {
    super(name, 'segment', p1, p2);
  }

  // 使用getter计算长度
  get length(): number {
    return this.p1.distanceTo(this.p2);
  }

  public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();

    this.applyStrokeStyle(ctx, transform, options);

    const start = toScreenPoint(this.p1.x, this.p1.y, transform);
    const through = toScreenPoint(this.p2.x, this.p2.y, transform);

    const dx = through.x - start.x;
    const dy = through.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance < 1e-9) {
      ctx.restore();
      return;
    }

    const ux = dx / distance;
    const uy = dy / distance;
    const intervals = this.getVisibleDrawIntervals(
      [0, distance],
      parameter => parameter * distance,
    );
    for (const [from, to] of intervals) {
      ctx.moveTo(start.x + ux * from, start.y + uy * from);
      ctx.lineTo(start.x + ux * to, start.y + uy * to);
    }

    if (intervals.length > 0) ctx.stroke();
    ctx.restore();
  }
}

// 射线
export class Ray extends LinearObject {
  // 注意，对于射线，p1是起点，p2是方向点
  constructor(name: string, start: Point, through: Point) {
    super(name, 'ray', start, through);
  }

  get startPoint(): Point {
    return this.p1;
  }

  get directionPoint(): Point {
    return this.p2;
  }

  // 在射线上取一个给定长度的点
  public pointAtDistance(startPoint: Point, distance: number): PointNativeObject {
    const dx = this.p2.x - this.p1.x;
    const dy = this.p2.y - this.p1.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length === 0) {
      throw new Error("Direction vector cannot be zero.");
    }
    const scale = distance / length;
    return new PointNativeObject(startPoint.x + dx * scale, startPoint.y + dy * scale);
  }

  public draw(ctx: CanvasRenderingContext2D, transform: DrawTransform, options?: DrawOptions): void {
    ctx.save();
    ctx.beginPath();

    this.applyStrokeStyle(ctx, transform, options);

    const start = toScreenPoint(this.p1.x, this.p1.y, transform);
    const through = toScreenPoint(this.p2.x, this.p2.y, transform);

    const dx = through.x - start.x;
    const dy = through.y - start.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance < 1e-9) {
      // 顶点与方向点重合，方向无法确定，不绘制
      ctx.restore();
      return;
    }

    const ux = dx / distance;
    const uy = dy / distance;

    // 射线只从顶点向前延伸，参数下界为 0
    const extent = this.resolveDrawExtent(ctx, transform, options, start.x, start.y, ux, uy, 0, true);
    if (!extent) {
      ctx.restore();
      return;
    }

    const intervals = this.getVisibleDrawIntervals(extent, parameter => parameter * distance);
    for (const [from, to] of intervals) {
      ctx.moveTo(start.x + ux * from, start.y + uy * from);
      ctx.lineTo(start.x + ux * to, start.y + uy * to);
    }

    if (intervals.length > 0) ctx.stroke();
    ctx.restore();
  }
}
